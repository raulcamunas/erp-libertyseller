/**
 * AMAZON ADS · EL LOG DE CAMBIOS DE UNA CUENTA (ads_cambios_log). SOLO SERVIDOR.
 *
 * Cada cosa que se crea, se cambia, se descarta, se deshace o se ensaya queda aquí: quién, cuándo, antes y después, el motivo y —desde la migración 311— la
 * propuesta de la que sale, el id de lo tocado en Amazon (keywordId, targetId, campaignId…), la petición y la respuesta de la API con su código y su
 * request id. Sin la 311 se escribe lo de antes (se detecta la primera vez y se recuerda).
 */

import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { condicionDeCursor, cursorATexto, finDeDia, textoDeBusqueda, type CursorDeLog, type FiltrosDeLog, type OrigenDeLog } from './log-calculo'
import { enEnsayo, origenDelRastro, propuestaDelRastro, recortarParaLog, tomarLlamadasNuevas, type LlamadaAds } from './rastro'

export type { OrigenDeLog } from './log-calculo'

export interface EntradaDeLog {
  id: string
  creadoAt: string
  origen: OrigenDeLog
  entidad: string
  accion: string
  campo: string | null
  valorAnterior: string | null
  valorNuevo: string | null
  motivo: string | null
  nombreCampana: string | null
  campaignId: string | null
  productoId: string | null
  ok: boolean
  error: string | null
  usuario: string | null
  usuarioId: string | null
  /** Migración 311 (null sin ella) */
  propuestaId: string | null
  entidadId: string | null
  peticion: unknown
  respuesta: unknown
  httpStatus: number | null
  requestId: string | null
}

export interface NuevaEntradaDeLog {
  perfilId: string
  productoId?: string | null
  campaignId?: string | null
  nombreCampana?: string | null
  entidad: 'campaña' | 'grupo' | 'anuncio' | 'keyword' | 'target' | 'negativa' | 'motor' | 'ficha' | 'propuesta'
  accion: 'crear' | 'cambiar' | 'pausar' | 'activar' | 'archivar' | 'negativizar' | 'promover' | 'descartar' | 'deshacer' | 'firmar' | 'quitar-firma' | 'reclamar'
  campo?: string | null
  valorAnterior?: string | null
  valorNuevo?: string | null
  motivo?: string | null
  origen: OrigenDeLog
  ok?: boolean
  error?: string | null
  userId?: string | null
  propuestaId?: string | null
  entidadId?: string | null
  /** Las llamadas a Amazon del rastro (lib/ads/rastro.ts): de aquí salen la petición, la respuesta, el código y el request id */
  llamadas?: readonly LlamadaAds[]
}

/** null = sin comprobar; false = sin la migración 311 (se escribe sin las columnas nuevas) */
let hay311: boolean | null = null
/** Sin la 311 el origen «ensayo» no pasa el CHECK: se apunta como «manual» con «[ENSAYO]» delante del motivo */
let admiteEnsayo: boolean | null = null
/** Sin la 315 el origen «agente» no pasa el CHECK: se apunta como «automatico» con «[AGENTE]» delante del motivo */
let admiteAgente: boolean | null = null

const faltaColumna = (e: { code?: string; message?: string } | null) => !!e && (e.code === 'PGRST204' || e.code === '42703' || (isMissingSchema(e) && /propuesta_id|entidad_id|peticion|respuesta|http_status|request_id/.test(e.message ?? '')))

/** PURO. De las llamadas del rastro a las columnas del log. Si hay varias, todas (en una lista); el código y el request id, los de la última */
export function columnasDeLlamadas(llamadas: readonly LlamadaAds[] | undefined): { peticion: unknown; respuesta: unknown; http_status: number | null; request_id: string | null } {
  if (!llamadas || llamadas.length === 0) return { peticion: null, respuesta: null, http_status: null, request_id: null }
  const ultima = llamadas[llamadas.length - 1]
  const peticion = llamadas.map((l) => ({ metodo: l.metodo, ruta: l.ruta, cuerpo: recortarParaLog(l.cuerpo, 2000), ...(l.simulada ? { simulada: true } : {}) }))
  const respuesta = llamadas.map((l) => ({ status: l.status, requestId: l.requestId, ms: l.ms, cuerpo: recortarParaLog(l.respuesta, 2000) }))
  return { peticion: peticion.length === 1 ? peticion[0] : peticion, respuesta: respuesta.length === 1 ? respuesta[0] : respuesta, http_status: ultima.status, request_id: ultima.requestId }
}

/**
 * Apunta un cambio en el log. NUNCA LANZA: que no se pueda escribir el rastro no puede deshacer ni esconder lo que ya se hizo en Amazon. Reintenta una vez
 * y, si aun así falla, lo deja en el registro del servidor. Devuelve si se ha guardado (para que quien llama pueda avisar de un cambio sin rastro).
 */
