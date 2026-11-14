import { esCanalDeVoz } from './voz'
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk'
import { createServiceClient } from '@/lib/supabase/service'
import { canalDeSala, configuracionDeJunta, fusionarMetadatosDeSala, leerMetadatosDeSala, MENSAJE_DE_SALA_CON_CANDADO, PREFIJO_DE_SALA, puedeEntrarASala, salaDe, VIDA_DE_LA_LLAVE_S, type ConfiguracionDeJunta, type JuntaActiva } from './junta'
import { canalDe, ErrorDeChat, exigirMiembro, type QuienEscribe } from './servidor'
import { emitir } from './tiempo-real'

/**
 * LAS JUNTAS, DEL LADO DEL SERVIDOR. El ERP no toca el audio ni el vídeo (van por LiveKit Cloud): solo comprueba que quien pide entrar es miembro del canal, le firma una llave para esa
 * sala y avisa a los demás de que hay una junta. Sin las variables de entorno de LiveKit, nada de esto está disponible y el chat sigue como siempre.
 */

export const configuracion = (): ConfiguracionDeJunta | null => configuracionDeJunta(process.env)

export const noDisponible = () => new ErrorDeChat('Las juntas todavía no están configuradas en el servidor.', 409)

export function servicio(c: ConfiguracionDeJunta) {
  return new RoomServiceClient(c.urlHttp, c.clave, c.secreto)
}

/**
 * Lo que LiveKit dice que hay ahora mismo, guardado unos segundos: todos los que tienen el chat abierto preguntan a la vez (al llegar un aviso), y solo se pregunta una vez.
 * `generacion` sube cada vez que algo cambia (alguien entra o sale, el candado): una lectura que EMPEZÓ antes del cambio no se guarda, porque podría traer lo de antes y dejarlo
 * guardado para todos (12 nov 2026: «a otro no le sale»). Las lecturas a la vez de la misma generación se comparten.
 */
let cacheActivas: { en: number; lista: Array<{ canalId: string; personas: string[]; bloqueada: boolean }> } | null = null
let generacion = 0
let enCurso: { generacion: number; promesa: Promise<Array<{ canalId: string; personas: string[]; bloqueada: boolean }>> } | null = null
const VIDA_DE_LA_CACHE_MS = 4_000

function olvidarSalas() {
  generacion += 1
  cacheActivas = null
  enCurso = null
}

async function salasActivas(c: ConfiguracionDeJunta): Promise<Array<{ canalId: string; personas: string[]; bloqueada: boolean }>> {
  if (cacheActivas && Date.now() - cacheActivas.en < VIDA_DE_LA_CACHE_MS) return cacheActivas.lista
  if (enCurso && enCurso.generacion === generacion) return enCurso.promesa
  const gen = generacion
  const promesa = leerSalas(c).then((lista) => {
    if (gen === generacion) cacheActivas = { en: Date.now(), lista }
    return lista
  })
  enCurso = { generacion: gen, promesa }
  promesa.finally(() => {
    if (enCurso?.promesa === promesa) enCurso = null
  }).catch(() => undefined)
  return promesa
}

async function leerSalas(c: ConfiguracionDeJunta): Promise<Array<{ canalId: string; personas: string[]; bloqueada: boolean }>> {
  const svc = servicio(c)
  const salas = (await svc.listRooms()).filter((r) => r.name.startsWith(PREFIJO_DE_SALA) && r.numParticipants > 0)
  // Las salas a la vez, no una detrás de otra
  const lista = await Promise.all(
    salas.map(async (r) => {
      const canalId = canalDeSala(r.name)
      if (!canalId) return null
      const dentro = await svc.listParticipants(r.name)
      return { canalId, personas: dentro.map((p) => p.identity), bloqueada: leerMetadatosDeSala(r.metadata).bloqueada }
    })
  )
  return lista.filter((x): x is { canalId: string; personas: string[]; bloqueada: boolean } => x !== null)
}

