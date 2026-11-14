/**
 * MIS HORAS · LÓGICA PURA DE APUNTAR HORAS
 * ========================================
 *
 * Lo que la pantalla de «Mis Horas» decide sin pintar nada: cómo se lee lo que
 * alguien escribe en la casilla de horas, qué hace el botón − / +, si un guardado
 * es «guardar», «borrar» o «error», el progreso del ciclo y el resumen del equipo.
 * Sin React ni navegador, para poder probarlo con
 * `npx tsx lib/payroll/horas.prueba.ts`.
 *
 *
 * ============ EL FALLO QUE ESTO ARREGLA: «7,5» BORRABA EL DÍA ============
 *
 * La casilla tiene inputMode="decimal" y en un teclado español o latino sale la
 * COMA. Antes se hacía `Number('7,5') || 0`: Number da NaN, el `|| 0` lo convierte
 * en 0 y guardar 0 BORRA la fila de ese día. O sea, quien escribía «7,5» perdía
 * las horas que tuviera apuntadas, sin ningún aviso. El − / + hacía lo mismo:
 * partía de 0 en vez de lo que había.
 *
 * Ahora:
 *   · la coma y el punto valen igual, y también «7h», «7 h» o «7:30»;
 *   · lo que no se entiende es un ERROR que se enseña, y NUNCA un borrado;
 *   · solo se borra cuando la casilla está vacía o pone 0 de verdad.
 */
import { cycleCostForUser, madridDayKey, type CostAppointment, type PersonCost } from '@/lib/payroll/cost'
import type { ManualAppointment, PayrollRate, WorkHourEntry } from '@/lib/types/payroll'

/** Lo más que se puede apuntar en un día. La base también lo exige (CHECK de 0 a 24 en la 083). */
export const MAX_HORAS_DIA = 24

export type LecturaDeHoras =
  | { tipo: 'vacio' }
  | { tipo: 'horas'; horas: number }
  | { tipo: 'invalido'; motivo: string }

/**
 * Lee lo que alguien ha escrito en la casilla de horas.
 *
 *   '7,5' → 7,5     '7.5' → 7,5     '7h' → 7     '7:30' → 7,5     '' → vacío
 *   'siete' → inválido      '-2' → inválido      '30' → inválido (más de 24)
 */
export function leerHoras(texto: string | null | undefined): LecturaDeHoras {
  const limpio = (texto ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/(horas|hora|hrs|hr|h)$/, '')
  if (limpio === '') return { tipo: 'vacio' }

  let horas: number
  const reloj = /^(\d{1,2}):(\d{1,2})$/.exec(limpio)
  if (reloj) {
    const minutos = Number(reloj[2])
    if (minutos >= 60) return { tipo: 'invalido', motivo: 'Los minutos van de 0 a 59' }
    horas = Number(reloj[1]) + minutos / 60
  } else {
    if (limpio.startsWith('-')) return { tipo: 'invalido', motivo: 'Las horas no pueden ser negativas' }
    // Una sola coma o un solo punto como separador decimal
    if (!/^(\d+([.,]\d*)?|[.,]\d+)$/.test(limpio)) {
      return { tipo: 'invalido', motivo: 'Escribe solo un número, por ejemplo 7,5' }
    }
    horas = Number(limpio.replace(',', '.'))
  }

  if (!Number.isFinite(horas)) return { tipo: 'invalido', motivo: 'Escribe solo un número, por ejemplo 7,5' }
  if (horas > MAX_HORAS_DIA) return { tipo: 'invalido', motivo: `Un día tiene ${MAX_HORAS_DIA} horas como mucho` }
  // Dos decimales bastan (7:20 = 7,33) y la columna es NUMERIC
  return { tipo: 'horas', horas: Math.round(horas * 100) / 100 }
}

/** «7,5», «8», «7,33»: siempre con coma, como el resto de la pantalla. */
export function formatoHoras(n: number): string {
  return n.toLocaleString('es-ES', { maximumFractionDigits: 2 })
}

/**
 * El botón − / + de media en media hora.
 *
 * Si lo escrito no se entiende, NO parte de 0 (que es lo que hacía y por lo que
 * acababa guardando un 0,5 encima de un 7,5): parte de lo que hay guardado ese
 * día y avisa.
 */
