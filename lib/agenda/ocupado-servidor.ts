import type { SupabaseClient } from '@supabase/supabase-js'
import { choquesCon, type Choque, type CitaQueOcupa } from './ocupado'

/**
 * LO QUE HAY YA EN EL CALENDARIO EN UN HUECO, LEÍDO DE LA BASE. SOLO SERVIDOR. Lo usan las rutas de /api/appointments antes de guardar una cita nueva o de mover una.
 * La regla (qué ocupa un hueco, cuándo dos tramos se solapan) está en ocupado.ts; aquí solo se pide a la base lo que puede chocar. Se comprueba con ocupado-servidor.prueba.ts.
 *
 * Se lee con la SESIÓN de quien agenda: la lectura de `appointments` está abierta a todo el equipo (política de la migración 071), y los huecos de Google son filas de la
 * misma tabla (`is_external`), así que una sola consulta trae las dos cosas.
 *
 * SI LA BASE NO CONTESTA, SE DEJA AGENDAR. Bloquear a los comerciales porque falle una lectura sería peor que el problema que se evita: justo en la llamada, con el cliente
 * esperando. Se apunta en el registro del servidor, y si la base está caída tampoco se podrá guardar la cita.
 */

/** Ninguna cita ni evento del calendario dura más que esto (lo más largo que hay son 13 h): sirve para no recorrer la tabla desde el principio de los tiempos */
const MARGEN_POR_DETRAS_MS = 48 * 3_600_000

/** Más de esto no hace falta para decir «está ocupado» */
const MAXIMO_DE_FILAS = 25

export async function choquesEnLaBase(supabase: Pick<SupabaseClient, 'from'>, p: { inicio: string; fin: string; ignorarId?: string | null }): Promise<Choque[]> {
  const i = Date.parse(p.inicio)
  const f = Date.parse(p.fin)
  if (!Number.isFinite(i) || !Number.isFinite(f) || f <= i) return []

  let consulta = supabase
    .from('appointments')
    .select('id, start_time, end_time, status, is_external, lead_name')
    .neq('status', 'cancelled')
    .lt('start_time', new Date(f).toISOString())
    .gt('end_time', new Date(i).toISOString())
    .gte('start_time', new Date(i - MARGEN_POR_DETRAS_MS).toISOString())
    .order('start_time', { ascending: true })
    .limit(MAXIMO_DE_FILAS)
  if (p.ignorarId) consulta = consulta.neq('id', p.ignorarId)

  const { data, error } = await consulta
  if (error) {
    console.error('[agenda] no se ha podido mirar si el hueco está ocupado (se deja agendar)', { codigo: error.code ?? null, mensaje: error.message?.slice(0, 160) ?? '' })
    return []
  }
  // La misma regla de siempre sobre lo leído: la base ya filtró por fechas y estado, esto lo deja igual que lo que ve la pantalla
  return choquesCon(p.inicio, p.fin, (data ?? []) as CitaQueOcupa[], p.ignorarId)
}
