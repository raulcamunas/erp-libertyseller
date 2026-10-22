import type { createServiceClient } from '@/lib/supabase/service'
import {
  diagnosticar,
  indiceDeTelefonos,
  planearVinculos,
  type Diagnostico,
  type LeadParaVincular,
  type LlamadaParaVincular,
  type ParDeVinculo,
} from './vinculos'

/**
 * ENLAZAR LLAMADAS CON LEADS Y COMPROBAR QUE SE ENLAZAN — SOLO SERVIDOR.
 * ======================================================================
 * Une la regla pura de vinculos.ts con la base. Se comprueba con vinculos-servidor.prueba.ts contra una base falsa.
 *
 * Todo corre con la clave de servicio: enlazar toca llamadas de todos los comerciales y el diagnóstico las lee todas.
 * Quién puede pedirlo lo decide la ruta (app/api/cold-calling/vinculos), no esto.
 *
 *
 * ============ CUÁNDO SE CUENTA UNA LLAMADA EN SU LEAD ============
 *
 * El trigger de la migración 237 suma el intento, pone el último contacto y pasa «Sin contactar» a «No contesta» cuando
 * una llamada se enlaza con un lead. Pero una llamada de hace tres meses que se enlaza hoy porque se ha corregido un
 * teléfono NO debe contar: el comercial ya la apuntó a mano cuando ocurrió. Por eso el repaso reparte los pares en dos:
 *
 *   · RECIENTES (las de los últimos DIAS_RECIENTE días): se enlazan y se cuentan, una vez. Es el caso normal: llamó
 *     ayer a un número que todavía no estaba en Cold Calling y hoy el lead ya existe.
 *   · HISTÓRICAS: se enlazan SIN contarse, para que salgan en el historial del lead pero no inflen sus intentos.
 */

type Servicio = ReturnType<typeof createServiceClient>

/**
 * Los códigos con que PostgREST y Postgres dicen «esa tabla, columna o función no existe»: la migración no está lanzada.
 * Es la misma lista que isMissingSchema (lib/plataforma/eventos.ts), repetida aquí a propósito: importarla arrastra el
 * cliente de Supabase entero, y este módulo se carga en pruebas que no lo necesitan.
 */
const CODIGOS_DE_ESQUEMA_AUSENTE: ReadonlySet<unknown> = new Set(['PGRST205', '42P01', 'PGRST204', '42703', 'PGRST202', '42883'])
const faltaElEsquema = (error: unknown): boolean => CODIGOS_DE_ESQUEMA_AUSENTE.has((error as { code?: unknown } | null)?.code)

const PAGINA_DE_BASE = 1000
const PARES_POR_LOTE = 500

/** Una llamada enlazada tarde cuenta en su lead si es de los últimos días; más vieja, solo se enlaza */
export const DIAS_RECIENTE = 14
const DIA_MS = 86_400_000

