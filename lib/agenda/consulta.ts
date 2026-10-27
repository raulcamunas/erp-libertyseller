/**
 * LEER CITAS DE LA BASE, POR RANGO Y NO ENTERAS.
 * ===============================================
 * La agenda se bajaba TODA la tabla `appointments` en cada visita. Medido contra producción el 27 oct 2026:
 *
 *   5.939 filas · 5,9 MB · 6 peticiones EN SERIE · 1,7–2,7 s    <- lo que esperaba quien pulsaba «Agenda»
 *   la semana que se mira y las dos de al lado: 24 filas · 32 kB · 1 petición · ~0,15 s
 *
 * De esas 5.939 filas, 5.889 son huecos importados de Google (reuniones semanales repetidas hasta el año 2054) y 50 son citas del ERP. Aquel recorrido entero
 * existía para poder pintar una semana.
 *
 * Esto lee solo las citas cuyo inicio cae entre `desde` (incluido) y `hasta` (excluido), con las mismas columnas que antes (COLUMNAS_AGENDA) y el mismo orden, y lo
 * usan por igual la página del servidor y el navegador al cambiar de semana. Las mismas dos reglas que traía el recorrido de antes siguen aquí:
 *
 *   · PostgREST corta a 1.000 filas SIN avisar: se pide por tramos hasta que uno viene corto. Una semana con mil huecos de Google no se queda a medias.
 *   · Las columnas de la migración 214 se piden primero y, si la base todavía no las tiene (se despliega antes de lanzar la migración a mano), se repite sin ellas
 *     en vez de dejar la agenda en blanco para todo el equipo comercial.
 *
 * NUNCA DEVUELVE MEDIA LISTA: si un tramo falla devuelve el error y ninguna cita. Media semana no se distingue de una semana vacía mirando la pantalla, y la
 * pantalla que lo recibe sabe volver a pedirla.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  COLUMNAS_AGENDA,
  COLUMNAS_AGENDA_CON_TIENDA,
  faltaLa214,
  type AppointmentWithPeople,
} from '@/lib/types/appointments'
import { PAGE } from '@/lib/supabase/paginacion'

type Cliente = Pick<SupabaseClient, 'from'>

export type ResultadoDeCitas = { citas: AppointmentWithPeople[]; error: null } | { citas: []; error: unknown }

type Respuesta = { data: unknown; error: unknown }

/** Pide con las columnas de la 214 y, si la base no las tiene, repite sin ellas. Lo aprendido vale para el resto de tramos de la misma lectura */
function lector() {
  let conTienda = true
  return async (consulta: (columnas: string) => PromiseLike<Respuesta>): Promise<Respuesta> => {
    let r = await consulta(conTienda ? COLUMNAS_AGENDA_CON_TIENDA : COLUMNAS_AGENDA)
    if (r.error && conTienda && faltaLa214(r.error as { code?: string })) {
      conTienda = false
      r = await consulta(COLUMNAS_AGENDA)
    }
    return r
  }
}

/** Las citas que EMPIEZAN entre `desde` (entra) y `hasta` (no entra), de la más temprana a la más tardía */
export async function citasEntre(supabase: Cliente, desde: string, hasta: string): Promise<ResultadoDeCitas> {
  const leer = lector()
  const citas: AppointmentWithPeople[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await leer((columnas) =>
      supabase
        .from('appointments')
        .select(columnas)
        .gte('start_time', desde)
        .lt('start_time', hasta)
        // `id` de desempate: sin él, .range() sobre un orden con empates puede repetir una fila y saltarse otra entre tramos
        .order('start_time', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1)
    )
    if (error) return { citas: [], error }
    // `as unknown as`: al pedir columnas explícitas el tipo que infiere supabase-js ya no solapa con AppointmentWithPeople (falta `transcription`, que no se pide)
    const tramo = (data ?? []) as unknown as AppointmentWithPeople[]
    citas.push(...tramo)
    if (tramo.length < PAGE) break
  }
  return { citas, error: null }
}

/**
 * Esas citas, por su id. Es lo que se pide cuando el tiempo real avisa de que han cambiado: UNA consulta para todas las avisadas en el mismo instante, y no una por cita.
 * Sin ids no hay consulta.
 */
export async function citasPorId(supabase: Cliente, ids: string[]): Promise<ResultadoDeCitas> {
  const unicos = [...new Set(ids)]
  if (unicos.length === 0) return { citas: [], error: null }
  const leer = lector()
  const citas: AppointmentWithPeople[] = []
  // En tandas de 200: una URL con cientos de uuid es demasiado larga para PostgREST
  for (let i = 0; i < unicos.length; i += 200) {
    const lote = unicos.slice(i, i + 200)
    const { data, error } = await leer((columnas) => supabase.from('appointments').select(columnas).in('id', lote))
    if (error) return { citas: [], error }
    citas.push(...((data ?? []) as unknown as AppointmentWithPeople[]))
  }
  return { citas, error: null }
}