export function sumarHoras(texto: string, delta: number, guardado: number): { texto: string; aviso: string | null } {
  const l = leerHoras(texto)
  const base = l.tipo === 'horas' ? l.horas : l.tipo === 'vacio' ? 0 : guardado
  const resultado = Math.min(MAX_HORAS_DIA, Math.max(0, base + delta))
  return {
    texto: formatoHoras(resultado),
    aviso: l.tipo === 'invalido' ? `No entendía «${texto.trim()}»: sigo desde ${formatoHoras(guardado)} h` : null,
  }
}

export type DecisionDeGuardado =
  | { accion: 'guardar'; horas: number }
  | { accion: 'borrar' }
  | { accion: 'nada' }
  | { accion: 'error'; motivo: string }

/**
 * Qué hacer al pulsar «Guardar».
 *
 * Vacío o 0 sigue siendo «no he trabajado ese día» (se borra la fila, si la hay,
 * para no dejar un 0 suelto en el calendario). Lo que no se entiende es un error:
 * jamás se traduce en borrar.
 */
export function decidirGuardado(texto: string, hayFila: boolean): DecisionDeGuardado {
  const l = leerHoras(texto)
  if (l.tipo === 'invalido') return { accion: 'error', motivo: l.motivo }
  if (l.tipo === 'vacio' || l.horas === 0) return hayFila ? { accion: 'borrar' } : { accion: 'nada' }
  return { accion: 'guardar', horas: l.horas }
}

/** El cinturón del guardado: un valor que no es un número de 0 a 24 no llega a la base. */
export function horasValidas(valor: number | null): boolean {
  return valor === null || (Number.isFinite(valor) && valor >= 0 && valor <= MAX_HORAS_DIA)
}

/* ------------------------------------------------------------------ */
/* Fechas civiles 'yyyy-MM-dd'                                         */
/* ------------------------------------------------------------------ */

/** Lunes = 0 … Domingo = 6, leyendo la clave como fecha civil pura */
export function diaDeLaSemana(clave: string): number {
  const [y, m, d] = clave.split('-').map(Number)
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}

export const esLaborable = (clave: string) => diaDeLaSemana(clave) < 5

/** El día de cobro de un ciclo: el 15 del mes en que cierra (el ciclo 2026-11-15 se cobra el 2026-12-15). */
export function diaDeCobro(claveCiclo: string): string {
  const [y, m] = claveCiclo.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 15))
  return d.toISOString().slice(0, 10)
}

/** La clave del ciclo anterior: '2026-11-15' → '2026-10-15' */
export function cicloAnterior(claveCiclo: string): string {
  const [y, m] = claveCiclo.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 2, 15))
  return d.toISOString().slice(0, 10)
}

/** Los días del ciclo agrupados por semanas de lunes a domingo (la primera y la última pueden ir incompletas). */
export function semanasDelCiclo(dias: readonly string[]): string[][] {
  const semanas: string[][] = []
  for (const d of dias) {
    if (semanas.length === 0 || diaDeLaSemana(d) === 0) semanas.push([])
    semanas[semanas.length - 1].push(d)
  }
  return semanas
}

/* ------------------------------------------------------------------ */
/* Progreso del ciclo                                                  */
/* ------------------------------------------------------------------ */

export interface ProgresoDelCiclo {
  /** Días del ciclo */
  total: number
  /** Días que ya han empezado (hoy incluido). En un ciclo pasado, todos; en uno futuro, 0. */
  transcurridos: number
  /** Laborables (L–V) hasta hoy */
  laborablesHastaHoy: number
  /** De esos laborables, en cuántos hay horas */
  laborablesConHoras: number
  /** Días con horas (cualquiera, fines de semana incluidos) */
  diasConHoras: number
  /** Laborables del ciclo entero */
  laborablesTotales: number
}

export function progresoDelCiclo(dias: readonly string[], hoy: string, horasDe: (dia: string) => number): ProgresoDelCiclo {
  let transcurridos = 0
  let laborablesHastaHoy = 0
  let laborablesConHoras = 0
  let diasConHoras = 0
  let laborablesTotales = 0
  for (const d of dias) {
    const lab = esLaborable(d)
    const h = horasDe(d)
    if (lab) laborablesTotales += 1
    if (h > 0) diasConHoras += 1
    if (d <= hoy) {
      transcurridos += 1
      if (lab) {
        laborablesHastaHoy += 1
        if (h > 0) laborablesConHoras += 1
      }
    }
  }
  return { total: dias.length, transcurridos, laborablesHastaHoy, laborablesConHoras, diasConHoras, laborablesTotales }
}