export async function anotarCambio(entrada: NuevaEntradaDeLog): Promise<boolean> {
  // Dentro de un rastro (rastro.ts): las llamadas a Amazon que aún no tienen entrada, la propuesta que se aplica y, en ensayo, el origen «ensayo» siempre.
  // En un rastro del agente PPC, lo «automático» que se apunte dentro (la pausa de segmentaciones.ts, el guardado de la propuesta…) es del agente
  const e: NuevaEntradaDeLog = {
    ...entrada,
    llamadas: entrada.llamadas ?? tomarLlamadasNuevas(),
    propuestaId: entrada.propuestaId ?? propuestaDelRastro(),
    origen: enEnsayo() ? 'ensayo' : entrada.origen === 'automatico' && origenDelRastro() === 'agente' ? 'agente' : entrada.origen,
  }
  const esEnsayo = e.origen === 'ensayo'
  const esAgente = e.origen === 'agente'
  const base = {
    perfil_id: e.perfilId,
    producto_id: e.productoId ?? null,
    campaign_id: e.campaignId ?? null,
    nombre_campana: e.nombreCampana ?? null,
    entidad: e.entidad,
    accion: e.accion,
    campo: e.campo ?? null,
    valor_anterior: e.valorAnterior ?? null,
    valor_nuevo: e.valorNuevo ?? null,
    motivo: e.motivo ?? null,
    origen: esEnsayo && admiteEnsayo === false ? 'manual' : esAgente && admiteAgente === false ? 'automatico' : e.origen,
    ok: e.ok ?? true,
    // Con la 311 la respuesta completa va en «respuesta»; el texto del error se recorta menos que antes
    error: e.error ? e.error.slice(0, 2000) : null,
    // `||`, no `??`: un usuario '' (UUID vacía) daba 22P02 y la entrada se PERDÍA (pasaba en cada pausa automática)
    usuario_id: e.userId || null,
  }
  if (esEnsayo && admiteEnsayo === false) base.motivo = `[ENSAYO] ${base.motivo ?? ''}`.trim()
  if (esAgente && admiteAgente === false) base.motivo = `[AGENTE] ${base.motivo ?? ''}`.trim()
  const extra = { propuesta_id: e.propuestaId ?? null, entidad_id: e.entidadId ?? null, ...columnasDeLlamadas(e.llamadas) }

  for (let intento = 0; intento < 3; intento += 1) {
    try {
      const fila = hay311 === false ? base : { ...base, ...extra }
      const { error } = await createServiceClient().from('ads_cambios_log').insert(fila)
      if (!error) {
        if (hay311 === null && fila !== base) hay311 = true
        return true
      }
      if (faltaColumna(error) && hay311 !== false) {
        hay311 = false
        continue
      }
      // 23514 = el CHECK de origen todavía no admite «ensayo» (falta la 311)
      if (error.code === '23514' && esEnsayo && base.origen === 'ensayo') {
        admiteEnsayo = false
        base.origen = 'manual'
        base.motivo = `[ENSAYO] ${base.motivo ?? ''}`.trim()
        continue
      }
      // 23514 = el CHECK de origen todavía no admite «agente» (falta la 315)
      if (error.code === '23514' && esAgente && base.origen === 'agente') {
        admiteAgente = false
        base.origen = 'automatico'
        base.motivo = `[AGENTE] ${base.motivo ?? ''}`.trim()
        continue
      }
      if (intento === 2) console.error('Ads: no se ha podido anotar el cambio en el log:', error.message, JSON.stringify(base).slice(0, 500))
    } catch (err) {
      if (intento === 2) console.error('Ads: no se ha podido anotar el cambio en el log:', err instanceof Error ? err.message : err, JSON.stringify(base).slice(0, 500))
    }
  }
  return false
}

