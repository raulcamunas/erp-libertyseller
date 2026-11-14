/**
 * VACACIONES · EL CALENDARIO DE TODA LA EMPRESA — PURO.
 * =====================================================
 * Sin React, sin Supabase y sin reloj: lo usan igual la pantalla (para pintar quién está fuera y avisar mientras se
 * elige el rango) y las rutas de /api/vacations (que son las que deciden). Una sola función para las dos, o la pantalla
 * diría «no choca» a algo que el servidor para.
 *
 * LA REGLA (Raúl, 14 nov 2026): «no pueden irse dos a la vez» vale para TODA LA EMPRESA, con un máximo configurable
 * (vacation_settings.max_a_la_vez, por defecto 1).
 *   · AL PEDIR se miran las pendientes y las aprobadas de los demás: si chocan sale un AVISO, pero se puede pedir.
 *   · AL APROBAR mandan las APROBADAS de los demás: si chocan, el admin solo puede aprobar autorizándolo como
 *     excepción con un motivo (solape_autorizado + solape_motivo). Las pendientes se enseñan, pero no bloquean.
 *
 * LOS FESTIVOS. Cada ficha puede llevar `festivos_lugar` ({ ccaa, ine }); con eso los festivos de su comunidad (y de su
 * municipio, donde se conocen) no le gastan vacaciones. Sin lugar solo cuentan los fines de semana, que es la regla de
 * siempre: media plantilla está en Latinoamérica y un festivo de España no es su festivo. Los MISMOS festivos tienen que
 * llegar al POST, a aprobar, a la pantalla y al saldo: por eso salen todos de `festivosDelLugar`.
 */
import { fiestasDe, hayCalendarioPara, aniosConCalendario } from '@/lib/festivos/festivos'
import type { Lugar } from '@/lib/festivos/tipos'
import { CODIGOS_CCAA, type CodigoCcaa } from '@/lib/ubicacion/zonas'
import {
  addDays,
  checkVacationRequest,
  dayKeyOf,
  daysBetween,
  formatDayRange,
  formatDays,
  isWeekend,
  MAX_RANGE_DAYS,
  workingDaysBetween,
  type VacationEmployee,
  type VacationRequest,
} from '@/lib/types/vacations'

/* ------------------------------------------------------------------ */
/* Tipos                                                               */
/* ------------------------------------------------------------------ */

export type EstadoVivo = 'pendiente' | 'aprobada'

/**
 * Una ausencia tal y como la ve CUALQUIER compañero: quién, de qué color, qué días y si está aprobada o pendiente.
 * SIN motivo y SIN saldo, a propósito: es lo único que sale de /api/vacations/equipo.
 */
export interface AusenciaDeEquipo {
  id: string
  employee_id: string
  nombre: string
  color: string
  start_date: string
  end_date: string
  status: EstadoVivo
  /** El admin la aprobó pese a chocar con otra (excepción con motivo) */
  solape_autorizado: boolean
}

export interface PersonaDeEquipo {
  id: string
  nombre: string
  color: string
}

/* ------------------------------------------------------------------ */
/* Colores por persona                                                 */
/* ------------------------------------------------------------------ */

/**
 * La paleta del calendario. Colores medios que se leen sobre fondo oscuro y sobre claro; el color de la PERSONA va
 * aparte del color del ESTADO (pendiente se pinta con trazo discontinuo, no con otro color).
 */
export const PALETA_PERSONAS = [
  '#8B5CF6', '#06B6D4', '#F59E0B', '#10B981', '#EC4899', '#3B82F6', '#F97316', '#84CC16', '#14B8A6', '#E11D48',
] as const

export const esColorValido = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)

/** El color de una persona: el de su ficha si lo tiene, y si no uno ESTABLE sacado de su id (no del orden de la lista) */
export function colorDePersona(id: string, color?: string | null): string {
  if (esColorValido(color)) return color
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PALETA_PERSONAS[h % PALETA_PERSONAS.length]
}

