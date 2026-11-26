import type { SupabaseClient } from '@supabase/supabase-js'
import type { ColdLead } from '@/lib/types/cold-leads'

/**
 * TRAER LA CARTERA DE LEADS, RÁPIDO.
 * ==================================
 * Sirve igual desde el servidor (con la sesión de quien mira) que desde el navegador, que es de donde se pide hoy: Cold Calling se queda
 * montada al cambiar de aplicación y pide su cartera ella misma, una vez por sesión. Se comprueba con cargar.prueba.ts.
 *
 * POR QUÉ NO SE PIDE ENTERA DE UNA VEZ. PostgREST corta cualquier consulta a 1.000 filas (el ajuste max-rows) y un .limit() mayor
 * no lo salta: la cartera hay que pedirla por tramos. Antes se pedían uno tras otro —con la cartera de todos los comerciales, unas
 * 6.000 filas, eran seis viajes a la base seguidos antes de pintar nada—. Ahora:
 *
 *   1. El primer tramo se pide con el recuento (`count: 'exact'`): una sola petición da las primeras 1.000 filas Y cuántas hay.
 *   2. Los tramos que faltan se piden A LA VEZ (con un tope de peticiones simultáneas para no abrir treinta de golpe).
 *
 * El orden es por `id` y nada más: solo decide en qué tramo cae cada fila, y tiene que ser determinista, porque con un orden con
 * empates una misma fila puede aparecer en dos tramos y otra en ninguno. El orden de pantalla lo pone cartera.ts.
 *
 * SOLO SE PIDE LO QUE SE PINTA en la lista y lo que sirve para buscar y filtrar. Los campos largos (directivos, dirección,
 * registro mercantil, URL del seller…) son de la ficha y se piden al abrir el lead.
 */

export const COLUMNAS_DE_CARTERA_SIN_PARTNERS = [
  'id', 'store_name', 'company', 'phone', 'email', 'province', 'category', 'seller_url', 'web', 'ciudad',
  'tipo_lead', 'vende_en_amazon', 'tipo_empresa', 'nivel', 'revenue_monthly', 'ventas_estimadas_usd',
  'assigned_to', 'status', 'follow_up', 'next_call_date', 'last_contacted_at', 'call_attempts', 'source_list',
].join(', ')

/**
 * LO QUE HACE FALTA PARA PINTAR UN PARTNER (migración 262): su prioridad y puntos (la fila, el orden y los filtros) y su valoración y si menciona Amazon (la tabla). Los enlaces largos
 * —LinkedIn, Google Maps— y las búsquedas de origen son de la ficha y se piden al abrir el lead, como los demás campos largos.
 */
export const COLUMNAS_DE_PARTNERS = ['prioridad', 'puntos', 'resenas', 'rating', 'menciona_amazon'].join(', ')

/**
 * EN QUÉ COMUNIDAD AUTÓNOMA ESTÁ EL LEAD (migración 263): lo que hace falta para saber si hoy es festivo para él. La comunidad (dos letras) vale para casi todos; el municipio
 * (cinco cifras) solo cuenta para las islas de Canarias y el Valle de Arán (lib/festivos/). El origen y la confianza de la deducción son de la ficha y se piden al abrir el lead.
 */
export const COLUMNAS_DE_UBICACION = ['ccaa', 'municipio_ine'].join(', ')

/** Con los partners (262) pero sin la ubicación (263): lo que se pide mientras la 263 no esté lanzada */
export const COLUMNAS_DE_CARTERA_SIN_UBICACION = `${COLUMNAS_DE_CARTERA_SIN_PARTNERS}, ${COLUMNAS_DE_PARTNERS}`

/** Con los partners (262) y la ubicación (263) pero sin el ciclo comercial (264): lo que se pide mientras la 264 no esté lanzada */
export const COLUMNAS_DE_CARTERA_SIN_CICLO = `${COLUMNAS_DE_CARTERA_SIN_UBICACION}, ${COLUMNAS_DE_UBICACION}`

/**
 * EL CICLO COMERCIAL (migración 264): a qué lead se le aplica (`ciclo_vuelta`) y en qué punto del ritmo va (`ciclo_fase`). Son las dos que hacen falta para pintar las cajas de una lista de ciclo y
 * sus recuentos; no hay nada más del ciclo en la lista.
 */
export const COLUMNAS_DE_CICLO = ['ciclo_vuelta', 'ciclo_fase'].join(', ')

/** Con el ciclo (264) pero sin el análisis de Amazon (303): lo que se pide mientras la 303 no esté lanzada */
export const COLUMNAS_DE_CARTERA_SIN_ANALISIS = `${COLUMNAS_DE_CARTERA_SIN_CICLO}, ${COLUMNAS_DE_CICLO}`