/** Varias entradas de una vez (descartar en lote): UN insert en vez de uno por propuesta. Mismo trato que anotarCambio: nunca lanza */
export async function anotarEnLote(entradas: readonly NuevaEntradaDeLog[]): Promise<boolean> {
  if (entradas.length === 0) return true
  const filas = entradas.map((e) => ({
    perfil_id: e.perfilId,
    producto_id: e.productoId ?? null,
    campaign_id: e.campaignId ?? null,
    nombre_campana: e.nombreCampana ?? null,
    entidad: e.entidad,
    accion: e.accion,
    campo: e.campo ?? null,
    valor_anterior: e.valorAnterior ?? null,
    valor_nuevo: e.valorNuevo ?? null,
    motivo: e.motivo ?? null,
    origen: e.origen === 'ensayo' ? 'manual' : e.origen === 'agente' && admiteAgente === false ? 'automatico' : e.origen,
    ok: e.ok ?? true,
    error: e.error ? e.error.slice(0, 2000) : null,
    usuario_id: e.userId || null,
    propuesta_id: e.propuestaId ?? null,
    entidad_id: e.entidadId ?? null,
  }))
  try {
    for (let i = 0; i < filas.length; i += 500) {
      const trozo = filas.slice(i, i + 500)
      let { error } = await createServiceClient().from('ads_cambios_log').insert(hay311 === false ? trozo.map(({ propuesta_id: _p, entidad_id: _e, ...resto }) => resto) : trozo)
      if (error && faltaColumna(error)) {
        hay311 = false
        ;({ error } = await createServiceClient().from('ads_cambios_log').insert(trozo.map(({ propuesta_id: _p, entidad_id: _e, ...resto }) => resto)))
      }
      // Sin la 315 el origen «agente» no pasa el CHECK: el lote se reintenta como «automatico» con «[AGENTE]» en el motivo
      if (error && error.code === '23514' && trozo.some((f) => f.origen === 'agente')) {
        admiteAgente = false
        const respaldo = trozo.map((f) => (f.origen === 'agente' ? { ...f, origen: 'automatico', motivo: `[AGENTE] ${f.motivo ?? ''}`.trim() } : f))
        ;({ error } = await createServiceClient().from('ads_cambios_log').insert(hay311 === false ? respaldo.map(({ propuesta_id: _p, entidad_id: _e, ...resto }) => resto) : respaldo))
      }
      if (error) {
        console.error('Ads: no se ha podido anotar el lote en el log:', error.message)
        return false
      }
    }
    return true
  } catch (err) {
    console.error('Ads: no se ha podido anotar el lote en el log:', err instanceof Error ? err.message : err)
    return false
  }
}

const COLUMNAS_BASE = 'id, creado_at, origen, entidad, accion, campo, valor_anterior, valor_nuevo, motivo, nombre_campana, campaign_id, producto_id, ok, error, usuario_id'
const COLUMNAS_311 = `${COLUMNAS_BASE}, propuesta_id, entidad_id, peticion, respuesta, http_status, request_id`

async function nombresDe(ids: string[]): Promise<Map<string, string>> {
  const nombres = new Map<string, string>()
  if (ids.length === 0) return nombres
  const { data: ps } = await createServiceClient().from('profiles').select('id, full_name').in('id', ids)
  for (const p of (ps ?? []) as Array<{ id: string; full_name: string | null }>) if (p.full_name) nombres.set(p.id, p.full_name)
  return nombres
}

function deFila(f: Record<string, unknown>, nombres: Map<string, string>, conDetalle: boolean): EntradaDeLog {
  return {
    id: f.id as string,
    creadoAt: f.creado_at as string,
    origen: f.origen as OrigenDeLog,
    entidad: f.entidad as string,
    accion: f.accion as string,
    campo: (f.campo as string | null) ?? null,
    valorAnterior: (f.valor_anterior as string | null) ?? null,
    valorNuevo: (f.valor_nuevo as string | null) ?? null,
    motivo: (f.motivo as string | null) ?? null,
    nombreCampana: (f.nombre_campana as string | null) ?? null,
    campaignId: (f.campaign_id as string | null) ?? null,
    productoId: (f.producto_id as string | null) ?? null,
    ok: f.ok as boolean,
    error: (f.error as string | null) ?? null,
    usuarioId: (f.usuario_id as string | null) ?? null,
    usuario: f.usuario_id ? (nombres.get(f.usuario_id as string) ?? null) : null,
    propuestaId: (f.propuesta_id as string | null) ?? null,
    entidadId: (f.entidad_id as string | null) ?? null,
    peticion: conDetalle ? (f.peticion ?? null) : null,
    respuesta: conDetalle ? (f.respuesta ?? null) : null,
    httpStatus: f.http_status == null ? null : Number(f.http_status),
    requestId: (f.request_id as string | null) ?? null,
  }
}

/** Las últimas entradas (lo de siempre: «Copiar para el Log del cliente» y quien no necesita filtros) */
export async function leerLog(perfilId: string, opciones: { productoId?: string | null; origen?: string | null; limite?: number } = {}): Promise<EntradaDeLog[]> {
  const pagina = await leerLogPaginado(perfilId, { desde: null, hasta: null, campaignId: null, productoId: opciones.productoId ?? null, usuarioId: null, propuestaId: null, origen: (opciones.origen as OrigenDeLog | null) ?? null, soloFallos: false, busqueda: null }, null, Math.min(Math.max(opciones.limite ?? 200, 1), 500), false)
  return pagina.entradas
}

export interface PaginaDeLog {
  entradas: EntradaDeLog[]
  /** El cursor de la página siguiente; null = no hay más */
  siguiente: string | null
}