/** Acumulado de una serie: [2, 3, 0, 4] → [2, 5, 5, 9]. Para las sparklines de dinero. */
export function acumulado(serie: readonly number[]): number[] {
  let s = 0
  return serie.map((v) => (s += v))
}

/**
 * El mismo punto del ciclo anterior: si hoy es el día 12 del ciclo (12 transcurridos), el día 12 del anterior.
 * Devuelve la clave 'yyyy-MM-dd' del último día que entra en la comparación, o null si aún no ha empezado ninguno.
 */
export function corteEquivalente(diasAnterior: readonly string[], transcurridos: number): string | null {
  if (transcurridos <= 0 || diasAnterior.length === 0) return null
  return diasAnterior[Math.min(transcurridos, diasAnterior.length) - 1]
}

/**
 * Lo devengado en el ciclo anterior HASTA el mismo punto, con el motor de la nómina (cycleCostForUser). Solo se recortan las
 * entradas por fecha; el cálculo del dinero es el de siempre.
 */
export function costeAnteriorHasta(
  userId: string,
  datos: { hours: WorkHourEntry[]; rates: PayrollRate[]; qualified: CostAppointment[]; manual: ManualAppointment[] },
  claveAnterior: string,
  corte: string | null,
): PersonCost | null {
  if (!corte) return null
  return cycleCostForUser(userId, {
    periodKey: claveAnterior,
    rates: datos.rates,
    hours: datos.hours.filter((h) => h.work_date <= corte),
    qualified: datos.qualified.filter((a) => madridDayKey(a.start_time) <= corte),
    manual: datos.manual.filter((m) => m.appointment_date <= corte),
  })
}

/* ------------------------------------------------------------------ */
/* El equipo                                                           */
/* ------------------------------------------------------------------ */

export interface FilaDeEquipo {
  userId: string
  nombre: string
  horas: number
  dias: number
  citas: number
  salario: number
  comisiones: number
  total: number
  /** Horas apuntadas hoy (0 si nada) */
  horasHoy: number
  /** true si hoy es laborable, está dentro del ciclo y no ha apuntado nada */
  sinApuntarHoy: boolean
}

/**
 * Una fila por persona con lo del ciclo, calculado con cycleCostForUser: el mismo motor que la nómina, Empleados y Tesorería.
 * `hoy` solo sirve para el aviso «no ha apuntado hoy», que solo tiene sentido en el ciclo que está en curso y en un día laborable.
 */
export function resumenDelEquipo(
  personas: ReadonlyArray<{ id: string; nombre: string }>,
  datos: { hours: WorkHourEntry[]; rates: PayrollRate[]; qualified: CostAppointment[]; manual: ManualAppointment[] },
  claveCiclo: string,
  dias: readonly string[],
  hoy: string,
): FilaDeEquipo[] {
  const enCiclo = new Set(dias)
  const hoyCuenta = enCiclo.has(hoy) && esLaborable(hoy)
  // Una sola pasada por las horas para los días trabajados y lo de hoy (sin recorrerlas una vez por persona)
  const diasPorPersona = new Map<string, Set<string>>()
  const hoyPorPersona = new Map<string, number>()
  for (const h of datos.hours) {
    if (!enCiclo.has(h.work_date) || Number(h.hours) <= 0) continue
    let s = diasPorPersona.get(h.user_id)
    if (!s) diasPorPersona.set(h.user_id, (s = new Set()))
    s.add(h.work_date)
    if (h.work_date === hoy) hoyPorPersona.set(h.user_id, Number(h.hours))
  }
  return personas.map((p) => {
    const c = cycleCostForUser(p.id, { periodKey: claveCiclo, ...datos })
    const horasHoy = hoyPorPersona.get(p.id) ?? 0
    return {
      userId: p.id,
      nombre: p.nombre,
      horas: c.hours,
      dias: diasPorPersona.get(p.id)?.size ?? 0,
      citas: c.appointments,
      salario: c.salary,
      comisiones: c.commissions,
      total: c.total,
      horasHoy,
      sinApuntarHoy: hoyCuenta && horasHoy === 0,
    }
  })
}
