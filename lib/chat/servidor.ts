import { APP_CHAT } from '@/lib/config/apps'
import { createServiceClient } from '@/lib/supabase/service'
import { esRutaDe } from './archivos'
import { esNivel, motivoDeAviso, nivelDe, type NivelDeAvisos } from './avisos'
import { claveDeDirecto, normalizarNombreDeCanal } from './canales'
import { limpiarEncuesta, votosTrasPulsar, type EncuestaChat } from './encuesta'
import { estaVigente, type EstadoChat } from './estado'
import { cuerpoValido, CUERPO_MAX, extraerMenciones, limpiarCuerpo, mencionaATodos, textoPlano } from './mensajes'
import { zonaValida } from './zonas'
import { emitir } from './tiempo-real'
import type { AdjuntoChat, CanalChat, CitaChat, MensajeChat, PersonaChat, TipoDeCanal } from './tipos'

/**
 * EL CHAT DEL EQUIPO, DEL LADO DEL SERVIDOR. Todo pasa por aquí con la clave de servicio: las tablas chat_* están cerradas al navegador (migración 284), así que ESTE código es el único
 * control de quién ve qué. La regla: un canal abierto (`canal`) lo puede leer cualquiera con acceso al chat; un canal privado o un directo, solo sus miembros (y a quien no lo es se le
 * contesta «no existe», no «prohibido», para no decirle que está ahí). Los administradores del ERP NO leen los privados ni los directos de otros.
 */

export class ErrorDeChat extends Error {
  constructor(
    mensaje: string,
    public estado = 400
  ) {
    super(mensaje)
    this.name = 'ErrorDeChat'
  }
}

export interface QuienEscribe {
  userId: string
  nombre: string
  esAdmin: boolean
}

export interface FilaCanal {
  id: string
  tipo: TipoDeCanal
  nombre: string | null
  descripcion: string
  cliente_id: string | null
  auto_unirse: boolean
  archivado: boolean
  ultimo_mensaje_en: string | null
  creado_en: string
  creado_por: string | null
  /** Solo existe con la migración 287 */
  anuncios?: boolean
}

export interface FilaMensaje {
  id: number
  canal_id: string
  autor_id: string | null
  cuerpo: string
  hilo_de: number | null
  /** Solo existe con la migración 285 */
  responde_a?: number | null
  /** Solo existe con la migración 286 */
  fijado_en?: string | null
  /** Solo existen con la migración 287 */
  encuesta?: EncuestaChat | null
  autor_externo?: string | null
  menciones: string[] | null
  adjuntos: AdjuntoChat[] | null
  editado_en: string | null
  borrado_en: string | null
  creado_en: string
}

export interface FilaMiembro {
  usuario_id: string
  rol: 'admin' | 'miembro'
  silenciado: boolean
  /** Solo existe con la migración 287 */
  avisos?: string | null
}

const db = () => createServiceClient()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const esUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)
const esNumeroDeMensaje = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0

const FALTA_LA_MIGRACION = 'Falta lanzar la migración 284 en Supabase para que funcione el chat.'
const tablaNoExiste = (e: { code?: string; message?: string } | null | undefined) => Boolean(e && (e.code === '42P01' || e.code === 'PGRST205' || /does not exist|schema cache/i.test(e.message ?? '')))
const faltaColumna = (e: { code?: string; message?: string } | null | undefined) => Boolean(e && (e.code === '42703' || e.code === 'PGRST204' || /column .* does not exist|could not find the .* column/i.test(e.message ?? '')))
const columnaNoExiste = (e: { code?: string; message?: string } | null | undefined) => Boolean(e && (e.code === '42703' || e.code === 'PGRST204' || /column .*responde_a|responde_a.* column/i.test(e.message ?? '')))
function fallo(e: { code?: string; message?: string }, que: string): never {
  if (tablaNoExiste(e)) throw new ErrorDeChat(FALTA_LA_MIGRACION, 409)
  console.error(`Chat: ${que}:`, e.message)
  throw new ErrorDeChat('No se ha podido completar la operación. Inténtalo otra vez.', 500)
}

/* ------------------------------------------------------------------ */
/* Personas                                                            */
/* ------------------------------------------------------------------ */

let cachePersonas: { en: number; lista: PersonaChat[] } | null = null
const VIDA_DE_LA_CACHE_MS = 60_000