/** Las juntas en curso en los canales que esta persona puede ver */
export async function juntasActivas(quien: QuienEscribe): Promise<{ disponible: boolean; activas: JuntaActiva[] }> {
  const c = configuracion()
  if (!c) return { disponible: false, activas: [] }
  let salas: Array<{ canalId: string; personas: string[]; bloqueada: boolean }>
  try {
    salas = await salasActivas(c)
  } catch (e) {
    console.error('Chat: no se han podido leer las juntas:', e instanceof Error ? e.message : e)
    return { disponible: true, activas: [] }
  }
  if (salas.length === 0) return { disponible: true, activas: [] }
  const service = createServiceClient()
  const ids = salas.map((s) => s.canalId)
  const [canales, propios] = await Promise.all([
    service.from('chat_canales').select('id, tipo').in('id', ids).eq('archivado', false),
    service.from('chat_miembros').select('canal_id').eq('usuario_id', quien.userId).in('canal_id', ids),
  ])
  const mios = new Set(((propios.data ?? []) as Array<{ canal_id: string }>).map((m) => m.canal_id))
  const visibles = new Map(((canales.data ?? []) as Array<{ id: string; tipo: string }>).filter((c2) => c2.tipo === 'canal' || mios.has(c2.id)).map((c2) => [c2.id, c2.tipo]))
  return { disponible: true, activas: salas.filter((s) => visibles.has(s.canalId)).map((s) => ({ canalId: s.canalId, participantes: s.personas.length, personas: s.personas, ...(s.bloqueada ? { bloqueada: true } : {}) })) }
}

/** La llave para entrar a la junta de un canal. Si la sala estaba vacía, esto la abre: se avisa a los demás (y, en un directo, suena en su campana) */
export async function entrarEnJunta(quien: QuienEscribe, canalId: unknown): Promise<{ token: string; url: string; sala: string }> {
  const c = configuracion()
  if (!c) throw noDisponible()
  const canal = await canalDe(canalId)
  const sala = salaDe(canal.id)
  // Lo de la base (que eres del canal) y lo de LiveKit (cómo está la sala) a la vez, no uno detrás de otro: son los dos viajes que hay antes de poder conectar
  const lecturaDeSala = estadoDeSala(c, sala)
  lecturaDeSala.catch(() => undefined)
  const miembros = await exigirMiembro(quien, canal)

  let estabaVacia = true
  try {
    const estado = await lecturaDeSala
    estabaVacia = estado.dentro.length === 0
    // Con candado, solo entra quien ya estaba dentro o a quien han dejado entrar. Un candado que se quedó puesto en una sala vacía no cuenta: se quita
    if (!puedeEntrarASala(estado, quien.userId)) throw new ErrorDeChat(MENSAJE_DE_SALA_CON_CANDADO, 423)
    if (estabaVacia && estado.existe && estado.metadatos && estado.metadatos !== '{}') void servicio(c).updateRoomMetadata(sala, '{}').catch(() => undefined)
  } catch (e) {
    if (e instanceof ErrorDeChat) throw e
    console.error('Chat: no se ha podido comprobar la sala:', e instanceof Error ? e.message : e)
  }

  const llave = new AccessToken(c.clave, c.secreto, { identity: quien.userId, name: quien.nombre, ttl: VIDA_DE_LA_LLAVE_S })
  llave.addGrant({ roomJoin: true, room: sala, canPublish: true, canSubscribe: true, canPublishData: true })
  const token = await llave.toJwt()

  if (estabaVacia) {
    // En un canal de voz no suena nada a nadie: se avisa solo para que se actualice quién está dentro
    void emitir(miembros.map((m) => m.usuario_id), { tipo: 'junta', canalId: canal.id, de: quien.userId, sala, estado: esCanalDeVoz(canal.origen_id) ? 'voz' : 'llama' })
    if (canal.tipo === 'directo') void avisarDeLlamada(quien, canal.id, miembros.filter((m) => m.usuario_id !== quien.userId && !m.silenciado).map((m) => m.usuario_id))
  }
  return { token, url: c.url, sala }
}