/** Pide una tabla entera en páginas de 1.000: PostgREST corta ahí cada consulta y un .limit() mayor no lo salta */
async function enPaginas<T>(pedir: (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const todas: T[] = []
  for (let desde = 0; ; desde += PAGINA_DE_BASE) {
    const { data, error } = await pedir(desde, desde + PAGINA_DE_BASE - 1)
    if (error) throw new Error('No se han podido leer los datos.', { cause: error })
    const filas = (data ?? []) as T[]
    todas.push(...filas)
    if (filas.length < PAGINA_DE_BASE) break
  }
  return todas
}

const COLUMNAS_DE_LEAD = 'id, assigned_to, phone, telefonos_extra, status, last_contacted_at, store_name'
const COLUMNAS_DE_LLAMADA = 'id, user_id, fecha, direccion, numero, lead_id'

/** Los leads con lo mínimo para casar teléfonos. De una persona, o de todas si no se dice */
export async function leerLeadsParaVincular(service: Servicio, usuario?: string): Promise<LeadParaVincular[]> {
  return enPaginas<LeadParaVincular>((desde, hasta) => {
    let consulta = service.from('cold_leads').select(COLUMNAS_DE_LEAD)
    if (usuario) consulta = consulta.eq('assigned_to', usuario)
    return consulta.order('id', { ascending: true }).range(desde, hasta)
  })
}

interface OpcionesDeLlamadas {
  usuario?: string
  /** Solo las posteriores a esta fecha (ISO) */
  desde?: string
  /** Solo las que no tienen lead y llegaron con número: las únicas que un repaso puede enlazar */
  soloSinLead?: boolean
}

export async function leerLlamadasParaVincular(service: Servicio, op: OpcionesDeLlamadas = {}): Promise<LlamadaParaVincular[]> {
  return enPaginas<LlamadaParaVincular>((desde, hasta) => {
    let consulta = service.from('rinkel_llamadas').select(COLUMNAS_DE_LLAMADA)
    if (op.usuario) consulta = consulta.eq('user_id', op.usuario)
    if (op.desde) consulta = consulta.gte('fecha', op.desde)
    if (op.soloSinLead) consulta = consulta.is('lead_id', null).not('numero', 'is', null)
    // Orden con desempate por id: un orden con empates puede repetir una fila en dos páginas y saltarse otra
    return consulta.order('fecha', { ascending: false }).order('id', { ascending: true }).range(desde, hasta)
  })
}

/* ------------------------------------------------------------------ */
/* El repaso                                                           */
/* ------------------------------------------------------------------ */

export interface ResultadoDelRepaso {
  /** Llamadas sin lead que se miraron */
  revisadas: number
  /** Cuántas se han enlazado en total */
  enlazadas: number
  /** De ellas, las que además se han contado en su lead (recientes) */
  contadas: number
  /** Las anteriores a DIAS_RECIENTE: enlazadas sin contar */
  historicas: number
  /** Falta lanzar la migración 237 (no existe cold_vincular_llamadas): no se ha enlazado nada */
  faltaMigracion: boolean
}

export interface OpcionesDelRepaso {
  /** De una persona, o de todas si no se dice */
  usuario?: string
  /** Hasta cuántos días atrás se mira. null = todo el histórico */
  dias: number | null
  /** Los leads ya leídos, si quien llama los tiene a mano. Si no, se leen aquí (y solo si hay llamadas que casar) */
  leads?: LeadParaVincular[]
  ahora?: () => number
}

async function enlazarLote(service: Servicio, pares: ParDeVinculo[], historico: boolean): Promise<{ n: number; falta: boolean }> {
  let n = 0
  for (let i = 0; i < pares.length; i += PARES_POR_LOTE) {
    const lote = pares.slice(i, i + PARES_POR_LOTE).map((p) => ({ llamada: p.llamada, lead: p.lead }))
    const { data, error } = await service.rpc('cold_vincular_llamadas', { p_pares: lote, p_historico: historico })
    if (error) {
      if (faltaElEsquema(error)) return { n, falta: true }
      throw new Error('No se han podido enlazar las llamadas con sus leads.', { cause: error })
    }
    n += Number(data) || 0
  }
  return { n, falta: false }
}

export async function repasarVinculos(service: Servicio, op: OpcionesDelRepaso): Promise<ResultadoDelRepaso> {
  const ahora = (op.ahora ?? Date.now)()
  const desde = op.dias === null ? undefined : new Date(ahora - op.dias * DIA_MS).toISOString()

  const llamadas = await leerLlamadasParaVincular(service, { usuario: op.usuario, desde, soloSinLead: true })
  const vacio: ResultadoDelRepaso = { revisadas: llamadas.length, enlazadas: 0, contadas: 0, historicas: 0, faltaMigracion: false }
  if (llamadas.length === 0) return vacio

  const leads = op.leads ?? (await leerLeadsParaVincular(service, op.usuario))
  const pares = planearVinculos(llamadas, indiceDeTelefonos(leads))
  if (pares.length === 0) return vacio

  const limite = ahora - DIAS_RECIENTE * DIA_MS
  const recientes = pares.filter((p) => Date.parse(p.fecha) >= limite)
  const historicas = pares.filter((p) => Date.parse(p.fecha) < limite)

  const r = await enlazarLote(service, recientes, false)
  if (r.falta) return { ...vacio, faltaMigracion: true }
  const h = await enlazarLote(service, historicas, true)
  if (h.falta) return { ...vacio, enlazadas: r.n, contadas: r.n, faltaMigracion: true }
  return { revisadas: llamadas.length, enlazadas: r.n + h.n, contadas: r.n, historicas: h.n, faltaMigracion: false }
}

/**
 * El repaso tras cada lectura de Rinkel, SIN ir a la base más de una vez cada tanto por persona: una pasada se hace cada
 * pocos minutos y el repaso solo cambia algo cuando alguien ha creado un lead o corregido un teléfono. No es crítico: si
 * falla se registra y la lectura de llamadas sigue su camino.
 */
const ENTRE_REPASOS_MS = 30 * 60_000
const ultimoRepaso = new Map<string, number>()

export async function repasarTrasLeer(service: Servicio, usuario: string, leads?: LeadParaVincular[], ahora: () => number = Date.now): Promise<ResultadoDelRepaso | null> {
  const t = ahora()
  const anterior = ultimoRepaso.get(usuario)
  if (anterior !== undefined && t - anterior < ENTRE_REPASOS_MS) return null
  ultimoRepaso.set(usuario, t)
  try {
    return await repasarVinculos(service, { usuario, dias: DIAS_RECIENTE, leads, ahora })
  } catch (error) {
    const e = error as { message?: unknown; cause?: { code?: unknown } } | null
    console.error('Cold Calling · el repaso de llamadas sin lead ha fallado', { mensaje: typeof e?.message === 'string' ? e.message : 'sin mensaje', codigo: e?.cause?.code ?? null })
    // Que se vuelva a intentar en la próxima lectura y no dentro de media hora
    ultimoRepaso.delete(usuario)
    return null
  }
}

/** Solo para las pruebas: olvidar cuándo se repasó a cada persona */
export function olvidarRepasos(): void {
  ultimoRepaso.clear()
}

/* ------------------------------------------------------------------ */
/* El diagnóstico                                                      */
/* ------------------------------------------------------------------ */

export interface RespuestaDelDiagnostico {
  diagnostico: Diagnostico
  /** ¿Está lanzada la migración 237? Sin ella las llamadas se enlazan pero no se cuentan en el lead */
  migracion237: boolean
}

/** ¿Existe rinkel_llamadas.efecto_aplicado? Es lo que añade la migración 237 */
export async function migracion237Lanzada(service: Servicio): Promise<boolean> {
  const { error } = await service.from('rinkel_llamadas').select('efecto_aplicado').limit(1)
  if (!error) return true
  if (faltaElEsquema(error)) return false
  throw new Error('No se ha podido comprobar la migración.', { cause: error })
}

export async function diagnosticoDeVinculos(service: Servicio): Promise<RespuestaDelDiagnostico> {
  const [leads, llamadas, migracion237] = await Promise.all([
    leerLeadsParaVincular(service),
    leerLlamadasParaVincular(service),
    migracion237Lanzada(service),
  ])

  // Los nombres de quienes llamaron, para decir «Maoli» y no un uuid
  const ids = [...new Set(llamadas.map((l) => l.user_id))]
  const nombres = new Map<string, string>()
  if (ids.length > 0) {
    const { data } = await service.from('profiles').select('id, full_name, email').in('id', ids)
    for (const p of (data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) nombres.set(p.id, p.full_name?.trim() || p.email || 'Sin nombre')
  }

  return { diagnostico: diagnosticar(llamadas, leads, (id) => nombres.get(id) ?? 'Sin nombre'), migracion237 }
}
