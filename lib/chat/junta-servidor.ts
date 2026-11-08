import { esCanalDeVoz } from './voz'
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk'
import { createServiceClient } from '@/lib/supabase/service'
import { canalDeSala, configuracionDeJunta, PREFIJO_DE_SALA, salaDe, VIDA_DE_LA_LLAVE_S, type ConfiguracionDeJunta, type JuntaActiva } from './junta'
import { canalDe, ErrorDeChat, exigirMiembro, type QuienEscribe } from './servidor'
import { emitir } from './tiempo-real'

/**
 * LAS JUNTAS, DEL LADO DEL SERVIDOR. El ERP no toca el audio ni el vídeo (van por LiveKit Cloud): solo comprueba que quien pide entrar es miembro del canal, le firma una llave para esa
 * sala y avisa a los demás de que hay una junta. Sin las variables de entorno de LiveKit, nada de esto está disponible y el chat sigue como siempre.
 */

export const configuracion = (): ConfiguracionDeJunta | null => configuracionDeJunta(process.env)

const noDisponible = () => new ErrorDeChat('Las juntas todavía no están configuradas en el servidor.', 409)

function servicio(c: ConfiguracionDeJunta) {
  return new RoomServiceClient(c.urlHttp, c.clave, c.secreto)
}

/** Lo que LiveKit dice que hay ahora mismo, guardado diez segundos: todos los que tienen el chat abierto preguntan, y solo se pregunta una vez */
let cacheActivas: { en: number; lista: Array<{ canalId: string; personas: string[] }> } | null = null
const VIDA_DE_LA_CACHE_MS = 10_000

async function salasActivas(c: ConfiguracionDeJunta, forzar = false): Promise<Array<{ canalId: string; personas: string[] }>> {
  if (!forzar && cacheActivas && Date.now() - cacheActivas.en < VIDA_DE_LA_CACHE_MS) return cacheActivas.lista
  const svc = servicio(c)
  const salas = (await svc.listRooms()).filter((r) => r.name.startsWith(PREFIJO_DE_SALA) && r.numParticipants > 0)
  const lista: Array<{ canalId: string; personas: string[] }> = []
  for (const r of salas) {
    const canalId = canalDeSala(r.name)
    if (!canalId) continue
    const dentro = await svc.listParticipants(r.name)
    lista.push({ canalId, personas: dentro.map((p) => p.identity) })
  }
  cacheActivas = { en: Date.now(), lista }
  return lista
}

/** Las juntas en curso en los canales que esta persona puede ver */
export async function juntasActivas(quien: QuienEscribe): Promise<{ disponible: boolean; activas: JuntaActiva[] }> {
  const c = configuracion()
  if (!c) return { disponible: false, activas: [] }
  let salas: Array<{ canalId: string; personas: string[] }>
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
  return { disponible: true, activas: salas.filter((s) => visibles.has(s.canalId)).map((s) => ({ canalId: s.canalId, participantes: s.personas.length, personas: s.personas })) }
}

/** La llave para entrar a la junta de un canal. Si la sala estaba vacía, esto la abre: se avisa a los demás (y, en un directo, suena en su campana) */
export async function entrarEnJunta(quien: QuienEscribe, canalId: unknown): Promise<{ token: string; url: string; sala: string }> {
  const c = configuracion()
  if (!c) throw noDisponible()
  const canal = await canalDe(canalId)
  const miembros = await exigirMiembro(quien, canal)
  const sala = salaDe(canal.id)

  let estabaVacia = true
  try {
    estabaVacia = !(await salasActivas(c, true)).some((s) => s.canalId === canal.id)
  } catch (e) {
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
