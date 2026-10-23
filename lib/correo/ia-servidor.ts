import type { AmazonSupabase } from '@/lib/amazon/api'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import type { createServiceClient } from '@/lib/supabase/service'
import { COLUMNAS_A_LEER, type CorreoParaIa, type DatosDeLead, type LlamadaParaIa, type NotaParaIa } from './ia-contexto'
import { dominioDe, elegirGanadores, type EjemploGanador, type MensajeDeHilo } from './ia-ejemplos'

/**
 * LO QUE LA REDACCIÓN CON IA LEE Y ESCRIBE EN LA BASE — SOLO SERVIDOR.
 * ===================================================================
 * Dos clientes, cada uno para lo suyo:
 *
 *   · el de la SESIÓN de quien pide (`AmazonSupabase`, con RLS) para todo lo que es del lead: el lead, su historial y sus llamadas. Si esa
 *     persona no puede ver el lead (no es suyo y no supervisa) la base no devuelve nada y aquí no hay nada que redactar.
 *   · el de SERVICIO para lo que está cerrado al navegador: los correos (tablas correo_*) y el registro de borradores.
 *
 * LOS CORREOS PREVIOS CON EL LEAD SON SOLO DEL BUZÓN PROPIO. El permiso de Correo es «cada uno lee el suyo»: si la IA metiera en el
 * contexto lo que otro comercial le escribió a esta empresa, le estaría enseñando a quien redacta un correo que no puede abrir.
 * Los EJEMPLOS sí vienen de los buzones de todo el equipo (es lo que se pidió: aprender de lo que dicen los demás), pero solo el primer
 * correo frío de cada hilo con respuesta, ya limpio de nombres, correos, teléfonos y dinero (ia-ejemplos.ts), nunca lo que contestó el cliente.
 *
 * LA TABLA DE BORRADORES ES OPCIONAL: si la migración 242 no está lanzada, redactar funciona igual y simplemente no se apunta nada.
 */

type Servicio = ReturnType<typeof createServiceClient>

/** Los errores de la base llegan como objetos sueltos, no como `Error`: se envuelven para no perder el código */
const fallo = (mensaje: string, causa: unknown): Error => new Error(mensaje, { cause: causa })

/* ------------------------------------------------------------------ */
/* El lead y su historial (con la sesión de quien pide)                */
/* ------------------------------------------------------------------ */

export type LeadCargado = DatosDeLead & { id: string }

/** Las direcciones de correo de un lead, en minúsculas y sin repetir: las de `email` y las de `emails_extra` */
export function direccionesDeLead(lead: Record<string, unknown>): string[] {
  const vistas = new Set<string>()
  for (const campo of [lead.email, lead.emails_extra]) {
    if (typeof campo !== 'string') continue
    for (const e of campo.split(/[\s/,;]+/)) if (e.includes('@')) vistas.add(e.toLowerCase())
  }
  return [...vistas]
}

export async function cargarLead(sesion: AmazonSupabase, leadId: string): Promise<LeadCargado | null> {
  const { data, error } = await sesion.from('cold_leads').select(COLUMNAS_A_LEER).eq('id', leadId).maybeSingle()
  if (error) throw fallo('No se ha podido leer el lead.', error)
  return (data as unknown as LeadCargado | null) ?? null
}

export async function cargarNotas(sesion: AmazonSupabase, leadId: string): Promise<NotaParaIa[]> {
  const { data, error } = await sesion.from('cold_lead_notes').select('kind, body, occurred_at, es_respuesta').eq('lead_id', leadId).order('occurred_at', { ascending: false }).limit(20)
  if (error) throw fallo('No se ha podido leer el historial del lead.', error)
  return (data ?? []) as NotaParaIa[]
}

export async function cargarLlamadas(sesion: AmazonSupabase, leadId: string): Promise<LlamadaParaIa[]> {
  const { data, error } = await sesion.from('rinkel_llamadas').select('fecha, direccion, duracion_s, estado').eq('lead_id', leadId).order('fecha', { ascending: false }).limit(30)
  // Las llamadas son un extra: sin la tabla o sin permiso se redacta igual
  if (error) return []
  return (data ?? []) as LlamadaParaIa[]
}

/* ------------------------------------------------------------------ */
/* Los correos que ya se han cruzado con el lead (solo el buzón propio) */
/* ------------------------------------------------------------------ */

