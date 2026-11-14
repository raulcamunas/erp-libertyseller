import { createServiceClient } from '@/lib/supabase/service'
import type { Lugar } from '@/lib/festivos/tipos'
import {
  colorDePersona,
  festivosDelLugar,
  leerLugar,
  type AusenciaDeEquipo,
  type PersonaDeEquipo,
} from '@/lib/vacations/calendario'

/**
 * VACACIONES · LO QUE AÑADE LA MIGRACIÓN 308, LEÍDO CON service_role. SOLO SERVIDOR.
 *
 * Todo lo de aquí AGUANTA que la 308 no esté lanzada: si faltan las columnas o la tabla de ajustes, se devuelve lo de
 * siempre (sin colores propios, sin festivos, máximo 1) y `migracion308: false`, en vez de tumbar la pantalla. Así el
 * código se puede desplegar antes que la migración sin que nadie se quede sin pedir sus vacaciones.
 */

type Servicio = ReturnType<typeof createServiceClient>

/** ¿Es «esa columna o tabla todavía no existe»? (la 308 sin lanzar) */
export function faltaEsquema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === 'PGRST204' || code === '42703' || code === 'PGRST205' || code === '42P01'
}

export interface FichaDeVacaciones {
  /** Color en el calendario (el de la ficha o uno estable) */
  color: string
  /** El color guardado en la ficha, o null si sale del id */
  colorPropio: string | null
  /** Dónde vive para sus festivos; null = solo fines de semana */
  lugar: Lugar | null
}

/** Color y lugar de festivos de cada ficha. Una consulta para todas */
export async function cargarFichas(service: Servicio, ids?: readonly string[]): Promise<{ fichas: Record<string, FichaDeVacaciones>; migracion308: boolean }> {
  const fichas: Record<string, FichaDeVacaciones> = {}
  let q = service.from('employees').select('id, vacation_color, festivos_lugar')
  if (ids) {
    if (ids.length === 0) return { fichas, migracion308: true }
    q = q.in('id', [...ids])
  }
  const { data, error } = await q
  if (error) {
    if (!faltaEsquema(error)) throw error
    for (const id of ids ?? []) fichas[id] = { color: colorDePersona(id), colorPropio: null, lugar: null }
    return { fichas, migracion308: false }
  }
  for (const f of (data ?? []) as { id: string; vacation_color: string | null; festivos_lugar: unknown }[]) {
    fichas[f.id] = { color: colorDePersona(f.id, f.vacation_color), colorPropio: f.vacation_color, lugar: leerLugar(f.festivos_lugar) }
  }
  return { fichas, migracion308: true }
}

/** El máximo de personas fuera a la vez en la empresa. 1 si la 308 no está lanzada */
export async function cargarMaxALaVez(service: Servicio): Promise<number> {
  const { data, error } = await service.from('vacation_settings').select('max_a_la_vez').eq('id', true).maybeSingle()
  if (error) {
    if (!faltaEsquema(error)) throw error
    return 1
  }
  const n = Number((data as { max_a_la_vez?: number } | null)?.max_a_la_vez)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1
}

/** Los festivos (entre semana) que no le gastan vacaciones a esa ficha */
export async function festivosDeLaFicha(service: Servicio, employeeId: string): Promise<string[]> {
  const { fichas } = await cargarFichas(service, [employeeId])
  return festivosDelLugar(fichas[employeeId]?.lugar ?? null)
}

export interface VistaDeEquipo {
  ausencias: AusenciaDeEquipo[]
  personas: PersonaDeEquipo[]
  maxALaVez: number
}

/**
 * QUIÉN ESTÁ FUERA ENTRE DOS FECHAS, EN TODA LA EMPRESA: las pendientes y las aprobadas.
 *
 * Lo ve cualquiera con permiso del módulo, así que de cada petición solo sale lo que se ve en el calendario: quién,
 * color, fechas, estado y si fue una excepción. NI EL MOTIVO, NI LOS DÍAS, NI EL SALDO. Se lee `*` y se copian los
 * campos a mano para que una columna nueva no se cuele sola en la respuesta.
 */