/* ------------------------------------------------------------------ */
/* Festivos                                                            */
/* ------------------------------------------------------------------ */

/** Lee el `festivos_lugar` de la ficha (JSONB). Cualquier cosa rara = sin lugar (solo fines de semana) */
export function leerLugar(raw: unknown): Lugar | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.ccaa !== 'string' || !(CODIGOS_CCAA as readonly string[]).includes(r.ccaa)) return null
  const ine = typeof r.ine === 'string' && /^\d{5}$/.test(r.ine) ? r.ine : null
  return { ccaa: r.ccaa as CodigoCcaa, ine }
}

const claveDeLugar = (l: Lugar | null): string => (l ? `${l.ccaa}:${l.ine ?? ''}` : '')
const CACHE_FESTIVOS = new Map<string, string[]>()

/**
 * TODOS los festivos entre semana de ese lugar en los años con calendario del BOE (hoy 2026 y 2027). Es la lista que
 * se pasa como `holidays` a workingDaysBetween / vacationBalance / checkVacationRequest. Sin lugar, vacía.
 */
export function festivosDelLugar(lugar: Lugar | null | undefined): string[] {
  if (!lugar) return []
  const clave = claveDeLugar(lugar)
  const guardado = CACHE_FESTIVOS.get(clave)
  if (guardado) return guardado
  const salida: string[] = []
  for (const anio of aniosConCalendario()) {
    let d = `${anio}-01-01`
    const fin = `${anio}-12-31`
    while (d <= fin) {
      if (!isWeekend(d) && fiestasDe(d, lugar).length > 0) salida.push(d)
      d = addDays(d, 1)
    }
  }
  CACHE_FESTIVOS.set(clave, salida)
  return salida
}

/**
 * Los festivos que se PINTAN en el calendario entre dos fechas, con su nombre. Con lugar, los de ese lugar (descuentan);
 * sin lugar, los nacionales de España marcados como «informativos» (no descuentan).
 */
export function festivosParaPintar(
  lugar: Lugar | null | undefined,
  desde: string,
  hasta: string
): Map<string, { nombre: string; descuenta: boolean }> {
  const salida = new Map<string, { nombre: string; descuenta: boolean }>()
  const a = dayKeyOf(desde)
  const b = dayKeyOf(hasta)
  if (b < a || daysBetween(a, b) > 800) return salida
  // Un lugar cualquiera para preguntar por lo nacional: lo que celebran las diecinueve
  const referencia: Lugar = { ccaa: 'MD', ine: null }
  let d = a
  while (d <= b) {
    if (!isWeekend(d) && hayCalendarioPara(d)) {
      if (lugar) {
        const f = fiestasDe(d, lugar)
        if (f.length > 0) salida.set(d, { nombre: f.map((x) => x.lugar ?? x.nombre).join(' · '), descuenta: true })
      } else {
        const nac = fiestasDe(d, referencia).filter((x) => x.alcance === 'nacional')
        if (nac.length > 0) salida.set(d, { nombre: nac[0].nombre, descuenta: false })
      }
    }
    d = addDays(d, 1)
  }
  return salida
}

/** Días laborables de un rango para esa persona: de lunes a viernes y sin sus festivos */
export function diasLaborables(desde: string, hasta: string, lugar: Lugar | null | undefined): number {
  return workingDaysBetween(desde, hasta, festivosDelLugar(lugar))
}

/* ------------------------------------------------------------------ */
/* Choques con compañeros                                              */
/* ------------------------------------------------------------------ */

export interface Coincidencia {
  employee_id: string
  nombre: string
  color: string
  status: EstadoVivo
  start_date: string
  end_date: string
  autorizado: boolean
  /** Los días laborables (del rango pedido) en que coinciden */
  dias: string[]
}

