/**
 * LOS CASOS DE CUMPLIMIENTO NORMATIVO — SERVIDOR.
 *
 * Alta, cambios y lectura de los casos de cada cliente (Tareas de clientes → «Cumplimiento»), y el enganche con el correo: cada vez que la app
 * Correo lee un buzón vigilado (de momento, business@), los correos nuevos que nombran el ID de un caso se cuelgan de él y se avisa en
 * #cumplimiento-normativo, una vez por correo. Las reglas (qué es un ID, cuándo un correo es de un caso) están en ./casos.ts y se prueban allí.
 *
 * Solo ve y toca los casos de los clientes que puede ver quien pregunta (lib/tareas-clientes/acceso.ts). Las tablas están cerradas al navegador.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { publicarEnCanal } from '@/lib/chat/sistema-servidor'
import { avisoDeCorreo, buzonVigilado, casosDelCorreo, esEstadoDeCaso, estadoTrasCorreoDeAmazon, nombraElCaso, normalizarIdDeCaso, ordenarCasos, type CasoTC, type CorreoDeCaso, type EstadoDeCaso } from './casos'
import { asuntoLimpio, correoEsencial, nombreDelRemitente } from './correo-esencial'
import { ErrorDeTareas } from './servidor'

type Servicio = ReturnType<typeof createServiceClient>
interface Actor {
  userId: string
  nombre: string
  clientes: ReadonlySet<string> | null
}

export const NOMBRE_DEL_CANAL = 'cumplimiento-normativo'
const FALTA_MIGRACION = 'Falta lanzar la migración 302 (casos de cumplimiento) en Supabase.'
const esUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v)

function revisar(error: { code?: string; message?: string } | null, que: string): void {
  if (!error) return
  if (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|schema cache/i.test(error.message ?? '')) throw new ErrorDeTareas(FALTA_MIGRACION, 409)
  console.error(`Casos: no se ha podido ${que}:`, error.message)
  throw new ErrorDeTareas(`No se ha podido ${que}.`, 500)
}

function exigirCliente(actor: Actor, clienteId: unknown): string {
  if (!esUuid(clienteId)) throw new ErrorDeTareas('Falta el cliente.')
  if (actor.clientes && !actor.clientes.has(clienteId)) throw new ErrorDeTareas('No tienes acceso a ese cliente.', 403)
  return clienteId
}

type FilaCaso = {
  id: string
  cliente_id: string
  caso_amazon: string
  titulo: string
  estado: EstadoDeCaso
  responsable: string | null
  notas: string
  creado_por: string | null
  creado_en: string
  actualizado_en: string
  ultimo_correo_en: string | null
}
const COLUMNAS = 'id, cliente_id, caso_amazon, titulo, estado, responsable, notas, creado_por, creado_en, actualizado_en, ultimo_correo_en'

const aCaso = (f: FilaCaso, correos: CorreoDeCaso[] = []): CasoTC => ({
  id: f.id,
  clienteId: f.cliente_id,
  casoAmazon: f.caso_amazon,
  titulo: f.titulo,
  estado: f.estado,
  responsable: f.responsable,
  notas: f.notas,
  creadoPor: f.creado_por,
  creadoEn: f.creado_en,
  actualizadoEn: f.actualizado_en,
  ultimoCorreoEn: f.ultimo_correo_en,
  correos,
})

async function casoPermitido(actor: Actor, id: unknown): Promise<FilaCaso> {
  if (!esUuid(id)) throw new ErrorDeTareas('Falta el caso.')
  const { data, error } = await createServiceClient().from('tc_casos').select(COLUMNAS).eq('id', id).maybeSingle()
  revisar(error, 'leer el caso')
  const f = data as FilaCaso | null
  if (!f || (actor.clientes && !actor.clientes.has(f.cliente_id))) throw new ErrorDeTareas('Ese caso no existe o no es de un cliente tuyo.', 404)
  return f
}

/* ------------------------------------------------------------------ */
/* Leer                                                                */
/* ------------------------------------------------------------------ */

