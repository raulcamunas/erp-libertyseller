import type { SupabaseClient } from '@supabase/supabase-js'
import type { ColdLead } from '@/lib/types/cold-leads'

/**
 * TRAER LA CARTERA DE LEADS, RÁPIDO.
 * ==================================
 * Sirve igual desde el servidor (la página, con la sesión de quien mira) que desde el navegador (cuando un supervisor cambia de
 * comercial). Se comprueba con cargar.prueba.ts.
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

export const COLUMNAS_DE_CARTERA = [
  'id', 'store_name', 'company', 'phone', 'email', 'province', 'category', 'seller_url', 'web', 'ciudad',
  'tipo_lead', 'vende_en_amazon', 'tipo_empresa', 'nivel', 'revenue_monthly', 'ventas_estimadas_usd',
  'assigned_to', 'status', 'follow_up', 'next_call_date', 'last_contacted_at', 'call_attempts', 'source_list',
].join(', ')

/** La cookie donde quien supervisa deja de qué comercial es la cartera que mira, para que el servidor traiga ya la buena la próxima vez */
export const COOKIE_DE_PROPIETARIO = 'cc_propietario'

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
}

type Respuesta = { data: unknown; error: unknown; count?: number | null }

function pedirTramo(supabase: ClienteDeLectura, propietario: string | undefined, desde: number, conRecuento: boolean): PromiseLike<Respuesta> {
  let consulta = supabase.from('cold_leads').select(COLUMNAS_DE_CARTERA, conRecuento ? { count: 'exact' } : undefined)
  if (propietario) consulta = consulta.eq('assigned_to', propietario)
  return consulta.order('id', { ascending: true }).range(desde, desde + FILAS_POR_TRAMO - 1) as unknown as PromiseLike<Respuesta>
}

export async function cargarCartera(supabase: ClienteDeLectura, op: OpcionesDeCarga = {}): Promise<ResultadoDeCarga> {
  const primero = await pedirTramo(supabase, op.propietario, 0, true)
  if (primero.error) {
    console.error('Cold Calling · no se ha podido leer la cartera', { codigo: (primero.error as { code?: unknown })?.code ?? null })
    return { leads: [], total: 0, incompleta: true }
  }
  const filas = (primero.data ?? []) as unknown as ColdLead[]
  const total = Math.max(primero.count ?? filas.length, filas.length)
  const leads: ColdLead[] = [...filas]
  op.alProgreso?.(leads.length, total)

  const desdes: number[] = []
  for (let desde = FILAS_POR_TRAMO; desde < total; desde += FILAS_POR_TRAMO) desdes.push(desde)

  const tramos = new Map<number, ColdLead[]>()
  let incompleta = false
  for (let i = 0; i < desdes.length; i += TRAMOS_A_LA_VEZ) {
    const grupo = desdes.slice(i, i + TRAMOS_A_LA_VEZ)
    const respuestas = await Promise.all(grupo.map((d) => pedirTramo(supabase, op.propietario, d, false)))
    respuestas.forEach((r, j) => {
      if (r.error) {
        incompleta = true
        console.error('Cold Calling · ha fallado un tramo de la cartera', { desde: grupo[j], codigo: (r.error as { code?: unknown })?.code ?? null })
        return
      }
      tramos.set(grupo[j], (r.data ?? []) as unknown as ColdLead[])
    })
    for (const d of grupo) leads.push(...(tramos.get(d) ?? []))
    op.alProgreso?.(leads.length, total)
  }

  return { leads, total, incompleta: incompleta || leads.length < total }
}