export interface ResultadoDeChoques {
  /** Algún día se llega o se pasa del máximo con esta petición dentro */
  hay: boolean
  /** Los días laborables del rango en que los DEMÁS ya ocupan todo el cupo */
  diasLlenos: string[]
  /** Todas las ausencias de otras personas que se pisan con el rango (aunque no lleguen al máximo) */
  coinciden: Coincidencia[]
  maxALaVez: number
}

export interface EntradaDeChoques {
  /** De quién es la petición: sus propias ausencias no cuentan */
  employeeId: string
  startDate: string
  endDate: string
  ausencias: readonly AusenciaDeEquipo[]
  /** Por defecto 1 */
  maxALaVez?: number
  /** La propia petición, para no chocar consigo misma al aprobarla */
  excludeId?: string | null
  /** Qué estados de los demás cuentan. Al pedir: los dos; al aprobar: solo 'aprobada' */
  estados?: readonly EstadoVivo[]
  /** Los festivos de quien pide: ese día no está de vacaciones, así que no choca */
  festivos?: readonly string[]
}

/**
 * CHOQUES CON COMPAÑEROS EN TODA LA EMPRESA.
 *
 * Se recorre día a día el rango pedido (solo laborables de quien pide) y se cuenta cuántas OTRAS personas están fuera
 * ese día. Si ya son `maxALaVez` o más, ese día está lleno y la petición choca. Cuenta personas distintas, no
 * peticiones: dos peticiones de la misma persona que se tocan son una persona fuera.
 */
export function choquesDeEmpresa(e: EntradaDeChoques): ResultadoDeChoques {
  const max = Math.max(1, Math.floor(e.maxALaVez ?? 1))
  const estados = e.estados ?? ['pendiente', 'aprobada']
  const inicio = dayKeyOf(e.startDate)
  const fin = dayKeyOf(e.endDate)
  const vacio: ResultadoDeChoques = { hay: false, diasLlenos: [], coinciden: [], maxALaVez: max }
  if (fin < inicio || daysBetween(inicio, fin) + 1 > MAX_RANGE_DAYS) return vacio

  const festivos = new Set(e.festivos ?? [])
  const otras = e.ausencias.filter(
    (a) =>
      a.employee_id !== e.employeeId &&
      a.id !== e.excludeId &&
      estados.includes(a.status) &&
      dayKeyOf(a.start_date) <= fin &&
      dayKeyOf(a.end_date) >= inicio
  )
  if (otras.length === 0) return vacio

  const porAusencia = new Map<string, string[]>()
  const diasLlenos: string[] = []
  let d = inicio
  while (d <= fin) {
    if (!isWeekend(d) && !festivos.has(d)) {
      const fuera = otras.filter((a) => dayKeyOf(a.start_date) <= d && dayKeyOf(a.end_date) >= d)
      if (fuera.length > 0) {
        for (const a of fuera) {
          const lista = porAusencia.get(a.id)
          if (lista) lista.push(d)
          else porAusencia.set(a.id, [d])
        }
        if (new Set(fuera.map((a) => a.employee_id)).size >= max) diasLlenos.push(d)
      }
    }
    d = addDays(d, 1)
  }

  const coinciden: Coincidencia[] = otras
    .filter((a) => porAusencia.has(a.id))
    .map((a) => ({
      employee_id: a.employee_id,
      nombre: a.nombre,
      color: a.color,
      status: a.status,
      start_date: a.start_date,
      end_date: a.end_date,
      autorizado: a.solape_autorizado,
      dias: porAusencia.get(a.id) ?? [],
    }))
    .sort((x, y) => x.start_date.localeCompare(y.start_date) || x.nombre.localeCompare(y.nombre, 'es'))

  return { hay: diasLlenos.length > 0, diasLlenos, coinciden, maxALaVez: max }
}