export async function listarCasos(actor: Actor, clienteId: unknown): Promise<{ casos: CasoTC[]; vigilados: string[]; hayCanal: boolean }> {
  const id = exigirCliente(actor, clienteId)
  const service = createServiceClient()
  const { data, error } = await service.from('tc_casos').select(COLUMNAS).eq('cliente_id', id)
  revisar(error, 'leer los casos')
  const filas = (data ?? []) as FilaCaso[]
  const porCaso = new Map<string, CorreoDeCaso[]>()
  if (filas.length > 0) {
    const { data: enlaces, error: e2 } = await service
      .from('tc_casos_correos')
      .select('caso_id, correo_mensajes(id, de_nombre, de_direccion, asunto, fecha, texto, html, adjuntos)')
      .in('caso_id', filas.map((f) => f.id))
    revisar(e2, 'leer los correos de los casos')
    for (const e of (enlaces ?? []) as unknown as Array<{ caso_id: string; correo_mensajes: { id: string; de_nombre: string | null; de_direccion: string | null; asunto: string | null; fecha: string; texto: string | null; html: string | null; adjuntos: unknown } | null }>) {
      const m = e.correo_mensajes
      if (!m) continue
      const lista = porCaso.get(e.caso_id) ?? []
      // Quién lo mandó de verdad (Amazon, no quien lo reenvió desde business@) y el principio de lo que dice, sin la cabecera del reenvío
      const esencial = correoEsencial(m.texto, m.html)
      const de = esencial.remitenteOriginal ? nombreDelRemitente(esencial.remitenteOriginal) : m.de_nombre || m.de_direccion || '—'
      lista.push({ id: m.id, de, asunto: asuntoLimpio(m.asunto), fecha: m.fecha, vistaPrevia: esencial.parrafos.join(' ').replace(/\s+/g, ' ').slice(0, 220), adjuntos: Array.isArray(m.adjuntos) ? m.adjuntos.length : 0 })
      porCaso.set(e.caso_id, lista)
    }
    for (const l of porCaso.values()) l.sort((a, b) => b.fecha.localeCompare(a.fecha))
  }
  const [vigilados, canal] = await Promise.all([buzonesVigilados(service), canalDeAvisos(service)])
  return { casos: ordenarCasos(filas.map((f) => aCaso(f, porCaso.get(f.id) ?? []))), vigilados: vigilados.map((b) => b.direccion), hayCanal: canal !== null }
}

/** Los casos sin resolver de cada cliente que ve esta persona: para el contador de la tarjeta del cliente. Sin la migración, ninguno */
export async function resumenDeCasos(actor: Actor): Promise<Record<string, number>> {
  const { data, error } = await createServiceClient().from('tc_casos').select('cliente_id').neq('estado', 'resuelto')
  if (error) return {}
  const salida: Record<string, number> = {}
  for (const f of (data ?? []) as Array<{ cliente_id: string }>) {
    if (actor.clientes && !actor.clientes.has(f.cliente_id)) continue
    salida[f.cliente_id] = (salida[f.cliente_id] ?? 0) + 1
  }
  return salida
}

/** Un correo de un caso, entero, para la vista previa. Solo si de verdad está colgado de ese caso y el caso es de un cliente que ve */
export async function correoDeCaso(actor: Actor, casoId: unknown, mensajeId: unknown) {
  const caso = await casoPermitido(actor, casoId)
  if (!esUuid(mensajeId)) throw new ErrorDeTareas('Falta el correo.')
  const service = createServiceClient()
  const { data: enlace } = await service.from('tc_casos_correos').select('mensaje_id').eq('caso_id', caso.id).eq('mensaje_id', mensajeId).maybeSingle()
  if (!enlace) throw new ErrorDeTareas('Ese correo no es de este caso.', 404)
  const { data, error } = await service.from('correo_mensajes').select('id, de_nombre, de_direccion, para, cc, asunto, fecha, texto, html, adjuntos').eq('id', mensajeId).maybeSingle()
  revisar(error, 'leer el correo')
  if (!data) throw new ErrorDeTareas('El correo ya no está en el buzón.', 404)
  const m = data as { de_nombre: string | null; de_direccion: string | null; para: unknown; cc: unknown; asunto: string | null; fecha: string; texto: string | null; html: string | null; adjuntos: unknown }
  const esencial = correoEsencial(m.texto, m.html)
  const direcciones = (v: unknown) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : (x as { direccion?: string; address?: string })?.direccion ?? (x as { address?: string })?.address ?? '')).filter(Boolean) : [])
  return {
    correo: {
      de: m.de_nombre ? `${m.de_nombre} <${m.de_direccion ?? ''}>` : (m.de_direccion ?? ''),
      /** Quién lo mandó de verdad si era un reenvío (Amazon) */
      deOriginal: esencial.remitenteOriginal,
      para: direcciones(m.para),
      asunto: asuntoLimpio(m.asunto),
      fecha: m.fecha,
      /** Lo que dice, sin el diseño, la cabecera del reenvío, la encuesta, la firma ni el pie (lib/tareas-clientes/correo-esencial.ts) */
      parrafos: esencial.parrafos,
      html: m.html,
      texto: m.texto ?? '',
      adjuntos: Array.isArray(m.adjuntos) ? (m.adjuntos as Array<{ nombre?: string; filename?: string }>).map((a) => a?.nombre ?? a?.filename ?? 'adjunto') : [],
    },
  }
}