/** Quién tiene el chat: los administradores y quien tenga la casilla. Se guarda un minuto en memoria: cada mensaje las necesita para comprobar las menciones */
export async function personasDelChat(): Promise<PersonaChat[]> {
  if (cachePersonas && Date.now() - cachePersonas.en < VIDA_DE_LA_CACHE_MS) return cachePersonas.lista
  const service = db()
  const [admins, permisos] = await Promise.all([
    service.from('profiles').select('id, full_name, email').eq('role', 'admin'),
    service.from('user_app_permissions').select('user_id').eq('app_id', APP_CHAT).eq('can_access', true),
  ])
  const ids = ((permisos.data ?? []) as Array<{ user_id: string }>).map((p) => p.user_id)
  const otros = ids.length > 0 ? await service.from('profiles').select('id, full_name, email').in('id', ids) : { data: [] as Array<{ id: string; full_name: string | null; email: string | null }> }
  const unicas = new Map<string, PersonaChat>()
  for (const f of [...((admins.data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>), ...((otros.data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>)]) {
    unicas.set(f.id, { id: f.id, nombre: (f.full_name ?? '').trim() || f.email || 'Alguien del equipo', email: f.email })
  }
  // La zona horaria de cada una (migración 287): si la tabla no existe, se queda sin zonas
  const { data: zonas, error: errorZonas } = await service.from('chat_perfiles').select('usuario_id, zona')
  if (!errorZonas) for (const z of (zonas ?? []) as Array<{ usuario_id: string; zona: string }>) { const p = unicas.get(z.usuario_id); if (p) p.zona = z.zona }
  const lista = [...unicas.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  cachePersonas = { en: Date.now(), lista }
  return lista
}

/* ------------------------------------------------------------------ */
/* Canales: acceso                                                     */
/* ------------------------------------------------------------------ */

export async function canalDe(id: unknown): Promise<FilaCanal> {
  if (!esUuid(id)) throw new ErrorDeChat('Falta el canal.')
  const { data, error } = await db().from('chat_canales').select('*').eq('id', id).maybeSingle()
  if (error) fallo(error, 'leer el canal')
  if (!data || (data as FilaCanal).archivado) throw new ErrorDeChat('Ese canal no existe.', 404)
  return data as FilaCanal
}

export async function miembrosDe(canalId: string): Promise<FilaMiembro[]> {
  // Con la migración 287 también hay `avisos`; sin ella, se lee sin esa columna
  let r = await db().from('chat_miembros').select('usuario_id, rol, silenciado, avisos').eq('canal_id', canalId)
  if (r.error && faltaColumna(r.error)) r = (await db().from('chat_miembros').select('usuario_id, rol, silenciado').eq('canal_id', canalId)) as typeof r
  if (r.error) fallo(r.error, 'leer los miembros')
  return (r.data ?? []) as unknown as FilaMiembro[]
}

/** Quien puede LEER el canal. Devuelve sus miembros (que casi siempre hacen falta después) */
async function exigirVer(quien: QuienEscribe, canal: FilaCanal): Promise<FilaMiembro[]> {
  const miembros = await miembrosDe(canal.id)
  if (canal.tipo !== 'canal' && !miembros.some((m) => m.usuario_id === quien.userId)) throw new ErrorDeChat('Ese canal no existe.', 404)
  return miembros
}

export async function exigirMiembro(quien: QuienEscribe, canal: FilaCanal): Promise<FilaMiembro[]> {
  const miembros = await miembrosDe(canal.id)
  if (!miembros.some((m) => m.usuario_id === quien.userId)) throw new ErrorDeChat(canal.tipo === 'canal' ? 'Únete al canal para escribir.' : 'Ese canal no existe.', canal.tipo === 'canal' ? 403 : 404)
  return miembros
}

const puedeGestionar = (quien: QuienEscribe, miembros: readonly FilaMiembro[]) => quien.esAdmin || miembros.some((m) => m.usuario_id === quien.userId && m.rol === 'admin')

/* ------------------------------------------------------------------ */
/* Inicio                                                              */
/* ------------------------------------------------------------------ */

export interface DatosDeInicioChat {
  yo: { id: string; nombre: string; esAdmin: boolean }
  personas: PersonaChat[]
  canales: CanalChat[]
  /** Los mensajes que tengo guardados (solo los ids) */
  guardados: number[]
  /** El estado vigente de cada persona que tiene uno */
  estados: Record<string, EstadoChat>
}

export async function cargarInicio(quien: QuienEscribe): Promise<DatosDeInicioChat> {
  const service = db()
  const personas = await personasDelChat()
  // #notificaciones-erp: se crea (y se mete al equipo) la primera vez, antes de leer los canales de cada uno
  await import('./sistema-servidor').then((m) => m.prepararCanalDeNotificaciones()).catch(() => null)

  // Los canales a los que entra todo el mundo (#general): se entra una sola vez, la primera
  let lecturaPropios = await service.from('chat_miembros').select('canal_id, silenciado, ultimo_leido_en, avisos, rol').eq('usuario_id', quien.userId)
  if (lecturaPropios.error && faltaColumna(lecturaPropios.error)) lecturaPropios = (await service.from('chat_miembros').select('canal_id, silenciado, ultimo_leido_en, rol').eq('usuario_id', quien.userId)) as typeof lecturaPropios
  const { data: propios, error: errorPropios } = lecturaPropios
  if (errorPropios) fallo(errorPropios, 'leer tus canales')
  const mios = new Map(((propios ?? []) as unknown as Array<{ canal_id: string; silenciado: boolean; ultimo_leido_en: string; avisos?: string | null; rol?: string }>).map((m) => [m.canal_id, m]))
  const { data: autos } = await service.from('chat_canales').select('id').eq('auto_unirse', true).eq('archivado', false)
  const faltan = ((autos ?? []) as Array<{ id: string }>).filter((c) => !mios.has(c.id))
  if (faltan.length > 0) {
    await service.from('chat_miembros').upsert(faltan.map((c) => ({ canal_id: c.id, usuario_id: quien.userId })), { onConflict: 'canal_id,usuario_id', ignoreDuplicates: true })
    for (const c of faltan) mios.set(c.id, { canal_id: c.id, silenciado: false, ultimo_leido_en: new Date().toISOString(), avisos: null })
  }

  // Los abiertos (todos) y los privados y directos en los que estoy
  const ids = [...mios.keys()]
  const consulta = service.from('chat_canales').select('*').eq('archivado', false)
  const { data: filas, error } = await (ids.length > 0 ? consulta.or(`tipo.eq.canal,id.in.(${ids.join(',')})`) : consulta.eq('tipo', 'canal'))
  if (error) fallo(error, 'leer los canales')
  const canales = (filas ?? []) as FilaCanal[]

  const [miembros, resumen] = await Promise.all([
    canales.length > 0 ? service.from('chat_miembros').select('canal_id, usuario_id').in('canal_id', canales.map((c) => c.id)) : Promise.resolve({ data: [] as Array<{ canal_id: string; usuario_id: string }>, error: null }),
    service.rpc('chat_resumen', { p_usuario: quien.userId }),
  ])
  const miembrosPorCanal = new Map<string, string[]>()
  for (const m of (miembros.data ?? []) as Array<{ canal_id: string; usuario_id: string }>) miembrosPorCanal.set(m.canal_id, [...(miembrosPorCanal.get(m.canal_id) ?? []), m.usuario_id])
  const sinLeer = new Map(((resumen.data ?? []) as Array<{ canal_id: string; no_leidos: number; menciones: number }>).map((r) => [r.canal_id, r]))

  // Lo de la migración 286: si todavía no está lanzada, estas consultas fallan y se queda en vacío (el chat sigue igual)
  const idsDeCanales = canales.map((c) => c.id)
  const [guardadosFilas, estadosFilas, fijadosFilas] = await Promise.all([
    service.from('chat_guardados').select('mensaje_id').eq('usuario_id', quien.userId).order('creado_en', { ascending: false }).limit(500),
    service.from('chat_estados').select('usuario_id, emoji, texto, hasta'),
    idsDeCanales.length > 0 ? service.from('chat_mensajes').select('canal_id').in('canal_id', idsDeCanales).not('fijado_en', 'is', null).limit(2000) : Promise.resolve({ data: [] as Array<{ canal_id: string }>, error: null }),
  ])
  const guardados = guardadosFilas.error ? [] : ((guardadosFilas.data ?? []) as Array<{ mensaje_id: number }>).map((g) => g.mensaje_id)
  const estados: Record<string, EstadoChat> = {}
  if (!estadosFilas.error) for (const e of (estadosFilas.data ?? []) as Array<{ usuario_id: string; emoji: string; texto: string; hasta: string | null }>) if (estaVigente(e)) estados[e.usuario_id] = { emoji: e.emoji, texto: e.texto, hasta: e.hasta }
  const fijadosPorCanal = new Map<string, number>()
  if (!fijadosFilas.error) for (const f of (fijadosFilas.data ?? []) as Array<{ canal_id: string }>) fijadosPorCanal.set(f.canal_id, (fijadosPorCanal.get(f.canal_id) ?? 0) + 1)

  return {
    yo: { id: quien.userId, nombre: quien.nombre, esAdmin: quien.esAdmin },
    personas,
    canales: canales.map((c) => {
      const propio = mios.get(c.id)
      const r = sinLeer.get(c.id)
      return {
        id: c.id,
        tipo: c.tipo,
        nombre: c.nombre,
        descripcion: c.descripcion,
        cliente_id: c.cliente_id,
        auto_unirse: c.auto_unirse,
        archivado: c.archivado,
        ultimo_mensaje_en: c.ultimo_mensaje_en,
        creado_en: c.creado_en,
        miembros: miembrosPorCanal.get(c.id) ?? [],
        soy_miembro: Boolean(propio),
        no_leidos: propio ? r?.no_leidos ?? 0 : 0,
        menciones: propio ? r?.menciones ?? 0 : 0,
        silenciado: propio?.silenciado ?? false,
        ultimo_leido_en: propio?.ultimo_leido_en ?? null,
        fijados: fijadosPorCanal.get(c.id) ?? 0,
        avisos: nivelDe({ avisos: propio?.avisos, silenciado: propio?.silenciado }, c.tipo),
        anuncios: c.anuncios === true,
        soy_admin: quien.esAdmin || propio?.rol === 'admin',
      }
    }),
    guardados,
    estados,
  }
}

/* ------------------------------------------------------------------ */
/* Mensajes                                                            */
/* ------------------------------------------------------------------ */

async function armarMensajes(filas: readonly FilaMensaje[]): Promise<MensajeChat[]> {
  if (filas.length === 0) return []
  const ids = filas.map((f) => f.id)
  const service = db()
  const idsCitados = [...new Set(filas.map((f) => f.responde_a).filter((x): x is number => typeof x === 'number'))]
  const idsConEncuesta = filas.filter((f) => f.encuesta).map((f) => f.id)
  const [reacciones, respuestas, citados, personas, votosFilas] = await Promise.all([
    service.from('chat_reacciones').select('mensaje_id, usuario_id, emoji').in('mensaje_id', ids),
    service.from('chat_mensajes').select('hilo_de').in('hilo_de', ids).is('borrado_en', null),
    idsCitados.length > 0 ? service.from('chat_mensajes').select('id, autor_id, cuerpo, adjuntos, borrado_en').in('id', idsCitados) : Promise.resolve({ data: [] as Array<{ id: number; autor_id: string | null; cuerpo: string; adjuntos: AdjuntoChat[] | null; borrado_en: string | null }>, error: null }),
    idsCitados.length > 0 ? personasDelChat() : Promise.resolve([] as PersonaChat[]),
    idsConEncuesta.length > 0 ? service.from('chat_votos').select('mensaje_id, usuario_id, opcion').in('mensaje_id', idsConEncuesta) : Promise.resolve({ data: [] as Array<{ mensaje_id: number; usuario_id: string; opcion: number }>, error: null }),
  ])
  const votosPorMensaje = new Map<number, Record<number, string[]>>()
  for (const v of (votosFilas.data ?? []) as Array<{ mensaje_id: number; usuario_id: string; opcion: number }>) {
    const m = votosPorMensaje.get(v.mensaje_id) ?? {}
    m[v.opcion] = [...(m[v.opcion] ?? []), v.usuario_id]
    votosPorMensaje.set(v.mensaje_id, m)
  }
  const nombreDe = (id: string) => personas.find((p) => p.id === id)?.nombre.split(' ')[0] ?? 'alguien'
  const enlaces = await firmarAdjuntos(filas.flatMap((f) => (f.borrado_en ? [] : f.adjuntos ?? [])))
  const citas = new Map<number, CitaChat>()
  for (const c of (citados.data ?? []) as Array<{ id: number; autor_id: string | null; cuerpo: string; adjuntos: AdjuntoChat[] | null; borrado_en: string | null }>) {
    citas.set(c.id, { id: c.id, autor_id: c.autor_id, borrado: c.borrado_en !== null, texto: c.borrado_en ? '' : textoPlano(c.cuerpo, nombreDe, 140) || ((c.adjuntos ?? []).length > 0 ? '📎 Archivo adjunto' : '') })
  }
  const porMensaje = new Map<number, Record<string, string[]>>()
  for (const r of (reacciones.data ?? []) as Array<{ mensaje_id: number; usuario_id: string; emoji: string }>) {
    const m = porMensaje.get(r.mensaje_id) ?? {}
    m[r.emoji] = [...(m[r.emoji] ?? []), r.usuario_id]
    porMensaje.set(r.mensaje_id, m)
  }
  const cuenta = new Map<number, number>()
  for (const r of (respuestas.data ?? []) as Array<{ hilo_de: number }>) cuenta.set(r.hilo_de, (cuenta.get(r.hilo_de) ?? 0) + 1)
  return filas.map((f) => ({
    id: f.id,
    canal_id: f.canal_id,
    autor_id: f.autor_id,
    // Un mensaje borrado no enseña nada de lo que decía
    cuerpo: f.borrado_en ? '' : f.cuerpo,
    hilo_de: f.hilo_de,
    cita: f.borrado_en || !f.responde_a ? null : citas.get(f.responde_a) ?? null,
    menciones: f.borrado_en ? [] : f.menciones ?? [],
    adjuntos: f.borrado_en ? [] : (f.adjuntos ?? []).map((a) => ({ ...a, url: (a.ruta && enlaces.get(a.ruta)) || a.url || '' })),
    editado_en: f.editado_en,
    fijado_en: f.borrado_en ? null : f.fijado_en ?? null,
    encuesta: f.borrado_en ? null : f.encuesta ?? null,
    votos: f.borrado_en ? {} : votosPorMensaje.get(f.id) ?? {},
    autor_externo: f.autor_externo ?? null,
    borrado_en: f.borrado_en,
    creado_en: f.creado_en,
    reacciones: f.borrado_en ? {} : porMensaje.get(f.id) ?? {},
    respuestas: cuenta.get(f.id) ?? 0,
  }))
}

export const MENSAJES_POR_PAGINA = 50

/**
 * Los mensajes de un canal, del más viejo al más nuevo, de 50 en 50: con `antes` (el id del más viejo que ya tienes) vienen los anteriores. Con `hilo` (el id de un mensaje) vienen ese
 * mensaje y sus respuestas.
 */
export async function mensajesDe(quien: QuienEscribe, entrada: { canalId: unknown; antes?: unknown; hilo?: unknown; alrededor?: unknown }): Promise<{ mensajes: MensajeChat[]; hayMas: boolean; hayMasNuevos?: boolean }> {
  const canal = await canalDe(entrada.canalId)
  await exigirVer(quien, canal)
  const service = db()
  if (entrada.hilo !== undefined && entrada.hilo !== null) {
    const hilo = Number(entrada.hilo)
    if (!esNumeroDeMensaje(hilo)) throw new ErrorDeChat('Ese hilo no es válido.')
    const [padre, hijos] = await Promise.all([
      service.from('chat_mensajes').select('*').eq('id', hilo).eq('canal_id', canal.id).is('hilo_de', null).maybeSingle(),
      service.from('chat_mensajes').select('*').eq('hilo_de', hilo).eq('canal_id', canal.id).order('id', { ascending: true }).limit(300),
    ])
    if (padre.error) fallo(padre.error, 'leer el hilo')
    if (!padre.data) throw new ErrorDeChat('Ese mensaje no existe.', 404)
    return { mensajes: await armarMensajes([padre.data as FilaMensaje, ...((hijos.data ?? []) as FilaMensaje[])]), hayMas: false }
  }
  // Una ventana alrededor de un mensaje (al saltar desde una búsqueda, una cita o un guardado): 25 antes y 25 después
  if (entrada.alrededor !== undefined && entrada.alrededor !== null) {
    const objetivo = Number(entrada.alrededor)
    if (!esNumeroDeMensaje(objetivo)) throw new ErrorDeChat('Ese mensaje no es válido.')
    const { data: m } = await service.from('chat_mensajes').select('id, hilo_de').eq('id', objetivo).eq('canal_id', canal.id).maybeSingle()
    if (!m) throw new ErrorDeChat('Ese mensaje no existe.', 404)
    // Una respuesta de un hilo se busca por el mensaje de arriba
    const centro = (m as { hilo_de: number | null }).hilo_de ?? objetivo
    const [antes, despues] = await Promise.all([
      service.from('chat_mensajes').select('*').eq('canal_id', canal.id).is('hilo_de', null).lte('id', centro).order('id', { ascending: false }).limit(26),
      service.from('chat_mensajes').select('*').eq('canal_id', canal.id).is('hilo_de', null).gt('id', centro).order('id', { ascending: true }).limit(26),
    ])
    if (antes.error) fallo(antes.error, 'leer los mensajes')
    const previos = (antes.data ?? []) as FilaMensaje[]
    const siguientes = (despues.data ?? []) as FilaMensaje[]
    return { mensajes: await armarMensajes([...previos.slice(0, 25).reverse(), ...siguientes.slice(0, 25)]), hayMas: previos.length > 25, hayMasNuevos: siguientes.length > 25 }
  }
  let consulta = service.from('chat_mensajes').select('*').eq('canal_id', canal.id).is('hilo_de', null).order('id', { ascending: false }).limit(MENSAJES_POR_PAGINA + 1)
  const antes = entrada.antes === undefined || entrada.antes === null ? null : Number(entrada.antes)
  if (antes !== null) {
    if (!esNumeroDeMensaje(antes)) throw new ErrorDeChat('Esa página no es válida.')
    consulta = consulta.lt('id', antes)
  }
  const { data, error } = await consulta
  if (error) fallo(error, 'leer los mensajes')
  const filas = (data ?? []) as FilaMensaje[]
  const hayMas = filas.length > MENSAJES_POR_PAGINA
  return { mensajes: await armarMensajes(filas.slice(0, MENSAJES_POR_PAGINA).reverse()), hayMas }
}

export const ALMACEN_DE_ARCHIVOS = 'chat-archivos'
const VALIDEZ_DE_LOS_ENLACES_S = 12 * 3600

/** Los enlaces firmados de los archivos de unos mensajes (caducan; se piden al leer, nunca se guardan) */
async function firmarAdjuntos(adjuntos: readonly AdjuntoChat[]): Promise<Map<string, string>> {
  const rutas = [...new Set(adjuntos.map((a) => a.ruta).filter((r): r is string => Boolean(r)))]
  if (rutas.length === 0) return new Map()
  const { data } = await db().storage.from(ALMACEN_DE_ARCHIVOS).createSignedUrls(rutas, VALIDEZ_DE_LOS_ENLACES_S)
  return new Map(((data ?? []) as Array<{ path: string | null; signedUrl: string }>).filter((f) => f.path).map((f) => [f.path as string, f.signedUrl]))
}

/** Los archivos que se pueden colgar de un mensaje: solo los que ha subido quien lo envía (la ruta lleva su id), con nombre, y pocos */
export function adjuntosValidos(entrada: unknown, usuarioId: string): AdjuntoChat[] {
  if (!Array.isArray(entrada)) return []
  return entrada
    .filter((a): a is Record<string, unknown> => Boolean(a) && typeof a === 'object')
    .filter((a) => esRutaDe(a.ruta, usuarioId))
    .map((a) => ({
      nombre: typeof a.nombre === 'string' ? a.nombre.slice(0, 200) : '',
      ruta: a.ruta as string,
      url: '',
      tipo: typeof a.tipo === 'string' ? a.tipo.slice(0, 100) : '',
      tamano: typeof a.tamano === 'number' && Number.isFinite(a.tamano) ? Math.max(0, Math.round(a.tamano)) : 0,
      // Una nota de voz: solo si es un audio. La transcripción no viene del navegador: la pone el servidor
      ...(a.voz === true && typeof a.tipo === 'string' && a.tipo.startsWith('audio/') ? { voz: true, duracion: typeof a.duracion === 'number' && Number.isFinite(a.duracion) ? Math.min(600, Math.max(0, Math.round(a.duracion))) : 0 } : {}),
    }))
    .filter((a) => a.nombre)
    .slice(0, 10)
    // Lo que se guarda no lleva enlace: se firma al leer
    .map(({ url: _url, ...resto }) => ({ ...resto, url: '' }))
}

const nombreDeCanal = (c: FilaCanal) => c.nombre ?? 'mensaje directo'

export async function enviarMensaje(quien: QuienEscribe, entrada: { canalId: unknown; cuerpo: unknown; hiloDe?: unknown; adjuntos?: unknown; respondeA?: unknown; encuesta?: unknown }): Promise<MensajeChat> {
  const encuestaLeida = entrada.encuesta !== undefined && entrada.encuesta !== null ? limpiarEncuesta(entrada.encuesta) : null
  if (encuestaLeida && !encuestaLeida.ok) throw new ErrorDeChat(encuestaLeida.motivo)
  const encuesta = encuestaLeida?.ok ? encuestaLeida.encuesta : null
  const cuerpo = limpiarCuerpo(entrada.cuerpo) || (encuesta ? encuesta.pregunta : '')
  const adjuntos = adjuntosValidos(entrada.adjuntos, quien.userId)
  if (!cuerpo && adjuntos.length === 0 && !encuesta) throw new ErrorDeChat('Escribe algo antes de enviar.')
  if (!cuerpoValido(cuerpo)) throw new ErrorDeChat(`El mensaje es demasiado largo (máximo ${CUERPO_MAX} caracteres).`)
  const canal = await canalDe(entrada.canalId)
  const miembros = await exigirMiembro(quien, canal)
  const service = db()
  // En un canal de anuncios solo publican quienes lo administran; el resto reacciona y responde en los hilos
  if (canal.anuncios && (entrada.hiloDe === undefined || entrada.hiloDe === null) && !puedeGestionar(quien, miembros)) throw new ErrorDeChat('Este canal es de anuncios: solo lo publican quienes lo administran. Puedes reaccionar y responder en un hilo.', 403)
  if (encuesta && entrada.hiloDe !== undefined && entrada.hiloDe !== null) throw new ErrorDeChat('Una encuesta no puede ir dentro de un hilo.')

  let hiloDe: number | null = null
  if (entrada.hiloDe !== undefined && entrada.hiloDe !== null) {
    hiloDe = Number(entrada.hiloDe)
    if (!esNumeroDeMensaje(hiloDe)) throw new ErrorDeChat('Ese hilo no es válido.')
    const { data: padre } = await service.from('chat_mensajes').select('id, hilo_de, borrado_en').eq('id', hiloDe).eq('canal_id', canal.id).maybeSingle()
    if (!padre || (padre as { hilo_de: number | null }).hilo_de !== null) throw new ErrorDeChat('Ese hilo no existe.', 404)
  }

  // Responder citando un mensaje de este mismo canal
  let respondeA: number | null = null
  let autorCitado: string | null = null
  if (entrada.respondeA !== undefined && entrada.respondeA !== null) {
    respondeA = Number(entrada.respondeA)
    if (!esNumeroDeMensaje(respondeA)) throw new ErrorDeChat('Ese mensaje no es válido.')
    const { data: citado, error: errorCita } = await service.from('chat_mensajes').select('id, autor_id, borrado_en').eq('id', respondeA).eq('canal_id', canal.id).maybeSingle()
    if (errorCita) fallo(errorCita, 'leer el mensaje citado')
    if (!citado || (citado as { borrado_en: string | null }).borrado_en) throw new ErrorDeChat('Ese mensaje ya no existe.', 404)
    autorCitado = (citado as { autor_id: string | null }).autor_id
  }

  const personas = await personasDelChat()
  const idsDeMiembros = new Set(miembros.map((m) => m.usuario_id))
  // En un canal privado o un directo solo se puede mencionar a quien está dentro; en uno abierto, a cualquiera con chat
  const mencionesExplicitas = extraerMenciones(cuerpo).filter((id) => id !== quien.userId && personas.some((p) => p.id === id) && (canal.tipo === 'canal' || idsDeMiembros.has(id)))
  // «@todos» nombra a cada miembro (y solo vale en canales: en un directo no tiene sentido)
  const menciones = mencionaATodos(cuerpo) && canal.tipo !== 'directo' ? [...new Set([...mencionesExplicitas, ...[...idsDeMiembros].filter((id) => id !== quien.userId)])] : mencionesExplicitas

  const fila: Record<string, unknown> = { canal_id: canal.id, autor_id: quien.userId, cuerpo, hilo_de: hiloDe, menciones, adjuntos }
  if (encuesta) fila.encuesta = encuesta
  if (respondeA !== null) fila.responde_a = respondeA
  const { data, error } = await service.from('chat_mensajes').insert(fila).select('*').single()
  if (error) {
    if (respondeA !== null && columnaNoExiste(error)) throw new ErrorDeChat('Falta lanzar la migración 285 en Supabase para poder responder a un mensaje.', 409)
    if (encuesta && faltaColumna(error)) throw new ErrorDeChat('Falta lanzar la migración 287 en Supabase para poder crear encuestas.', 409)
    fallo(error, 'guardar el mensaje')
  }
  const ahora = (data as FilaMensaje).creado_en
  // Lo que escribes lo das por leído; y el canal sube en la lista de todos
  await Promise.all([service.from('chat_canales').update({ ultimo_mensaje_en: ahora }).eq('id', canal.id), service.from('chat_miembros').update({ ultimo_leido_en: ahora }).eq('canal_id', canal.id).eq('usuario_id', quien.userId)])

  const mensaje = (await armarMensajes([data as FilaMensaje]))[0]
  void emitir([...idsDeMiembros], { tipo: 'mensaje', mensaje })
  void avisarDelMensaje(quien, canal, miembros, mensaje, personas, autorCitado)
  // Las notas de voz se transcriben por detrás (módulo aparte, que se carga al hacer falta)
  if (mensaje.adjuntos.some((a) => a.voz)) void import('./voz-servidor').then((m) => m.transcribirNotasDeVoz(mensaje.id)).catch((e) => console.error('Chat: no se ha podido transcribir la nota de voz:', e instanceof Error ? e.message : e))
  return mensaje
}

/**
 * A la campana (y al móvil, por el push que ya existe) llegan los avisos que cada persona ha pedido para ese canal (lib/chat/avisos.ts): por defecto, los directos, las menciones, las
 * respuestas a un mensaje suyo y lo que pasa en un hilo en el que está.
 */
async function avisarDelMensaje(quien: QuienEscribe, canal: FilaCanal, miembros: readonly FilaMiembro[], mensaje: MensajeChat, personas: readonly PersonaChat[], autorCitado: string | null): Promise<void> {
  try {
    const nombreDe = (id: string) => personas.find((p) => p.id === id)?.nombre.split(' ')[0] ?? 'alguien'
    const hayVoz = mensaje.adjuntos.some((a) => a.voz)
    const vista = mensaje.encuesta ? `📊 ${mensaje.encuesta.pregunta}` : hayVoz ? '🎤 Nota de voz' : textoPlano(mensaje.cuerpo, nombreDe, 140) || (mensaje.adjuntos.length > 0 ? '📎 Archivo adjunto' : '')
    const ventana = Math.floor(Date.now() / 600_000)
    const donde = canal.tipo === 'directo' ? '' : ` en #${nombreDeCanal(canal)}`

    // Quién está en el hilo: quien escribió el mensaje de arriba y quien ya ha respondido
    let enElHilo = new Set<string>()
    if (mensaje.hilo_de !== null) {
      const service = db()
      const [padre, respuestas] = await Promise.all([service.from('chat_mensajes').select('autor_id').eq('id', mensaje.hilo_de).maybeSingle(), service.from('chat_mensajes').select('autor_id').eq('hilo_de', mensaje.hilo_de).limit(300)])
      enElHilo = new Set([(padre.data as { autor_id: string | null } | null)?.autor_id, ...((respuestas.data ?? []) as Array<{ autor_id: string | null }>).map((r) => r.autor_id)].filter((x): x is string => Boolean(x)))
    }

    const datos = { app: 'chat', canalId: canal.id, mensajeId: mensaje.id }
    const filas: Array<Record<string, unknown>> = []
    for (const m of miembros) {
      if (m.usuario_id === quien.userId) continue
      const motivo = motivoDeAviso({ tipoDeCanal: canal.tipo, esDeHilo: mensaje.hilo_de !== null, estaEnElHilo: enElHilo.has(m.usuario_id), mencionada: mensaje.menciones.includes(m.usuario_id), citada: autorCitado === m.usuario_id, nivel: nivelDe(m, canal.tipo) })
      if (!motivo) continue
      const base = { user_id: m.usuario_id, message: vista, datos, read: false }
      if (motivo === 'mencion') filas.push({ ...base, type: 'mention', title: `${quien.nombre} te ha mencionado${donde}`, clave: `chat-m:${mensaje.id}` })
      else if (motivo === 'respuesta') filas.push({ ...base, type: 'mention', title: `${quien.nombre} te ha respondido${donde}`, clave: `chat-r:${mensaje.id}` })
      // Un solo aviso por hilo, por conversación o por canal cada diez minutos: si no, una charla rápida llenaría la campana
      else if (motivo === 'hilo') filas.push({ ...base, type: 'comment', title: `${quien.nombre} ha respondido en un hilo${canal.tipo === 'directo' ? '' : ` de #${nombreDeCanal(canal)}`}`, clave: `chat-h:${mensaje.hilo_de}:${ventana}` })
      else if (motivo === 'directo') filas.push({ ...base, type: 'comment', title: quien.nombre, clave: `chat-d:${canal.id}:${ventana}` })
      else filas.push({ ...base, type: 'comment', title: `${quien.nombre}${donde}`, clave: `chat-c:${canal.id}:${ventana}` })
    }
    if (filas.length > 0) {
      const { error } = await db().from('notifications').upsert(filas, { onConflict: 'user_id,clave', ignoreDuplicates: true })
      if (error) console.error('Chat: no se han podido escribir los avisos en la campana:', error.message)
    }
  } catch (e) {
    console.error('Chat: no se han podido escribir los avisos en la campana:', e instanceof Error ? e.message : e)
  }
}

async function mensajeDe(id: unknown): Promise<FilaMensaje> {
  const n = Number(id)
  if (!esNumeroDeMensaje(n)) throw new ErrorDeChat('Falta el mensaje.')
  const { data, error } = await db().from('chat_mensajes').select('*').eq('id', n).maybeSingle()
  if (error) fallo(error, 'leer el mensaje')
  if (!data) throw new ErrorDeChat('Ese mensaje no existe.', 404)
  return data as FilaMensaje
}

export async function editarMensaje(quien: QuienEscribe, id: unknown, cuerpoNuevo: unknown): Promise<MensajeChat> {
  const fila = await mensajeDe(id)
  if (fila.autor_id !== quien.userId) throw new ErrorDeChat('Solo puedes editar tus mensajes.', 403)
  if (fila.borrado_en) throw new ErrorDeChat('Ese mensaje ya está borrado.', 409)
  const cuerpo = limpiarCuerpo(cuerpoNuevo)
  if (!cuerpo && (fila.adjuntos ?? []).length === 0) throw new ErrorDeChat('El mensaje no puede quedar vacío: bórralo si ya no lo quieres.')
  if (!cuerpoValido(cuerpo)) throw new ErrorDeChat(`El mensaje es demasiado largo (máximo ${CUERPO_MAX} caracteres).`)
  const canal = await canalDe(fila.canal_id)
  const miembros = await exigirMiembro(quien, canal)
  const personas = await personasDelChat()
  const idsDeMiembros = new Set(miembros.map((m) => m.usuario_id))
  const menciones = extraerMenciones(cuerpo).filter((p) => p !== quien.userId && personas.some((x) => x.id === p) && (canal.tipo === 'canal' || idsDeMiembros.has(p)))
  const { data, error } = await db().from('chat_mensajes').update({ cuerpo, menciones, editado_en: new Date().toISOString() }).eq('id', fila.id).select('*').single()
  if (error) fallo(error, 'editar el mensaje')
  const mensaje = (await armarMensajes([data as FilaMensaje]))[0]
  void emitir([...idsDeMiembros], { tipo: 'editado', mensaje })
  return mensaje
}

export async function borrarMensaje(quien: QuienEscribe, id: unknown): Promise<{ ok: true }> {
  const fila = await mensajeDe(id)
  const canal = await canalDe(fila.canal_id)
  const miembros = await exigirVer(quien, canal)
  // Cada cual borra lo suyo; un administrador del ERP también puede quitar algo de un canal abierto
  const puede = fila.autor_id === quien.userId || (quien.esAdmin && canal.tipo === 'canal')
  if (!puede) throw new ErrorDeChat('Solo puedes borrar tus mensajes.', 403)
  if (fila.borrado_en) return { ok: true }
  const { error } = await db().from('chat_mensajes').update({ borrado_en: new Date().toISOString(), cuerpo: '', adjuntos: [], menciones: [] }).eq('id', fila.id)
  if (error) fallo(error, 'borrar el mensaje')
  await db().from('chat_reacciones').delete().eq('mensaje_id', fila.id)
  // Y los archivos que llevaba (si falla, quedan huérfanos en el almacén; no pasa nada grave)
  const rutas = (fila.adjuntos ?? []).map((a) => a.ruta).filter((r): r is string => Boolean(r))
  if (rutas.length > 0) void db().storage.from(ALMACEN_DE_ARCHIVOS).remove(rutas)
  void emitir(miembros.map((m) => m.usuario_id), { tipo: 'borrado', canalId: canal.id, id: fila.id })
  return { ok: true }
}

export async function reaccionar(quien: QuienEscribe, id: unknown, emoji: unknown): Promise<{ reacciones: Record<string, string[]> }> {
  if (typeof emoji !== 'string' || emoji.length < 1 || emoji.length > 16) throw new ErrorDeChat('Esa reacción no es válida.')
  const fila = await mensajeDe(id)
  if (fila.borrado_en) throw new ErrorDeChat('Ese mensaje está borrado.', 409)
  const canal = await canalDe(fila.canal_id)
  const miembros = await exigirMiembro(quien, canal)
  const service = db()
  const { data: previa } = await service.from('chat_reacciones').select('mensaje_id').eq('mensaje_id', fila.id).eq('usuario_id', quien.userId).eq('emoji', emoji).maybeSingle()
  const { error } = previa ? await service.from('chat_reacciones').delete().eq('mensaje_id', fila.id).eq('usuario_id', quien.userId).eq('emoji', emoji) : await service.from('chat_reacciones').insert({ mensaje_id: fila.id, usuario_id: quien.userId, emoji })
  if (error) fallo(error, 'guardar la reacción')
  const { data } = await service.from('chat_reacciones').select('usuario_id, emoji').eq('mensaje_id', fila.id)
  const reacciones: Record<string, string[]> = {}
  for (const r of (data ?? []) as Array<{ usuario_id: string; emoji: string }>) reacciones[r.emoji] = [...(reacciones[r.emoji] ?? []), r.usuario_id]
  void emitir(miembros.map((m) => m.usuario_id), { tipo: 'reaccion', canalId: canal.id, id: fila.id, reacciones })
  return { reacciones }
}

/* ------------------------------------------------------------------ */
/* Canales: crear y gestionar                                          */
/* ------------------------------------------------------------------ */

async function personasValidas(ids: unknown, excepto: string): Promise<string[]> {
  if (!Array.isArray(ids)) return []
  const todas = await personasDelChat()
  return [...new Set(ids.filter(esUuid))].filter((id) => id !== excepto && todas.some((p) => p.id === id)).slice(0, 200)
}

export async function crearCanal(quien: QuienEscribe, entrada: { tipo: unknown; nombre: unknown; descripcion?: unknown; miembros?: unknown; clienteId?: unknown; anuncios?: unknown }): Promise<{ canalId: string }> {
  if (entrada.tipo !== 'canal' && entrada.tipo !== 'privado') throw new ErrorDeChat('Elige si el canal es abierto o privado.')
  const nombre = normalizarNombreDeCanal(entrada.nombre)
  if (!nombre) throw new ErrorDeChat('Ponle un nombre al canal.')
  const descripcion = typeof entrada.descripcion === 'string' ? entrada.descripcion.trim().slice(0, 300) : ''
  const clienteId = esUuid(entrada.clienteId) ? entrada.clienteId : null
  const invitados = await personasValidas(entrada.miembros, quien.userId)
  const service = db()
  const fila: Record<string, unknown> = { tipo: entrada.tipo, nombre, descripcion, cliente_id: clienteId, creado_por: quien.userId }
  if (entrada.anuncios === true) fila.anuncios = true
  const { data, error } = await service.from('chat_canales').insert(fila).select('id').single()
  if (error) {
    if (entrada.anuncios === true && faltaColumna(error)) throw new ErrorDeChat('Falta lanzar la migración 287 en Supabase para crear canales de anuncios.', 409)
    if (error.code === '23505') throw new ErrorDeChat(`Ya existe un canal llamado «${nombre}».`, 409)
    fallo(error, 'crear el canal')
  }
  const canalId = (data as { id: string }).id
  const { error: errorMiembros } = await service.from('chat_miembros').insert([{ canal_id: canalId, usuario_id: quien.userId, rol: 'admin' }, ...invitados.map((u) => ({ canal_id: canalId, usuario_id: u }))])
  if (errorMiembros) fallo(errorMiembros, 'añadir los miembros')
  // Un canal abierto lo ve todo el equipo (en «Canales que puedes unirte»); uno privado, solo quien está dentro
  const destinatarios = entrada.tipo === 'canal' ? (await personasDelChat()).map((p) => p.id) : [quien.userId, ...invitados]
  void emitir(destinatarios, { tipo: 'canales' })
  return { canalId }
}

export async function abrirDirecto(quien: QuienEscribe, conId: unknown): Promise<{ canalId: string }> {
  if (!esUuid(conId) || conId === quien.userId) throw new ErrorDeChat('Elige a otra persona del equipo.')
  const personas = await personasDelChat()
  if (!personas.some((p) => p.id === conId)) throw new ErrorDeChat('Esa persona no tiene acceso al chat.', 404)
  const clave = claveDeDirecto(quien.userId, conId)
  const service = db()
  const buscar = async () => (await service.from('chat_canales').select('id').eq('dm_clave', clave).maybeSingle()).data as { id: string } | null
  let canal = await buscar()
  if (!canal) {
    const { data, error } = await service.from('chat_canales').insert({ tipo: 'directo', nombre: null, dm_clave: clave, creado_por: quien.userId }).select('id').single()
    // Dos personas que se abren a la vez: gana la primera y la otra se queda con la suya
    if (error) {
      if (error.code === '23505') canal = await buscar()
      else fallo(error, 'abrir el directo')
    } else canal = data as { id: string }
  }
  if (!canal) throw new ErrorDeChat('No se ha podido abrir la conversación.', 500)
  await service.from('chat_miembros').upsert([{ canal_id: canal.id, usuario_id: quien.userId }, { canal_id: canal.id, usuario_id: conId }], { onConflict: 'canal_id,usuario_id', ignoreDuplicates: true })
  void emitir([quien.userId, conId], { tipo: 'canales' })
  return { canalId: canal.id }
}

export async function unirse(quien: QuienEscribe, canalId: unknown): Promise<{ ok: true }> {
  const canal = await canalDe(canalId)
  if (canal.tipo !== 'canal') throw new ErrorDeChat('Solo se puede entrar solo a un canal abierto: a los privados te tiene que añadir alguien.', 403)
  await db().from('chat_miembros').upsert({ canal_id: canal.id, usuario_id: quien.userId }, { onConflict: 'canal_id,usuario_id', ignoreDuplicates: true })
  void emitir([quien.userId], { tipo: 'canales' })
  return { ok: true }
}

export async function salir(quien: QuienEscribe, canalId: unknown): Promise<{ ok: true }> {
  const canal = await canalDe(canalId)
  if (canal.tipo === 'directo') throw new ErrorDeChat('Una conversación directa no se abandona.')
  if (canal.auto_unirse) throw new ErrorDeChat('A este canal pertenece todo el equipo: puedes silenciarlo.')
  await db().from('chat_miembros').delete().eq('canal_id', canal.id).eq('usuario_id', quien.userId)
  void emitir([quien.userId], { tipo: 'canales' })
  return { ok: true }
}

export async function anadirMiembros(quien: QuienEscribe, canalId: unknown, ids: unknown): Promise<{ ok: true }> {
  const canal = await canalDe(canalId)
  if (canal.tipo === 'directo') throw new ErrorDeChat('A un directo no se añade a nadie: crea un canal privado.')
  const miembros = await exigirMiembro(quien, canal)
  const nuevos = (await personasValidas(ids, quien.userId)).filter((id) => !miembros.some((m) => m.usuario_id === id))
  if (nuevos.length > 0) {
    const { error } = await db().from('chat_miembros').upsert(nuevos.map((u) => ({ canal_id: canal.id, usuario_id: u })), { onConflict: 'canal_id,usuario_id', ignoreDuplicates: true })
    if (error) fallo(error, 'añadir los miembros')
    void emitir([...miembros.map((m) => m.usuario_id), ...nuevos], { tipo: 'canales' })
  }
  return { ok: true }
}

/** Cuánto te avisa este canal: `todo`, `menciones` o `nada` (null vuelve a lo de siempre) */
export async function cambiarAvisos(quien: QuienEscribe, canalId: unknown, nivel: unknown): Promise<{ ok: true }> {
  const canal = await canalDe(canalId)
  await exigirMiembro(quien, canal)
  const valor: NivelDeAvisos | null = esNivel(nivel) ? nivel : null
  const service = db()
  const filtro = { canal_id: canal.id, usuario_id: quien.userId }
  const { error } = await service.from('chat_miembros').update({ avisos: valor, silenciado: valor === 'nada' }).match(filtro)
  if (error) {
    // Sin la migración 287 solo se puede silenciar o no
    if (faltaColumna(error)) {
      if (valor === 'todo') throw new ErrorDeChat('Falta lanzar la migración 287 en Supabase para recibir avisos de todo el canal.', 409)
      await service.from('chat_miembros').update({ silenciado: valor === 'nada' }).match(filtro)
      return { ok: true }
    }
    fallo(error, 'cambiar los avisos')
  }
  return { ok: true }
}

export const silenciar = (quien: QuienEscribe, canalId: unknown, silenciado: unknown) => cambiarAvisos(quien, canalId, silenciado === true ? 'nada' : null)

export async function marcarLeido(quien: QuienEscribe, canalId: unknown): Promise<{ ok: true }> {
  if (!esUuid(canalId)) throw new ErrorDeChat('Falta el canal.')
  await db().from('chat_miembros').update({ ultimo_leido_en: new Date().toISOString() }).eq('canal_id', canalId).eq('usuario_id', quien.userId)
  return { ok: true }
}

export async function cambiarCanal(quien: QuienEscribe, canalId: unknown, cambios: { nombre?: unknown; descripcion?: unknown; archivar?: unknown; anuncios?: unknown }): Promise<{ ok: true }> {
  const canal = await canalDe(canalId)
  if (canal.tipo === 'directo') throw new ErrorDeChat('Una conversación directa no se cambia.')
  const miembros = await miembrosDe(canal.id)
  if (!puedeGestionar(quien, miembros)) throw new ErrorDeChat('Solo quien administra el canal (o un administrador) puede cambiarlo.', 403)
  const fila: Record<string, unknown> = {}
  if (cambios.nombre !== undefined) {
    const nombre = normalizarNombreDeCanal(cambios.nombre)
    if (!nombre) throw new ErrorDeChat('Ponle un nombre al canal.')
    fila.nombre = nombre
  }
  if (cambios.descripcion !== undefined) fila.descripcion = typeof cambios.descripcion === 'string' ? cambios.descripcion.trim().slice(0, 300) : ''
  if (typeof cambios.anuncios === 'boolean') {
    if (canal.auto_unirse && cambios.anuncios) throw new ErrorDeChat('El canal general no puede ser de anuncios.')
    fila.anuncios = cambios.anuncios
  }
  if (cambios.archivar === true) {
    if (canal.auto_unirse) throw new ErrorDeChat('El canal general no se archiva.')
    fila.archivado = true
  }
  if (Object.keys(fila).length === 0) return { ok: true }
  const { error } = await db().from('chat_canales').update(fila).eq('id', canal.id)
  if (error) {
    if (error.code === '23505') throw new ErrorDeChat('Ya existe un canal con ese nombre.', 409)
    if (faltaColumna(error)) throw new ErrorDeChat('Falta lanzar la migración 287 en Supabase para esta opción.', 409)
    fallo(error, 'cambiar el canal')
  }
  const destinatarios = canal.tipo === 'canal' ? (await personasDelChat()).map((p) => p.id) : miembros.map((m) => m.usuario_id)
  void emitir(destinatarios, { tipo: 'canales' })
  return { ok: true }
}


/** Los canales que esta persona puede leer: los abiertos y aquellos en los que está */
export async function canalesVisibles(quien: QuienEscribe): Promise<Array<{ id: string; tipo: TipoDeCanal; nombre: string | null }>> {
  const service = db()
  const { data: propios } = await service.from('chat_miembros').select('canal_id').eq('usuario_id', quien.userId)
  const ids = ((propios ?? []) as Array<{ canal_id: string }>).map((m) => m.canal_id)
  const consulta = service.from('chat_canales').select('id, tipo, nombre').eq('archivado', false)
  const { data, error } = await (ids.length > 0 ? consulta.or(`tipo.eq.canal,id.in.(${ids.join(',')})`) : consulta.eq('tipo', 'canal'))
  if (error) fallo(error, 'leer los canales')
  return (data ?? []) as Array<{ id: string; tipo: TipoDeCanal; nombre: string | null }>
}

export { armarMensajes, esNumeroDeMensaje, esUuid, mensajeDe }


/* ------------------------------------------------------------------ */
/* Encuestas y zona horaria                                            */
/* ------------------------------------------------------------------ */

export async function votar(quien: QuienEscribe, mensajeId: unknown, opcion: unknown): Promise<{ mensaje: MensajeChat }> {
  const fila = await mensajeDe(mensajeId)
  if (!fila.encuesta || fila.borrado_en) throw new ErrorDeChat('Ese mensaje no es una encuesta.', 404)
  if (fila.encuesta.cerrada) throw new ErrorDeChat('Esta encuesta ya está cerrada.', 409)
  const canal = await canalDe(fila.canal_id)
  const miembros = await exigirMiembro(quien, canal)
  const op = Number(opcion)
  if (!Number.isInteger(op) || op < 0 || op >= fila.encuesta.opciones.length) throw new ErrorDeChat('Esa opción no existe.')
  const service = db()
  const { data: mios, error } = await service.from('chat_votos').select('opcion').eq('mensaje_id', fila.id).eq('usuario_id', quien.userId)
  if (error) fallo(error, 'leer tus votos')
  const antes = ((mios ?? []) as Array<{ opcion: number }>).map((v) => v.opcion)
  const despues = votosTrasPulsar(fila.encuesta, antes, op)
  const quitar = antes.filter((o) => !despues.includes(o))
  const poner = despues.filter((o) => !antes.includes(o))
  if (quitar.length > 0) await service.from('chat_votos').delete().eq('mensaje_id', fila.id).eq('usuario_id', quien.userId).in('opcion', quitar)
  if (poner.length > 0) {
    const { error: errorAlPoner } = await service.from('chat_votos').insert(poner.map((o) => ({ mensaje_id: fila.id, usuario_id: quien.userId, opcion: o })))
    if (errorAlPoner) fallo(errorAlPoner, 'guardar tu voto')
  }
  const mensaje = (await armarMensajes([fila]))[0]
  void emitir(miembros.map((m) => m.usuario_id), { tipo: 'editado', mensaje })
  return { mensaje }
}

export async function cerrarEncuesta(quien: QuienEscribe, mensajeId: unknown): Promise<{ mensaje: MensajeChat }> {
  const fila = await mensajeDe(mensajeId)
  if (!fila.encuesta || fila.borrado_en) throw new ErrorDeChat('Ese mensaje no es una encuesta.', 404)
  if (fila.autor_id !== quien.userId && !quien.esAdmin) throw new ErrorDeChat('Solo quien la creó puede cerrarla.', 403)
  const canal = await canalDe(fila.canal_id)
  const miembros = await exigirVer(quien, canal)
  const { data, error } = await db().from('chat_mensajes').update({ encuesta: { ...fila.encuesta, cerrada: true } }).eq('id', fila.id).select('*').single()
  if (error) fallo(error, 'cerrar la encuesta')
  const mensaje = (await armarMensajes([data as FilaMensaje]))[0]
  void emitir(miembros.map((m) => m.usuario_id), { tipo: 'editado', mensaje })
  return { mensaje }
}

/** Tu zona horaria, para que los demás vean la hora que es allí */
export async function ponerZona(quien: QuienEscribe, zona: unknown): Promise<{ zona: string }> {
  if (!zonaValida(zona)) throw new ErrorDeChat('Esa zona horaria no está en la lista.')
  const { error } = await db().from('chat_perfiles').upsert({ usuario_id: quien.userId, zona, actualizado_en: new Date().toISOString() }, { onConflict: 'usuario_id' })
  if (error) {
    if (tablaNoExiste(error)) throw new ErrorDeChat('Falta lanzar la migración 287 en Supabase para guardar tu zona horaria.', 409)
    fallo(error, 'guardar la zona horaria')
  }
  cachePersonas = null
  return { zona }
}


/**
 * Cuánto hay sin leer en el chat, para el número de la barra del ERP (se pregunta cada minuto desde cualquier pantalla): mensajes de canales y directos con avisos activados, y las menciones
 * (que cuentan aunque el canal esté silenciado). Los canales archivados no cuentan.
 */
export async function resumenSinLeer(quien: QuienEscribe): Promise<{ mensajes: number; menciones: number }> {
  const service = db()
  const [resumen, miembros] = await Promise.all([service.rpc('chat_resumen', { p_usuario: quien.userId }), service.from('chat_miembros').select('canal_id, silenciado').eq('usuario_id', quien.userId)])
  if (resumen.error) fallo(resumen.error, 'contar lo que no has leído')
  const filas = (resumen.data ?? []) as Array<{ canal_id: string; no_leidos: number; menciones: number }>
  if (filas.length === 0) return { mensajes: 0, menciones: 0 }
  const silenciados = new Set(((miembros.data ?? []) as Array<{ canal_id: string; silenciado: boolean }>).filter((m) => m.silenciado).map((m) => m.canal_id))
  const { data: archivados } = await service.from('chat_canales').select('id').in('id', filas.map((f) => f.canal_id)).eq('archivado', true)
  const fuera = new Set(((archivados ?? []) as Array<{ id: string }>).map((c) => c.id))
  let mensajes = 0
  let menciones = 0
  for (const f of filas) {
    if (fuera.has(f.canal_id)) continue
    menciones += f.menciones
    if (!silenciados.has(f.canal_id)) mensajes += f.no_leidos
  }
  return { mensajes, menciones }
}