export async function cargarEquipo(service: Servicio, desde: string, hasta: string): Promise<VistaDeEquipo> {
  const { data, error } = await service
    .from('vacation_requests')
    .select('*')
    .in('status', ['pendiente', 'aprobada'])
    .gte('end_date', desde)
    .lte('start_date', hasta)
    .order('start_date')
    .order('id')
    .limit(2000)
  if (error) throw error
  const filas = (data ?? []) as Record<string, unknown>[]

  const { data: emps, error: errEmps } = await service
    .from('employees')
    .select('id, name, is_active, vacation_days_per_month, user_id')
    .order('name')
  if (errEmps) throw errEmps
  const empleados = (emps ?? []) as { id: string; name: string; is_active: boolean; vacation_days_per_month: number | null; user_id: string | null }[]

  const [{ fichas }, maxALaVez] = await Promise.all([cargarFichas(service), cargarMaxALaVez(service)])
  const nombre = new Map(empleados.map((e) => [e.id, e.name]))
  const color = (id: string) => fichas[id]?.color ?? colorDePersona(id)

  const ausencias: AusenciaDeEquipo[] = filas.map((r) => {
    const id = String(r.employee_id)
    return {
      id: String(r.id),
      employee_id: id,
      nombre: nombre.get(id) ?? 'Alguien',
      color: color(id),
      start_date: String(r.start_date),
      end_date: String(r.end_date),
      status: r.status === 'aprobada' ? 'aprobada' : 'pendiente',
      solape_autorizado: r.solape_autorizado === true,
    }
  })

  // La leyenda: quien participa en el módulo (activo y con tarifa o con cuenta) y quien sale en el rango
  const conAusencia = new Set(ausencias.map((a) => a.employee_id))
  const personas: PersonaDeEquipo[] = empleados
    .filter((e) => conAusencia.has(e.id) || (e.is_active && (e.vacation_days_per_month != null || e.user_id != null)))
    .map((e) => ({ id: e.id, nombre: e.name, color: color(e.id) }))

  return { ausencias, personas, maxALaVez }
}

/* ------------------------------------------------------------------ */
/* La campana                                                          */
/* ------------------------------------------------------------------ */

export interface AvisoDeVacaciones {
  userId: string
  tipo: 'vacaciones_pedida' | 'vacaciones_resuelta'
  titulo: string
  mensaje: string
  clave: string
  requestId: string
}

/** Los administradores, que son quienes aprueban */
export async function idsDeAdmins(service: Servicio): Promise<string[]> {
  const { data, error } = await service.from('profiles').select('id').eq('role', 'admin')
  if (error) throw error
  return ((data ?? []) as { id: string }[]).map((p) => p.id)
}

/**
 * Escribe los avisos en la campana. NUNCA hace fallar la operación que los dispara: unas vacaciones aprobadas están
 * aprobadas aunque la campana no las acepte (la 308 sin lanzar = el tipo no está en el CHECK). Se registra y se sigue.
 */
export async function avisarEnLaCampana(service: Servicio, avisos: readonly AvisoDeVacaciones[]): Promise<void> {
  if (avisos.length === 0) return
  try {
    const filas = avisos.map((a) => ({
      user_id: a.userId,
      type: a.tipo,
      title: a.titulo,
      message: a.mensaje,
      clave: a.clave,
      datos: { app: 'vacaciones', requestId: a.requestId },
    }))
    const { error } = await service.from('notifications').upsert(filas, { onConflict: 'user_id,clave', ignoreDuplicates: true })
    if (error) console.warn('[vacaciones] La campana no ha aceptado el aviso (¿falta la migración 308?):', error.code, error.message)
  } catch (error) {
    console.warn('[vacaciones] No se ha podido avisar en la campana:', error)
  }
}