export async function cargarCorreosDelLead(service: Servicio, buzonId: string, direcciones: readonly string[]): Promise<CorreoParaIa[]> {
  if (direcciones.length === 0) return []
  const { data: hilos, error } = await service
    .from('correo_hilos')
    .select('id')
    .eq('buzon_id', buzonId)
    .overlaps('participantes', [...direcciones])
    .order('ultimo_mensaje_at', { ascending: false })
    .limit(5)
  if (error) throw fallo('No se han podido leer los hilos con este lead.', error)
  const ids = ((hilos ?? []) as Array<{ id: string }>).map((h) => h.id)
  if (ids.length === 0) return []
  const { data, error: errorMensajes } = await service.from('correo_mensajes').select('direccion, fecha, asunto, texto, automatico').in('hilo_id', ids).order('fecha', { ascending: false }).limit(12)
  if (errorMensajes) throw fallo('No se han podido leer los correos con este lead.', errorMensajes)
  return ((data ?? []) as Array<CorreoParaIa & { automatico: boolean }>).filter((m) => !m.automatico).map(({ direccion, fecha, asunto, texto }) => ({ direccion, fecha, asunto, texto }))
}

/* ------------------------------------------------------------------ */
/* Los correos del equipo que funcionaron                              */
/* ------------------------------------------------------------------ */

const DURACION_DE_LA_CACHE_MS = 10 * 60_000
/** Cuántos hilos con respuesta se miran, los más recientes. Sobra: solo un 5 % de los correos fríos obtiene respuesta */
const HILOS_A_MIRAR = 300
const HILOS_POR_CONSULTA = 80

let cache: { hasta: number; valor: EjemploGanador[] } | null = null
let enCurso: Promise<EjemploGanador[]> | null = null

async function leerGanadores(service: Servicio): Promise<EjemploGanador[]> {
  const { data: buzones, error } = await service.from('correo_buzones').select('direccion, nombre')
  if (error) throw fallo('No se han podido leer los buzones.', error)
  const lista = (buzones ?? []) as Array<{ direccion: string; nombre: string | null }>
  const dominiosPropios = new Set(lista.map((b) => dominioDe(b.direccion)).filter(Boolean))
  // Las direcciones también valen como nombre («maoli@…»): quien firma «Maoli» sale de ahí aunque el buzón no tenga nombre
  const nombresDelEquipo = lista.flatMap((b) => [b.nombre ?? '', b.direccion.split('@')[0]]).filter(Boolean)

  const { data: hilos, error: errorHilos } = await service
    .from('correo_hilos')
    .select('id')
    .gte('entrantes', 1)
    .gte('salientes', 1)
    .eq('automatico', false)
    .order('ultimo_mensaje_at', { ascending: false })
    .limit(HILOS_A_MIRAR)
  if (errorHilos) throw fallo('No se han podido leer los hilos con respuesta.', errorHilos)
  const ids = ((hilos ?? []) as Array<{ id: string }>).map((h) => h.id)

  const mensajes: MensajeDeHilo[] = []
  for (let i = 0; i < ids.length; i += HILOS_POR_CONSULTA) {
    const { data, error: errorMensajes } = await service
      .from('correo_mensajes')
      .select('hilo_id, buzon_id, direccion, de_direccion, fecha, automatico, asunto, texto')
      .in('hilo_id', ids.slice(i, i + HILOS_POR_CONSULTA))
    if (errorMensajes) throw fallo('No se han podido leer los correos con respuesta.', errorMensajes)
    for (const m of (data ?? []) as Array<{ hilo_id: string; buzon_id: string; direccion: 'entrante' | 'saliente'; de_direccion: string; fecha: string; automatico: boolean; asunto: string; texto: string }>) {
      mensajes.push({ hiloId: m.hilo_id, buzonId: m.buzon_id, direccion: m.direccion, deDireccion: m.de_direccion, fecha: m.fecha, automatico: m.automatico, asunto: m.asunto, texto: m.texto })
    }
  }
  return elegirGanadores(mensajes, { dominiosPropios, nombresDelEquipo, max: 8, porBuzon: 3 })
}

/**
 * Los correos ganadores del equipo. Se recalculan como mucho cada 10 minutos (leen unos miles de correos) y varias peticiones a la vez
 * comparten la misma lectura. Si la lectura falla se devuelve lo último que hubo, o nada: redactar sin ejemplos sigue funcionando.
 */