/** En un directo, a la otra persona le suena la campana (y le llega al móvil) aunque no tenga el chat abierto */
async function avisarDeLlamada(quien: QuienEscribe, canalId: string, destinatarios: readonly string[]): Promise<void> {
  if (destinatarios.length === 0) return
  try {
    const ventana = Math.floor(Date.now() / 120_000)
    const { error } = await createServiceClient()
      .from('notifications')
      .upsert(
        destinatarios.map((u) => ({ user_id: u, type: 'mention', title: `${quien.nombre} te está llamando`, message: 'Junta de voz y vídeo: entra desde el chat', clave: `chat-j:${canalId}:${ventana}`, datos: { app: 'chat', canalId }, read: false })),
        { onConflict: 'user_id,clave', ignoreDuplicates: true }
      )
    if (error) console.error('Chat: no se ha podido avisar de la llamada:', error.message)
  } catch (e) {
    console.error('Chat: no se ha podido avisar de la llamada:', e instanceof Error ? e.message : e)
  }
}


/* ------------------------------------------------------------------ */
/* El candado y la puerta                                              */
/* ------------------------------------------------------------------ */

export interface EstadoDeSala {
  existe: boolean
  /** Los metadatos tal cual están en LiveKit (el candado y la música): para cambiar una cosa sin pisar la otra (fusionarMetadatosDeSala) */
  metadatos: string
  bloqueada: boolean
  admitidos: string[]
  /** Quién está dentro ahora */
  dentro: string[]
}