/** EL ANÁLISIS DE AMAZON (migración 303): cuándo se hizo su informe de Keepa. Basta para la casilla «Con informe» y la marca en la lista */
export const COLUMNAS_DE_ANALISIS = 'analisis_amazon_at'

export const COLUMNAS_DE_CARTERA = `${COLUMNAS_DE_CARTERA_SIN_ANALISIS}, ${COLUMNAS_DE_ANALISIS}`

/** De la más completa a la de antes de todo: si la base no tiene las columnas de una migración, se pide la siguiente (la de antes de la 303, la 264, la 263 y la 262) */
export const NIVELES_DE_COLUMNAS = [COLUMNAS_DE_CARTERA, COLUMNAS_DE_CARTERA_SIN_ANALISIS, COLUMNAS_DE_CARTERA_SIN_CICLO, COLUMNAS_DE_CARTERA_SIN_UBICACION, COLUMNAS_DE_CARTERA_SIN_PARTNERS] as const

/**
 * ¿La base no tiene esas columnas? El código se despliega ANTES de que nadie lance la migración a mano en el editor SQL de Supabase, y un `select` que nombra una columna que no existe no
 * degrada: PostgREST contesta 400 y la cartera de TODO el equipo se quedaría vacía por unas columnas que todavía no tienen ni un dato. Por eso se piden primero con ellas y, si la base no las
 * tiene, se repite con el nivel de antes (NIVELES_DE_COLUMNAS: en cuanto se lancen las migraciones 262, 263 y 264 deja de hacer falta, y no se nota). PGRST204: PostgREST no la tiene en su caché de
 * esquema. 42703: Postgres dice que no existe.
 */
export function faltanLasColumnasDePartners(error: unknown): boolean {
  const codigo = (error as { code?: unknown } | null)?.code
  return codigo === 'PGRST204' || codigo === '42703'
}

export const FILAS_POR_TRAMO = 1000
/** Cuántos tramos se piden a la vez. Con 6.000 leads son seis; con 27.000, no se abren veintisiete conexiones juntas */
export const TRAMOS_A_LA_VEZ = 6

export type ClienteDeLectura = Pick<SupabaseClient, 'from'>

export interface OpcionesDeCarga {
  /** El comercial cuya cartera se pide. Sin él, todo lo que quien mira pueda ver (la RLS decide) */
  propietario?: string
  /** Se llama cada vez que llega un tramo, con lo cargado hasta ahora y el total */
  alProgreso?: (cargados: number, total: number) => void
}

export interface ResultadoDeCarga {
  leads: ColdLead[]
  /** Cuántos hay en total según la base. Si es mayor que leads.length, algún tramo falló */
  total: number
  /** true si algún tramo falló: lo que se ha cargado es una cartera INCOMPLETA y la pantalla tiene que decirlo */
  incompleta: boolean
  /** Lo que contestó la base cuando falló (código y mensaje), para enseñarlo en el aviso y saber qué pasa sin abrir la consola */
  motivo?: string | null
}

/** Si un tramo de 1.000 falla (tiempo agotado, conexión justa), se vuelve a pedir en trozos de este tamaño antes de darlo por perdido (26 nov 2026: a Daniela no le llegaba la cartera) */
export const FILAS_POR_TRAMO_PEQUENO = 250

export function motivoDeError(e: unknown): string {
  const x = (e ?? {}) as { code?: unknown; message?: unknown; status?: unknown }
  const partes = [x.code, x.status, x.message].filter((v) => v != null && String(v).trim() !== '').map(String)
  return partes.length ? partes.join(' · ').slice(0, 200) : 'sin respuesta de la base (conexión cortada o tiempo agotado)'
}

type Respuesta = { data: unknown; error: unknown; count?: number | null }

function pedirTramo(supabase: ClienteDeLectura, propietario: string | undefined, desde: number, conRecuento: boolean, columnas: string, filas = FILAS_POR_TRAMO): PromiseLike<Respuesta> {
  let consulta = supabase.from('cold_leads').select(columnas, conRecuento ? { count: 'exact' } : undefined)
  if (propietario) consulta = consulta.eq('assigned_to', propietario)
  return consulta.order('id', { ascending: true }).range(desde, desde + filas - 1) as unknown as PromiseLike<Respuesta>
}

/** Un tramo de 1.000 que ha fallado, pedido otra vez en trozos pequeños y de uno en uno. null + el error si tampoco así */
async function tramoEnTrozos(supabase: ClienteDeLectura, propietario: string | undefined, desde: number, columnas: string): Promise<{ filas: ColdLead[] | null; error?: unknown }> {
  const filas: ColdLead[] = []
  for (let d = desde; d < desde + FILAS_POR_TRAMO; d += FILAS_POR_TRAMO_PEQUENO) {
    const r = await pedirTramo(supabase, propietario, d, false, columnas, FILAS_POR_TRAMO_PEQUENO)
    if (r.error) return { filas: null, error: r.error }
    const trozo = (r.data ?? []) as unknown as ColdLead[]
    filas.push(...trozo)
    if (trozo.length < FILAS_POR_TRAMO_PEQUENO) break
  }
  return { filas }
}