/** «Coincide con Ana (del 3 al 7 de agosto, aprobada) y Luis (pendiente)». null si no coincide con nadie */
export function textoDeChoque(r: ResultadoDeChoques): string | null {
  if (r.coinciden.length === 0) return null
  const partes = r.coinciden.map(
    (c) => `${c.nombre} (${formatDayRange(c.start_date, c.end_date)}, ${c.status === 'aprobada' ? 'aprobadas' : 'pendientes'})`
  )
  const lista = partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
  if (!r.hay) return `Coincide con ${lista}, pero cabe: pueden estar fuera ${r.maxALaVez} a la vez.`
  const n = r.diasLlenos.length
  return `Choca ${n} día${n === 1 ? '' : 's'} con ${lista}. En la empresa ${r.maxALaVez === 1 ? 'no pueden irse dos a la vez' : `solo pueden estar fuera ${r.maxALaVez} a la vez`}.`
}

/* ------------------------------------------------------------------ */
/* Quién está fuera cada día                                           */
/* ------------------------------------------------------------------ */

export interface DiaOcupado {
  /** Las ausencias de ese día (laborable), una por persona; primero las aprobadas */
  personas: AusenciaDeEquipo[]
  /** Los demás (sin contar a `yo`) ya ocupan todo el cupo: el día se pinta rayado */
  lleno: boolean
}

/**
 * Para pintar el calendario: día laborable → quién está fuera. Los fines de semana no se pintan (no cuentan como
 * vacaciones). `yo` es quien mira: sus días no cuentan para decidir si el día está lleno PARA ÉL.
 */
export function ocupacionPorDia(
  ausencias: readonly AusenciaDeEquipo[],
  desde: string,
  hasta: string,
  opciones: { yo?: string | null; maxALaVez?: number } = {}
): Map<string, DiaOcupado> {
  const max = Math.max(1, Math.floor(opciones.maxALaVez ?? 1))
  const a = dayKeyOf(desde)
  const b = dayKeyOf(hasta)
  const salida = new Map<string, DiaOcupado>()
  if (b < a || daysBetween(a, b) > 800) return salida

  for (const aus of ausencias) {
    const ini = dayKeyOf(aus.start_date) > a ? dayKeyOf(aus.start_date) : a
    const fin = dayKeyOf(aus.end_date) < b ? dayKeyOf(aus.end_date) : b
    if (fin < ini || daysBetween(ini, fin) > 800) continue
    let d = ini
    while (d <= fin) {
      if (!isWeekend(d)) {
        const dia = salida.get(d) ?? { personas: [], lleno: false }
        const ya = dia.personas.findIndex((p) => p.employee_id === aus.employee_id)
        if (ya === -1) dia.personas.push(aus)
        else if (aus.status === 'aprobada') dia.personas[ya] = aus // una aprobada manda sobre una pendiente de la misma persona
        salida.set(d, dia)
      }
      d = addDays(d, 1)
    }
  }
  for (const dia of salida.values()) {
    dia.personas.sort((x, y) => (x.status === y.status ? x.nombre.localeCompare(y.nombre, 'es') : x.status === 'aprobada' ? -1 : 1))
    const otros = dia.personas.filter((p) => p.employee_id !== opciones.yo).length
    dia.lleno = otros >= max
  }
  return salida
}

/* ------------------------------------------------------------------ */
/* Saldo antes / después                                               */
/* ------------------------------------------------------------------ */

export interface SaldoAntesDespues {
  anio: number
  dias: number
  antes: number
  despues: number
}

/**
 * Cómo queda el saldo de una persona con esta petición dentro, año a año (dos si cruza el 31 de diciembre). Es el
 * mismo cálculo que `checkVacationRequest`: no se inventa ninguna regla nueva, solo se enseña.
 * `peticion.id` (si ya existe) se saca de la foto «antes», para no contarla dos veces.
 */
export function saldoAntesDespues(
  empleado: VacationEmployee,
  peticiones: VacationRequest[],
  peticion: { id?: string | null; start_date: string; end_date: string },
  hoy: string,
  festivos: readonly string[] = []
): SaldoAntesDespues[] {
  const r = checkVacationRequest({
    employee: empleado,
    startDate: peticion.start_date,
    endDate: peticion.end_date,
    requests: peticiones,
    today: hoy,
    excludeId: peticion.id ?? null,
    holidays: festivos,
  })
  return r.byYear.map((y) => ({ anio: y.year, dias: y.days, antes: y.availableBefore, despues: y.availableAfter }))
}