/* ------------------------------------------------------------------ */
/* Escribir                                                            */
/* ------------------------------------------------------------------ */

function textoValido(v: unknown, max: number, que: string, obligatorio: boolean): string {
  const t = typeof v === 'string' ? v.trim() : ''
  if (obligatorio && !t) throw new ErrorDeTareas(`Falta ${que}.`)
  if (t.length > max) throw new ErrorDeTareas(`${que.charAt(0).toUpperCase()}${que.slice(1)} es demasiado largo (máximo ${max}).`)
  return t
}

export async function crearCaso(actor: Actor, c: Record<string, unknown>): Promise<{ caso: CasoTC }> {
  const clienteId = exigirCliente(actor, c.clienteId)
  const casoAmazon = normalizarIdDeCaso(c.casoAmazon)
  if (!casoAmazon) throw new ErrorDeTareas('Escribe el ID del caso de Amazon: solo números, como aparece en Ayuda al vendedor (p. ej. 17123456781).')
  const titulo = textoValido(c.titulo, 300, 'el título', true)
  const notas = textoValido(c.notas, 5000, 'las notas', false)
  const estado: EstadoDeCaso = esEstadoDeCaso(c.estado) ? c.estado : 'abierto'
  const responsable = esUuid(c.responsable) ? c.responsable : null
  const service = createServiceClient()
  const { data, error } = await service.from('tc_casos').insert({ cliente_id: clienteId, caso_amazon: casoAmazon, titulo, notas, estado, responsable, creado_por: actor.userId }).select(COLUMNAS).single()
  if (error?.code === '23505') {
    const { data: otro } = await service.from('tc_casos').select('cliente_id, tc_clientes(nombre)').eq('caso_amazon', casoAmazon).maybeSingle()
    const nombre = (otro as { tc_clientes: { nombre: string } | null } | null)?.tc_clientes?.nombre
    throw new ErrorDeTareas(`El caso ${casoAmazon} ya está dado de alta${nombre ? ` en ${nombre}` : ''}.`, 409)
  }
  revisar(error, 'dar de alta el caso')
  const fila = data as FilaCaso
  // Los correos que ya habían llegado de este caso (el acuse de Amazon suele llegar antes de darlo de alta) se cuelgan sin avisar en el canal
  await enlazarCorreosAnteriores(service, fila).catch((e) => console.error('Casos: no se han podido buscar los correos anteriores:', e instanceof Error ? e.message : e))
  return { caso: (await listarCasos(actor, clienteId)).casos.find((x) => x.id === fila.id) ?? aCaso(fila) }
}

