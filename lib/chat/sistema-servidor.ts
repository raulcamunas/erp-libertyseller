import { createServiceClient } from '@/lib/supabase/service'
import { nivelDe } from './avisos'
import { armarMensajes, personasDelChat, type FilaMensaje } from './servidor'
import { emitir } from './tiempo-real'

/**
 * #notificaciones-erp: EL CANAL DONDE EL ERP AVISA SOLO. Un canal abierto y de anuncios (nadie escribe en él; se puede reaccionar y responder en hilos) al que entra todo el equipo con
 * avisos activados. De momento llegan aquí:
 *   · la verificación del stock que se sube a los clientes (Lenobotics, Shoplamp…): si ha quedado bien o qué hay que revisar;
 *   · las citas que agendan los comerciales.
 * Para añadir más avisos basta con llamar a `publicarEnElChat` desde donde pase el hecho.
 *
 * NUNCA LANZA: un aviso que falla no puede tumbar lo que avisaba (la verificación, la cita). Cada aviso lleva una `clave` y no se escribe dos veces; cada persona recibe además su aviso en
 * la campana y en el móvil salvo que haya silenciado el canal.
 */

const ORIGEN_DEL_CANAL = 'erp:notificaciones'
const NOMBRE_DEL_CANAL = 'notificaciones-erp'
const DESCRIPCION = 'Avisos automáticos del ERP: el stock que se sube a los clientes, las citas que agendan los comerciales…'
const AUTOR = 'ERP'

type Servicio = ReturnType<typeof createServiceClient>

let canalEnMemoria: string | null = null
let preparado: Promise<string | null> | null = null