export async function cargarCartera(supabase: ClienteDeLectura, op: OpcionesDeCarga = {}): Promise<ResultadoDeCarga> {
  let nivel = 0
  let primero = await pedirTramo(supabase, op.propietario, 0, true, NIVELES_DE_COLUMNAS[nivel])
  while (primero.error && faltanLasColumnasDePartners(primero.error) && nivel < NIVELES_DE_COLUMNAS.length - 1) {
    // La base todavía no tiene la migración 264 (o la 263, o la 262): se pide como antes de ella. Lo aprendido vale para el resto de tramos de esta lectura
    nivel++
    primero = await pedirTramo(supabase, op.propietario, 0, true, NIVELES_DE_COLUMNAS[nivel])
  }
  const columnas = NIVELES_DE_COLUMNAS[nivel]
  let motivo: string | null = null
  if (primero.error) {
    motivo = motivoDeError(primero.error)
    console.error('Cold Calling · ha fallado el primer tramo de la cartera; se reintenta en trozos', { motivo })
    // Antes se daba por perdida la cartera entera. Ahora: el recuento aparte (sin columnas, ligero) y el primer tramo en trozos pequeños
    let recuento = supabase.from('cold_leads').select('id', { count: 'exact', head: true })
    if (op.propietario) recuento = recuento.eq('assigned_to', op.propietario)
    const [c, t] = await Promise.all([recuento as unknown as PromiseLike<Respuesta>, tramoEnTrozos(supabase, op.propietario, 0, columnas)])
    if (!t.filas) {
      motivo = motivoDeError(t.error)
      console.error('Cold Calling · no se ha podido leer la cartera', { motivo })
      return { leads: [], total: 0, incompleta: true, motivo }
    }
    primero = { data: t.filas, error: null, count: c.error ? null : (c.count ?? null) }
  }
  const filas = (primero.data ?? []) as unknown as ColdLead[]
  if (primero.count == null && filas.length >= FILAS_POR_TRAMO) {
    // Sin recuento (el primer tramo vino en trozos y el recuento tampoco llegó): se sigue de tramo en tramo hasta uno que venga corto
    const leads: ColdLead[] = [...filas]
    for (let desde = FILAS_POR_TRAMO; ; desde += FILAS_POR_TRAMO) {
      const r = await pedirTramo(supabase, op.propietario, desde, false, columnas)
      const t = r.error ? await tramoEnTrozos(supabase, op.propietario, desde, columnas) : { filas: (r.data ?? []) as unknown as ColdLead[] }
      if (!t.filas) {
        motivo = motivoDeError(t.error ?? r.error)
        return { leads, total: leads.length, incompleta: true, motivo }
      }
      leads.push(...t.filas)
      op.alProgreso?.(leads.length, leads.length)
      if (t.filas.length < FILAS_POR_TRAMO) break
    }
    return { leads, total: leads.length, incompleta: false, motivo: null }
  }
  const total = Math.max(primero.count ?? filas.length, filas.length)
  const leads: ColdLead[] = [...filas]
  op.alProgreso?.(leads.length, total)

  const desdes: number[] = []
  for (let desde = FILAS_POR_TRAMO; desde < total; desde += FILAS_POR_TRAMO) desdes.push(desde)

  const tramos = new Map<number, ColdLead[]>()
  let incompleta = false
  for (let i = 0; i < desdes.length; i += TRAMOS_A_LA_VEZ) {
    const grupo = desdes.slice(i, i + TRAMOS_A_LA_VEZ)
    const respuestas = await Promise.all(grupo.map((d) => pedirTramo(supabase, op.propietario, d, false, columnas)))
    for (let j = 0; j < respuestas.length; j++) {
      const r = respuestas[j]
      if (!r.error) {
        tramos.set(grupo[j], (r.data ?? []) as unknown as ColdLead[])
        continue
      }
      // El que falla se pide otra vez en trozos pequeños antes de darlo por perdido
      const t = await tramoEnTrozos(supabase, op.propietario, grupo[j], columnas)
      if (t.filas) {
        tramos.set(grupo[j], t.filas)
        continue
      }
      incompleta = true
      motivo = motivoDeError(t.error ?? r.error)
      console.error('Cold Calling · ha fallado un tramo de la cartera', { desde: grupo[j], motivo })
    }
    for (const d of grupo) leads.push(...(tramos.get(d) ?? []))
    op.alProgreso?.(leads.length, total)
  }

  return { leads, total, incompleta: incompleta || leads.length < total, motivo }
}