export async function cambiarCaso(actor: Actor, id: unknown, c: Record<string, unknown>): Promise<{ ok: true }> {
  const caso = await casoPermitido(actor, id)
  const cambios: Record<string, unknown> = { actualizado_en: new Date().toISOString() }
  if (c.titulo !== undefined) cambios.titulo = textoValido(c.titulo, 300, 'el título', true)
  if (c.notas !== undefined) cambios.notas = textoValido(c.notas, 5000, 'las notas', false)
  if (c.estado !== undefined) {
    if (!esEstadoDeCaso(c.estado)) throw new ErrorDeTareas('Ese estado no existe.')
    cambios.estado = c.estado
  }
  if (c.responsable !== undefined) cambios.responsable = esUuid(c.responsable) ? c.responsable : null
  if (c.casoAmazon !== undefined) {
    const nuevo = normalizarIdDeCaso(c.casoAmazon)
    if (!nuevo) throw new ErrorDeTareas('El ID del caso son solo números (p. ej. 17123456781).')
    cambios.caso_amazon = nuevo
  }
  const service = createServiceClient()
  const { error } = await service.from('tc_casos').update(cambios).eq('id', caso.id)
  if (error?.code === '23505') throw new ErrorDeTareas('Ese ID de caso ya lo tiene otro caso.', 409)
  revisar(error, 'guardar el caso')
  if (cambios.caso_amazon && cambios.caso_amazon !== caso.caso_amazon) {
    await enlazarCorreosAnteriores(service, { ...caso, caso_amazon: cambios.caso_amazon as string }).catch(() => undefined)
  }
  return { ok: true }
}

export async function borrarCaso(actor: Actor, id: unknown): Promise<{ ok: true }> {
  const caso = await casoPermitido(actor, id)
  const { error } = await createServiceClient().from('tc_casos').delete().eq('id', caso.id)
  revisar(error, 'borrar el caso')
  return { ok: true }
}

/* ------------------------------------------------------------------ */
/* Buzones y canal                                                     */
/* ------------------------------------------------------------------ */

async function elegidos(service: Servicio): Promise<string[]> {
  const { data } = await service.from('tc_casos_ajustes').select('buzones').eq('id', 1).maybeSingle()
  return ((data as { buzones: string[] } | null)?.buzones ?? []).filter(esUuid)
}

async function buzonesVigilados(service: Servicio): Promise<Array<{ id: string; direccion: string }>> {
  const [lista, ids] = await Promise.all([service.from('correo_buzones').select('id, direccion'), elegidos(service)])
  return ((lista.data ?? []) as Array<{ id: string; direccion: string }>).filter((b) => buzonVigilado(b, ids))
}

