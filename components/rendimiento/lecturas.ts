import type { createClient } from '@/lib/supabase/client'
import { fetchAll, trocear } from '@/lib/supabase/paginacion'
import type { CitaDeActividad, NotaDeActividad } from '@/lib/rendimiento/actividad'
import type { FilaDiaria } from '@/lib/rendimiento/comparativa'
import { inicioDelDia, sumarDias } from '@/lib/rendimiento/dia'
import type { LlamadaParaLinea } from '@/lib/rendimiento/linea'
import type { NombreDeLead } from './ListaLlamadas'

/**
 * LO QUE EL PANEL LEE «EN CRUDO» PARA ENSEÑAR QUÉ HIZO CADA PERSONA, CLIENTE A CLIENTE.
 *
 * Las cifras salen de la función de la base (rendimiento_resumen_diario). Esto es lo que hace falta para el detalle:
 * las notas de Cold Calling con su comentario, las citas, las llamadas de todo el equipo en un día y el nombre de
 * los clientes. Todo se lee con la sesión de quien mira, así que las políticas de la base deciden qué ve cada uno:
 * es la misma regla que aplica la función de las cifras, y por eso la lista y la tarjeta cuadran.
 *
 * Los rangos son de días de Madrid, ambos incluidos («2026-10-19» a «2026-10-25»).
 */

type Supabase = ReturnType<typeof createClient>

export interface Rango {
  desde: string
  hasta: string
}

export interface NotaConAutor extends NotaDeActividad {
  author_id: string | null
}

export interface CitaConComercial extends CitaDeActividad {
  comercial_id: string
}

export type LlamadaDeEquipo = LlamadaParaLinea & { user_id: string }

const CAMPOS_DE_NOTA = 'id, author_id, kind, es_respuesta, body, occurred_at, lead_id'
const CAMPOS_DE_CITA = 'id, comercial_id, lead_name, lead_company, start_time, status, created_at'
const CAMPOS_DE_LLAMADA_DE_EQUIPO = 'id, user_id, fecha, direccion, estado, duracion_s, lead_id, numero'

/** Del primer instante del primer día al primero del día siguiente al último: lo que pide un `gte` y un `lt` */
function instantes(rango: Rango): { desde: string; hasta: string } {
  return { desde: inicioDelDia(rango.desde).toISOString(), hasta: inicioDelDia(sumarDias(rango.hasta, 1)).toISOString() }
}

/** Las notas de Cold Calling de un periodo. Con `autor`, solo las de esa persona; sin él, las de todo el equipo */
export async function leerNotas(supabase: Supabase, rango: Rango, autor?: string): Promise<NotaConAutor[]> {
  const { desde, hasta } = instantes(rango)
  return fetchAll<NotaConAutor>((de, a) => {
    let consulta = supabase.from('cold_lead_notes').select(CAMPOS_DE_NOTA).gte('occurred_at', desde).lt('occurred_at', hasta)
    if (autor) consulta = consulta.eq('author_id', autor)
    // Termina en el id: paginar sobre un orden con empates repite y se salta filas
    return consulta.order('occurred_at', { ascending: true }).order('id', { ascending: true }).range(de, a)
  })
}

/**
 * Las citas que se AGENDARON en el periodo (por el día en que se crearon, igual que la cifra «Citas agendadas»),
 * sin las que vienen de eventos externos de Google Calendar.
 */
export async function leerCitas(supabase: Supabase, rango: Rango, comercial?: string): Promise<CitaConComercial[]> {
  const { desde, hasta } = instantes(rango)
  return fetchAll<CitaConComercial>((de, a) => {
    let consulta = supabase.from('appointments').select(CAMPOS_DE_CITA).eq('is_external', false).gte('created_at', desde).lt('created_at', hasta)
    if (comercial) consulta = consulta.eq('comercial_id', comercial)
    return consulta.order('created_at', { ascending: true }).order('id', { ascending: true }).range(de, a)
  })
}

/** Las llamadas de todo el equipo en un periodo: para dibujar la línea de cada comercial y el mapa de franjas horarias */
export async function leerLlamadasDelEquipo(supabase: Supabase, rango: Rango): Promise<LlamadaDeEquipo[]> {
  const { desde, hasta } = instantes(rango)
  return fetchAll<LlamadaDeEquipo>((de, a) =>
    supabase
      .from('rinkel_llamadas')
      .select(CAMPOS_DE_LLAMADA_DE_EQUIPO)
      .gte('fecha', desde)
      .lt('fecha', hasta)
      .order('fecha', { ascending: true })
      .order('id', { ascending: true })
      .range(de, a)
  )
}

export interface SemanaLeida {
  /** El lunes de la semana */
  clave: string
  /** Una fila por persona y día, de la semana y de la anterior (catorce días): de ahí salen las cifras y la comparación */
  filas: FilaDiaria[]
  /** Lo de la semana en crudo, de todo el equipo: para las franjas horarias, el horario y el detalle de cada persona */
  llamadas: LlamadaDeEquipo[]
  notas: NotaConAutor[]
  citas: CitaConComercial[]
}

/** Todo lo que necesita el informe semanal de una semana */
export async function leerSemanaDelEquipo(supabase: Supabase, lunes: string): Promise<SemanaLeida> {
  const semana = { desde: lunes, hasta: sumarDias(lunes, 6) }
  const conLaAnterior = { desde: sumarDias(lunes, -7), hasta: semana.hasta }
  const [filas, llamadas, notas, citas] = await Promise.all([
    // La función ordena por día y persona, así que paginar de 1.000 en 1.000 no repite ni se salta filas
    fetchAll<FilaDiaria>((de, a) => supabase.rpc('rendimiento_resumen_diario', { p_desde: conLaAnterior.desde, p_hasta: conLaAnterior.hasta }).range(de, a)),
    leerLlamadasDelEquipo(supabase, semana),
    leerNotas(supabase, semana),
    leerCitas(supabase, semana),
  ])
  return { clave: lunes, filas, llamadas, notas, citas }
}

/**
 * El nombre de los clientes (leads de Cold Calling) por su id. Devuelve solo los que ha encontrado; un cliente que ya
 * no existe o que quien mira no puede ver se queda sin nombre y quien llama lo apunta para no volver a pedirlo.
 * Si la lectura falla, LANZA: devolver menos de lo que hay se confundiría con clientes que no existen.
 */
export async function leerNombres(supabase: Supabase, ids: readonly string[]): Promise<Map<string, NombreDeLead>> {
  const encontrados = new Map<string, NombreDeLead>()
  for (const trozo of trocear([...ids], 100)) {
    const { data, error } = await supabase.from('cold_leads').select('id, store_name, company').in('id', trozo)
    if (error) throw error
    for (const fila of (data ?? []) as Array<{ id: string; store_name: string; company: string | null }>) {
      encontrados.set(fila.id, { nombre: fila.store_name, empresa: fila.company })
    }
  }
  return encontrados
}