export async function cargarGanadores(service: Servicio, ahora = Date.now()): Promise<EjemploGanador[]> {
  if (cache && cache.hasta > ahora) return cache.valor
  if (enCurso) return enCurso
  enCurso = leerGanadores(service)
    .then((valor) => {
      cache = { hasta: Date.now() + DURACION_DE_LA_CACHE_MS, valor }
      return valor
    })
    .catch((error) => {
      console.warn('[correo-ia] no se han podido leer los correos ganadores', { mensaje: error instanceof Error ? error.message : 'desconocido', codigo: (error?.cause as { code?: string } | undefined)?.code ?? null })
      return cache?.valor ?? []
    })
    .finally(() => {
      enCurso = null
    })
  return enCurso
}

/** Solo para las pruebas */
export function olvidarGanadores(): void {
  cache = null
  enCurso = null
}

/* ------------------------------------------------------------------ */
/* El registro de borradores (opcional: migración 242)                 */
/* ------------------------------------------------------------------ */

/** Cuántas redacciones lleva una persona en la última hora y en el último día: cada una cuesta unos céntimos de IA */
export const LIMITE_POR_HORA = 40
export const LIMITE_POR_DIA = 150

export async function redaccionesRecientes(service: Servicio, userId: string, ahora = Date.now()): Promise<{ hora: number; dia: number } | null> {
  const contar = async (desde: number): Promise<number | null> => {
    const { count, error } = await service.from('correo_ia_borradores').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('creado_at', new Date(desde).toISOString())
    return error ? null : (count ?? 0)
  }
  const [hora, dia] = await Promise.all([contar(ahora - 3_600_000), contar(ahora - 86_400_000)])
  // Sin la tabla no se puede contar: no se limita (mejor redactar de más que dejar la herramienta muerta por un SQL sin lanzar)
  return hora === null || dia === null ? null : { hora, dia }
}

export interface FilaDeBorrador {
  user_id: string
  lead_id: string
  buzon_id: string
  modelo: string
  angulo: string
  asunto: string
  texto: string
  indicaciones: string | null
  ejemplos: number
  /** La versión de la IA que lo escribió (migración 243). null = la de siempre */
  version_id?: string | null
}

/**
 * Apunta un borrador. Devuelve su id, o null si no se ha podido (tabla sin crear): el correo sale igual.
 * Si la columna `version_id` no existe (la 243 sin lanzar) se apunta igualmente, sin ella: perder la versión es mejor que perder el borrador.
 */
export async function guardarBorrador(service: Servicio, fila: FilaDeBorrador): Promise<string | null> {
  const insertar = (f: Omit<FilaDeBorrador, 'version_id'> & { version_id?: string | null }) => service.from('correo_ia_borradores').insert(f).select('id').single()
  let { data, error } = await insertar(fila)
  if (error && fila.version_id !== undefined && isMissingSchema(error)) {
    const { version_id: _sinVersion, ...sinVersion } = fila
    ;({ data, error } = await insertar(sinVersion))
  }
  if (error) {
    console.warn('[correo-ia] no se ha podido apuntar el borrador', { codigo: (error as { code?: string }).code ?? null })
    return null
  }
  return (data as { id: string }).id
}

/** Marca un borrador como enviado y guarda lo que salió de verdad (el comercial lo habrá editado). Nunca lanza: el correo ya salió */
export async function marcarBorradorEnviado(service: Servicio, datos: { id: string; userId: string; hiloId: string; asunto: string; texto: string }): Promise<void> {
  try {
    const { error } = await service
      .from('correo_ia_borradores')
      .update({ enviado_at: new Date().toISOString(), hilo_id: datos.hiloId, asunto_final: datos.asunto.slice(0, 500), texto_final: datos.texto.slice(0, 20000) })
      .eq('id', datos.id)
      .eq('user_id', datos.userId)
      .is('enviado_at', null)
    if (error) console.warn('[correo-ia] no se ha podido marcar el borrador como enviado', { codigo: (error as { code?: string }).code ?? null })
  } catch (error) {
    console.warn('[correo-ia] fallo al marcar el borrador como enviado', { mensaje: error instanceof Error ? error.message : 'desconocido' })
  }
}