async function buscarCanal(service: Servicio): Promise<string | null> {
  const { data } = await service.from('chat_canales').select('id').eq('origen_id', ORIGEN_DEL_CANAL).maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

async function crearOEncontrarCanal(service: Servicio): Promise<string | null> {
  if (canalEnMemoria) return canalEnMemoria
  const existente = await buscarCanal(service)
  if (existente) return (canalEnMemoria = existente)
  // Si el nombre ya lo usa otro canal, se prueba con una variante
  for (const nombre of [NOMBRE_DEL_CANAL, `${NOMBRE_DEL_CANAL}-2`, `${NOMBRE_DEL_CANAL}-3`]) {
    const { data, error } = await service.from('chat_canales').insert({ tipo: 'canal', nombre, descripcion: DESCRIPCION, auto_unirse: true, anuncios: true, origen_id: ORIGEN_DEL_CANAL }).select('id').single()
    if (!error) return (canalEnMemoria = (data as { id: string }).id)
    if (error.code === '23505') {
      const otra = await buscarCanal(service)
      if (otra) return (canalEnMemoria = otra)
      continue
    }
    console.error('Chat: no se ha podido crear #notificaciones-erp:', error.message)
    return null
  }
  return null
}

/** Que todo el equipo esté dentro, con los avisos activados. Solo se añade a quien falta: nadie pierde lo que haya elegido (silenciarlo, por ejemplo) */
async function asegurarMiembros(service: Servicio, canalId: string, ids: readonly string[]): Promise<void> {
  const { data } = await service.from('chat_miembros').select('usuario_id').eq('canal_id', canalId)
  const dentro = new Set(((data ?? []) as Array<{ usuario_id: string }>).map((m) => m.usuario_id))
  const faltan = ids.filter((id) => !dentro.has(id))
  if (faltan.length === 0) return
  const filas = faltan.map((usuario_id) => ({ canal_id: canalId, usuario_id, rol: 'miembro', avisos: 'todo' }))
  let { error } = await service.from('chat_miembros').upsert(filas, { onConflict: 'canal_id,usuario_id', ignoreDuplicates: true })
  // Sin la migración 287 no existe la columna de avisos: se entra igual
  if (error) ({ error } = await service.from('chat_miembros').upsert(filas.map(({ avisos: _a, ...resto }) => resto), { onConflict: 'canal_id,usuario_id', ignoreDuplicates: true }))
  if (error) console.error('Chat: no se ha podido meter al equipo en #notificaciones-erp:', error.message)
}

/**
 * Crea el canal y mete al equipo si hace falta (una vez por arranque del servidor). Lo llama la carga del chat, así el canal aparece nada más desplegar, sin esperar al primer aviso.
 * Devuelve el id del canal, o null si no se ha podido.
 */
export function prepararCanalDeNotificaciones(): Promise<string | null> {
  if (!preparado) {
    preparado = (async () => {
      try {
        const service = createServiceClient()
        const canalId = await crearOEncontrarCanal(service)
        if (!canalId) return null
        await asegurarMiembros(service, canalId, (await personasDelChat()).map((p) => p.id))
        const hay = await service.from('chat_mensajes').select('id', { count: 'exact', head: true }).eq('canal_id', canalId)
        if ((hay.count ?? 0) === 0) await publicar(canalId, { clave: 'bienvenida', titulo: 'Notificaciones del ERP', cuerpo: '👋 Aquí avisa el ERP solo: el **stock** que se sube a los clientes y las **citas** que agendan los comerciales. Iremos añadiendo más.', avisar: false })
        return canalId
      } catch (e) {
        console.error('Chat: no se ha podido preparar #notificaciones-erp:', e instanceof Error ? e.message : e)
        preparado = null
        return null
      }
    })()
  }
  return preparado
}

interface Aviso {
  /** Lo que identifica el hecho (`cita:<id>`, `verificacion:<id>`): el mismo no se escribe dos veces */
  clave: string
  /** El título que sale en la campana */
  titulo: string
  /** El mensaje, con el formato del chat */
  cuerpo: string
  /** Si además llega a la campana y al móvil (por defecto, sí) */
  avisar?: boolean
}

async function publicar(canalId: string, aviso: Aviso): Promise<void> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('chat_mensajes')
    .upsert({ canal_id: canalId, autor_id: null, autor_externo: AUTOR, cuerpo: aviso.cuerpo.slice(0, 8000), menciones: [], adjuntos: [], origen_id: aviso.clave }, { onConflict: 'canal_id,origen_id', ignoreDuplicates: true })
    .select('*')
  if (error) {
    console.error('Chat: no se ha podido escribir el aviso en #notificaciones-erp:', error.message)
    return
  }
  const fila = ((data ?? []) as FilaMensaje[])[0]
  if (!fila) return // ya estaba escrito
  await service.from('chat_canales').update({ ultimo_mensaje_en: fila.creado_en }).eq('id', canalId)
  const mensaje = (await armarMensajes([fila]))[0]

  const { data: miembros } = await service.from('chat_miembros').select('usuario_id, silenciado, avisos').eq('canal_id', canalId)
  const dentro = (miembros ?? []) as Array<{ usuario_id: string; silenciado: boolean; avisos?: string | null }>
  await emitir(dentro.map((m) => m.usuario_id), { tipo: 'mensaje', mensaje })

  if (aviso.avisar === false) return
  const filas = dentro
    .filter((m) => nivelDe(m, 'canal') === 'todo')
    .map((m) => ({ user_id: m.usuario_id, type: 'comment', title: aviso.titulo, message: aviso.cuerpo.replace(/\*\*/g, '').replace(/\s*\n\s*/g, ' · ').slice(0, 140), datos: { app: 'chat', canalId, mensajeId: mensaje.id }, read: false, clave: `erp:${aviso.clave}` }))
  if (filas.length > 0) {
    const { error: errorAvisos } = await service.from('notifications').upsert(filas, { onConflict: 'user_id,clave', ignoreDuplicates: true })
    if (errorAvisos) console.error('Chat: no se han podido escribir los avisos de #notificaciones-erp en la campana:', errorAvisos.message)
  }
}

/** Escribe un aviso en #notificaciones-erp (y lo reparte en directo y a la campana). Nunca lanza */
export async function publicarEnElChat(aviso: Aviso): Promise<void> {
  try {
    const canalId = await prepararCanalDeNotificaciones()
    if (!canalId) return
    await publicar(canalId, aviso)
  } catch (e) {
    console.error('Chat: no se ha podido avisar en #notificaciones-erp:', e instanceof Error ? e.message : e)
  }
}