/* ------------------------------------------------------------------ */
/* Rangos de consulta                                                  */
/* ------------------------------------------------------------------ */

/** Tope de días que se pueden pedir de golpe a /api/vacations/equipo (un año y pico) */
export const MAX_DIAS_EQUIPO = 400

/** Valida el ?desde&hasta del calendario del equipo. Devuelve el error para enseñar, o null */
export function errorDeRango(desde: unknown, hasta: unknown): string | null {
  const ok = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  if (!ok(desde) || !ok(hasta)) return 'Faltan las fechas del calendario (desde y hasta, aaaa-mm-dd)'
  if (hasta < desde) return 'La fecha final es anterior a la inicial'
  if (daysBetween(desde, hasta) + 1 > MAX_DIAS_EQUIPO) return `Como mucho se pueden pedir ${MAX_DIAS_EQUIPO} días de calendario de una vez`
  return null
}

/** Del 1 de enero al 31 de diciembre de ese año */
export const rangoDelAnio = (anio: number): { desde: string; hasta: string } => ({ desde: `${anio}-01-01`, hasta: `${anio}-12-31` })

/* ------------------------------------------------------------------ */
/* Textos de la campana                                                */
/* ------------------------------------------------------------------ */

export type EventoDeAviso = 'pedida' | 'aprobada' | 'rechazada' | 'cancelada'

/** La clave del aviso (índice único user_id + clave de la 251): el mismo evento no se avisa dos veces */
export const claveDeAviso = (requestId: string, evento: EventoDeAviso): string => `vac:${requestId}:${evento}`

const recortar = (t: string, n: number) => (t.length <= n ? t : `${t.slice(0, n - 1)}…`)

/** Al admin: alguien ha pedido días */
export function avisoDePedida(a: { nombre: string; start_date: string; end_date: string; dias: number; choque: ResultadoDeChoques | null; fueraDePlazo: boolean }): { titulo: string; mensaje: string } {
  const extras: string[] = []
  if (a.choque?.hay) extras.push(`choca con ${a.choque.coinciden.filter((c) => c.dias.some((d) => a.choque!.diasLlenos.includes(d))).map((c) => c.nombre).join(', ') || 'otra persona'}`)
  if (a.fueraDePlazo) extras.push('fuera de plazo')
  return {
    titulo: recortar(`${a.nombre} pide vacaciones`, 100),
    mensaje: recortar(`${formatDayRange(a.start_date, a.end_date)} · ${formatDays(a.dias)}${extras.length ? ` · ${extras.join(' · ')}` : ''}. Apruébala o deniégala en Vacaciones.`, 260),
  }
}

/** Al empleado: le han resuelto o anulado una petición */
export function avisoDeResolucion(a: { evento: Exclude<EventoDeAviso, 'pedida'>; start_date: string; end_date: string; motivo?: string | null }): { titulo: string; mensaje: string } {
  const rango = formatDayRange(a.start_date, a.end_date)
  if (a.evento === 'aprobada') return { titulo: 'Vacaciones aprobadas', mensaje: recortar(`Tus vacaciones ${rango} están aprobadas. ¡A disfrutarlas!`, 260) }
  if (a.evento === 'rechazada') return { titulo: 'Vacaciones denegadas', mensaje: recortar(`Tu petición ${rango} no se ha aprobado${a.motivo ? `: ${a.motivo}` : ''}.`, 260) }
  return { titulo: 'Vacaciones anuladas', mensaje: recortar(`Se han anulado tus vacaciones ${rango}${a.motivo ? `: ${a.motivo}` : ''}. Los días vuelven a tu saldo.`, 260) }
}