/** Lo que LiveKit dice de una sala: si existe, si tiene candado, a quién se ha dejado entrar y quién está dentro */
export async function estadoDeSala(c: ConfiguracionDeJunta, sala: string): Promise<EstadoDeSala> {
  const svc = servicio(c)
  const r = (await svc.listRooms([sala]))[0]
  if (!r) return { existe: false, metadatos: '', bloqueada: false, admitidos: [], dentro: [] }
  const meta = leerMetadatosDeSala(r.metadata)
  const dentro = r.numParticipants > 0 ? (await svc.listParticipants(sala)).map((p) => p.identity) : []
  return { existe: true, metadatos: r.metadata ?? '', ...meta, dentro }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Poner o quitar el candado de la sala de un canal. Solo quien está dentro. Al ponerlo, los que están dentro quedan admitidos (si se caen y vuelven, entran) */
export async function ponerCandado(quien: QuienEscribe, canalId: unknown, bloqueada: unknown): Promise<{ bloqueada: boolean }> {
  const c = configuracion()
  if (!c) throw noDisponible()
  const canal = await canalDe(canalId)
  const sala = salaDe(canal.id)
  // Lo de la base (que eres del canal) y lo de LiveKit (quién está dentro) a la vez, no uno detrás de otro
  const [miembros, estado] = await Promise.all([exigirMiembro(quien, canal), estadoDeSala(c, sala)])
  if (!estado.dentro.includes(quien.userId)) throw new ErrorDeChat('Solo puede poner o quitar el candado quien está dentro de la sala.', 403)
  const nuevo = bloqueada === true
  // El aviso sale ANTES de tocar LiveKit, con el candado dentro: los demás lo ven al momento. Si LiveKit fallase, se avisa de nuevo con lo que hay
  void emitir(miembros.map((m) => m.usuario_id), { tipo: 'junta', canalId: canal.id, de: quien.userId, sala, estado: 'voz', bloqueada: nuevo })
  try {
    await servicio(c).updateRoomMetadata(sala, fusionarMetadatosDeSala(estado.metadatos, { bloqueada: nuevo, admitidos: [...new Set([...estado.dentro, ...estado.admitidos])].slice(0, 200) }))
  } catch (e) {
    void emitir(miembros.map((m) => m.usuario_id), { tipo: 'junta', canalId: canal.id, de: quien.userId, sala, estado: 'voz', bloqueada: estado.bloqueada })
    throw e
  } finally {
    olvidarSalas()
  }
  return { bloqueada: nuevo }
}

/**
 * «He entrado» o «he salido» de la sala de un canal: se olvida lo que se tenía guardado de LiveKit y se avisa a todos los del canal para que vuelvan a leer quién está dentro AHORA. Sin esto, solo se enteraban
 * de la primera entrada (la sala vacía) o por la presencia, que puede tardar o perderse: de ahí que uno viera a los dos dentro y el otro solo a uno.
 */
export async function avisarDeCambioEnLaSala(quien: QuienEscribe, canalId: unknown, accion?: unknown): Promise<{ ok: true }> {
  const c = configuracion()
  if (!c) throw noDisponible()
  const canal = await canalDe(canalId)
  const miembros = await exigirMiembro(quien, canal)
  olvidarSalas()
  // Con `accion`, los demás lo pintan al momento (quién entra o sale) sin esperar a que LiveKit lo cuente
  const que = accion === 'entra' || accion === 'sale' ? accion : undefined
  void emitir(miembros.map((m) => m.usuario_id), { tipo: 'junta', canalId: canal.id, de: quien.userId, sala: salaDe(canal.id), estado: 'voz', ...(que ? { accion: que } : {}) })
  return { ok: true }
}

/** Para no avasallar a quien está dentro: un toque por persona y sala cada 15 segundos */
const ULTIMO_TOQUE = new Map<string, number>()
const ENTRE_TOQUES_MS = 15_000

/** Llamar a la puerta de una sala con candado: les sale un aviso a quienes están dentro para que te dejen o no */
export async function tocarLaPuerta(quien: QuienEscribe, canalId: unknown): Promise<{ puedeEntrar: boolean }> {
  const c = configuracion()
  if (!c) throw noDisponible()
  const canal = await canalDe(canalId)
  await exigirMiembro(quien, canal)
  const estado = await estadoDeSala(c, salaDe(canal.id))
  if (puedeEntrarASala(estado, quien.userId)) return { puedeEntrar: true }
  const clave = `${quien.userId}:${canal.id}`
  const ahora = Date.now()
  if (ahora - (ULTIMO_TOQUE.get(clave) ?? 0) < ENTRE_TOQUES_MS) throw new ErrorDeChat('Ya has llamado: espera un momento a que te contesten.', 429)
  ULTIMO_TOQUE.set(clave, ahora)
  if (ULTIMO_TOQUE.size > 500) for (const [k, t] of ULTIMO_TOQUE) if (ahora - t > ENTRE_TOQUES_MS) ULTIMO_TOQUE.delete(k)
  void emitir(estado.dentro, { tipo: 'puerta', canalId: canal.id, de: quien.userId, estado: 'toca' })
  return { puedeEntrar: false }
}

/** Quien está dentro deja entrar (o no) a quien ha llamado a la puerta */
export async function responderALaPuerta(quien: QuienEscribe, canalId: unknown, usuarioId: unknown, permitir: boolean): Promise<{ permitido: boolean }> {
  const c = configuracion()
  if (!c) throw noDisponible()
  if (typeof usuarioId !== 'string' || !UUID.test(usuarioId)) throw new ErrorDeChat('Falta quién ha llamado.')
  const canal = await canalDe(canalId)
  await exigirMiembro(quien, canal)
  const sala = salaDe(canal.id)
  const estado = await estadoDeSala(c, sala)
  if (!estado.dentro.includes(quien.userId)) throw new ErrorDeChat('Solo puede contestar quien está dentro de la sala.', 403)
  if (permitir) await servicio(c).updateRoomMetadata(sala, fusionarMetadatosDeSala(estado.metadatos, { bloqueada: estado.bloqueada, admitidos: [...new Set([...estado.admitidos, usuarioId])].slice(0, 200) }))
  void emitir([usuarioId], { tipo: 'puerta', canalId: canal.id, de: quien.userId, estado: permitir ? 'permitida' : 'denegada' })
  void emitir(estado.dentro, { tipo: 'puerta', canalId: canal.id, de: usuarioId, estado: 'resuelta' })
  return { permitido: permitir }
}