async function canalDeAvisos(service: Servicio): Promise<string | null> {
  const { data } = await service.from('chat_canales').select('id').eq('nombre', NOMBRE_DEL_CANAL).eq('archivado', false).limit(1).maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

/** Para la pantalla del administrador: qué buzones hay, cuáles se vigilan y si existe el canal */
export async function ajustesDeCasos(): Promise<{ buzones: Array<{ id: string; direccion: string; nombre: string | null; vigilado: boolean }>; elegidos: string[]; hayCanal: boolean }> {
  const service = createServiceClient()
  const [lista, ids, canal] = await Promise.all([service.from('correo_buzones').select('id, direccion, nombre').order('direccion'), elegidos(service), canalDeAvisos(service)])
  const buzones = ((lista.data ?? []) as Array<{ id: string; direccion: string; nombre: string | null }>).map((b) => ({ ...b, vigilado: buzonVigilado(b, ids) }))
  return { buzones, elegidos: ids, hayCanal: canal !== null }
}

export async function guardarAjustesDeCasos(esAdmin: boolean, buzones: unknown): Promise<{ ok: true }> {
  if (!esAdmin) throw new ErrorDeTareas('Los buzones que se vigilan los eligen los administradores.', 403)
  const ids = Array.isArray(buzones) ? [...new Set(buzones.filter(esUuid))].slice(0, 50) : []
  const { error } = await createServiceClient().from('tc_casos_ajustes').upsert({ id: 1, buzones: ids, actualizado_en: new Date().toISOString() })
  revisar(error, 'guardar los buzones')
  return { ok: true }
}

/* ------------------------------------------------------------------ */
/* El enganche con el correo                                           */
/* ------------------------------------------------------------------ */

async function enlazarCorreosAnteriores(service: Servicio, caso: Pick<FilaCaso, 'id' | 'caso_amazon'>): Promise<void> {
  const buzones = await buzonesVigilados(service)
  if (buzones.length === 0) return
  const { data } = await service
    .from('correo_mensajes')
    .select('id, asunto, texto, fecha')
    .in('buzon_id', buzones.map((b) => b.id))
    .or(`asunto.ilike.%${caso.caso_amazon}%,texto.ilike.%${caso.caso_amazon}%`)
    .order('fecha', { ascending: false })
    .limit(200)
  const suyos = ((data ?? []) as Array<{ id: string; asunto: string | null; texto: string | null; fecha: string }>).filter((m) => nombraElCaso(m.asunto, caso.caso_amazon) || nombraElCaso(m.texto, caso.caso_amazon))
  if (suyos.length === 0) return
  await service.from('tc_casos_correos').upsert(suyos.map((m) => ({ caso_id: caso.id, mensaje_id: m.id, avisado: true })), { onConflict: 'caso_id,mensaje_id', ignoreDuplicates: true })
  await service.from('tc_casos').update({ ultimo_correo_en: suyos[0].fecha }).eq('id', caso.id)
}

/**
 * Lo llama la lectura de un buzón (lib/correo/servidor.ts) en cuanto ha importado correos. Si el buzón se vigila, cuelga de su caso los correos
 * nuevos que lo nombran y avisa en #cumplimiento-normativo. Nunca lanza: si falla, el correo ya está leído y la próxima lectura no lo repite,
 * pero dar de alta el caso de nuevo (o cambiar su ID) lo vuelve a buscar.
 */
export async function enlazarCorreosNuevos(service: Servicio, buzon: { id: string; direccion: string }, desde: number): Promise<number> {
  try {
    if (!buzonVigilado(buzon, await elegidos(service))) return 0
    const { data: nuevos } = await service
      .from('correo_mensajes')
      .select('id, asunto, texto, de_nombre, de_direccion, fecha, vista_previa')
      .eq('buzon_id', buzon.id)
      .eq('direccion', 'entrante')
      .gt('creado_at', new Date(desde - 60_000).toISOString())
      .limit(200)
    const mensajes = (nuevos ?? []) as Array<{ id: string; asunto: string | null; texto: string | null; de_nombre: string | null; de_direccion: string | null; fecha: string; vista_previa: string | null }>
    if (mensajes.length === 0) return 0
    const { data: filas, error } = await service.from('tc_casos').select('id, cliente_id, caso_amazon, titulo, estado, tc_clientes(nombre)')
    if (error) return 0 // sin la migración 302 no hay casos que enlazar
    const casos = ((filas ?? []) as unknown as Array<{ id: string; cliente_id: string; caso_amazon: string; titulo: string; estado: EstadoDeCaso; tc_clientes: { nombre: string } | null }>).map((c) => ({ ...c, casoAmazon: c.caso_amazon }))
    if (casos.length === 0) return 0

    const canalId = await canalDeAvisos(service)
    let enlazados = 0
    for (const m of mensajes) {
      for (const caso of casosDelCorreo(m, casos)) {
        // Solo devuelve la fila si es NUEVA: así una relectura no avisa dos veces
        const { data: nueva } = await service.from('tc_casos_correos').upsert({ caso_id: caso.id, mensaje_id: m.id }, { onConflict: 'caso_id,mensaje_id', ignoreDuplicates: true }).select('caso_id')
        if (!nueva || nueva.length === 0) continue
        enlazados += 1
        // Amazon ha contestado: si se le estaba esperando (o el caso estaba completado), pasa a «Abierto», que nos toca
        const estado = estadoTrasCorreoDeAmazon(caso.estado)
        await service.from('tc_casos').update({ ultimo_correo_en: m.fecha, ...(estado !== caso.estado ? { estado, actualizado_en: new Date().toISOString() } : {}) }).eq('id', caso.id)
        caso.estado = estado
        if (!canalId) continue
        const cliente = caso.tc_clientes?.nombre ?? 'Cliente'
        await publicarEnCanal(canalId, {
          clave: `caso-correo:${caso.id}:${m.id}`,
          titulo: `${cliente} · caso ${caso.caso_amazon}`,
          cuerpo: avisoDeCorreo({ cliente, casoAmazon: caso.caso_amazon }),
        })
        await service.from('tc_casos_correos').update({ avisado: true }).eq('caso_id', caso.id).eq('mensaje_id', m.id)
      }
    }
    return enlazados
  } catch (e) {
    console.error('Casos: no se han podido enlazar los correos nuevos:', e instanceof Error ? e.message : e)
    return 0
  }
}