/**
 * Una página del log con filtros, en orden (creado_at, id) descendente. La paginación es por CURSOR (la última fila vista), no por desplazamiento: no se salta
 * ni repite filas aunque entren cambios nuevos mientras se mira. `conDetalle` trae la petición y la respuesta de Amazon (pesan: solo para el CSV o el detalle).
 */
export async function leerLogPaginado(perfilId: string, f: FiltrosDeLog, cursor: CursorDeLog | null, porPagina = 50, conDetalle = false): Promise<PaginaDeLog> {
  const limite = Math.min(Math.max(porPagina, 1), 1000)
  const consultar = async (columnas: string) => {
    let q = createServiceClient().from('ads_cambios_log').select(columnas).eq('perfil_id', perfilId)
    if (f.desde) q = q.gte('creado_at', `${f.desde}T00:00:00Z`)
    if (f.hasta) q = q.lt('creado_at', finDeDia(f.hasta))
    if (f.campaignId) q = q.eq('campaign_id', f.campaignId)
    if (f.productoId) q = q.eq('producto_id', f.productoId)
    if (f.usuarioId) q = q.eq('usuario_id', f.usuarioId)
    if (f.origen) q = q.eq('origen', f.origen)
    if (f.soloFallos) q = q.eq('ok', false)
    if (f.propuestaId && columnas === COLUMNAS_311) q = q.eq('propuesta_id', f.propuestaId)
    // La búsqueda y el cursor son dos «o»: van en UN solo .or() con un and() dentro (dos parámetros or= en la misma consulta no se combinan bien en PostgREST)
    const t = f.busqueda ? textoDeBusqueda(f.busqueda) : ''
    const busqueda = t ? `campo.ilike.*${t}*,valor_anterior.ilike.*${t}*,valor_nuevo.ilike.*${t}*,motivo.ilike.*${t}*,nombre_campana.ilike.*${t}*,error.ilike.*${t}*` : null
    const despues = cursor ? condicionDeCursor(cursor) : null
    if (busqueda && despues) q = q.or(`and(or(${busqueda}),or(${despues}))`)
    else if (busqueda || despues) q = q.or((busqueda ?? despues) as string)
    return q.order('creado_at', { ascending: false }).order('id', { ascending: false }).limit(limite + 1)
  }
  let r = await consultar(hay311 === false ? COLUMNAS_BASE : COLUMNAS_311)
  if (r.error && faltaColumna(r.error)) {
    hay311 = false
    r = await consultar(COLUMNAS_BASE)
  }
  if (r.error) throw r.error
  const filas = (r.data ?? []) as unknown as Array<Record<string, unknown>>
  const hayMas = filas.length > limite
  const pagina = hayMas ? filas.slice(0, limite) : filas
  const nombres = await nombresDe([...new Set(pagina.map((x) => x.usuario_id as string | null).filter((x): x is string => !!x))])
  const entradas = pagina.map((x) => deFila(x, nombres, conDetalle))
  const ultima = entradas[entradas.length - 1]
  return { entradas, siguiente: hayMas && ultima ? cursorATexto({ creadoAt: ultima.creadoAt, id: ultima.id }) : null }
}

/** Las personas que aparecen en el log de la cuenta (para el filtro «Persona»): de las últimas 2.000 entradas, que es de sobra */
export async function personasDelLog(perfilId: string): Promise<Array<{ id: string; nombre: string }>> {
  const { data, error } = await createServiceClient().from('ads_cambios_log').select('usuario_id').eq('perfil_id', perfilId).not('usuario_id', 'is', null).order('creado_at', { ascending: false }).limit(2000)
  if (error) throw error
  const ids = [...new Set(((data ?? []) as Array<{ usuario_id: string }>).map((r) => r.usuario_id))]
  const nombres = await nombresDe(ids)
  return ids.map((id) => ({ id, nombre: nombres.get(id) ?? 'Sin nombre' })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

/** UNA entrada con su detalle (la petición y la respuesta de Amazon), para abrirla en la pantalla */
export async function leerEntrada(perfilId: string, id: string): Promise<EntradaDeLog | null> {
  const consultar = (columnas: string) => createServiceClient().from('ads_cambios_log').select(columnas).eq('perfil_id', perfilId).eq('id', id).maybeSingle()
  let r = await consultar(hay311 === false ? COLUMNAS_BASE : COLUMNAS_311)
  if (r.error && faltaColumna(r.error)) {
    hay311 = false
    r = await consultar(COLUMNAS_BASE)
  }
  if (r.error) throw r.error
  if (!r.data) return null
  const f = r.data as unknown as Record<string, unknown>
  const nombres = await nombresDe(f.usuario_id ? [f.usuario_id as string] : [])
  return deFila(f, nombres, true)
}
