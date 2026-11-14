'use client'

import { useMemo } from 'react'
import {
  WorkHourEntry,
  comisionDeCita,
  PayrollRate,
  ManualAppointment,
  PayrollPeriod,
  payrollPeriod,
  periodDays,
  resolveRate,
  formatDollars,
} from '@/lib/types/payroll'
import { toMadrid } from '@/lib/timezone'
import { acumulado, cicloAnterior, corteEquivalente, costeAnteriorHasta, progresoDelCiclo } from '@/lib/payroll/horas'
import type { QualifiedAppointment } from './tipos'
import { nombreCortoDeMes } from './fechas'

/** Una cita que cobra en el ciclo, venga de la Agenda o añadida a mano */
export interface CitaDelCiclo {
  id: string
  name: string
  company: string | null
  at: Date
  /** 'yyyy-MM-dd' del día en España, que es con lo que se decide el mes (y lo que se pinta) */
  dia: string
  commission: number
  semi: boolean
  fijo: boolean
  manual: boolean
}

/** El día de una fecha en hora de España, que es con lo que se decide el mes */
const diaEnEspana = (iso: string | Date) => {
  const d = toMadrid(iso instanceof Date ? iso.toISOString() : iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * EL DINERO DEL CICLO, TAL CUAL ESTABA EN HoursTracker.
 *
 * Son los useMemo de la pantalla movidos aquí SIN CAMBIAR NI UNA CUENTA: sueldo día a día a la tarifa de su mes,
 * cada comisión a la tarifa del mes de su cita (comisionDeCita para la semi), las manuales con su importe fijo o la
 * del mes. Lo nuevo (series para las sparklines, progreso y comparativa con el ciclo anterior) va aparte y solo LEE
 * estos resultados o llama al motor de la nómina (cycleCostForUser).
 */
export function useNominaCiclo({
  hours,
  rates,
  appointments,
  manual,
  selectedUserId,
  offset,
  today,
}: {
  hours: WorkHourEntry[]
  rates: PayrollRate[]
  appointments: QualifiedAppointment[]
  manual: ManualAppointment[]
  selectedUserId: string
  offset: number
  today: string
}) {
  const period: PayrollPeriod = useMemo(() => payrollPeriod(offset), [offset])
  const days = useMemo(() => periodDays(period), [period])

  const hoursByDay = useMemo(() => {
    const map = new Map<string, WorkHourEntry>()
    for (const h of hours) {
      if (h.user_id === selectedUserId) map.set(h.work_date, h)
    }
    return map
  }, [hours, selectedUserId])

  const totalHours = useMemo(
    () => days.reduce((sum, d) => sum + Number(hoursByDay.get(d)?.hours ?? 0), 0),
    [days, hoursByDay]
  )

  const workedDays = useMemo(
    () => days.filter((d) => Number(hoursByDay.get(d)?.hours ?? 0) > 0).length,
    [days, hoursByDay]
  )

  /**
   * EL SUELDO, DÍA A DÍA: cada día a la tarifa de su mes. Un ciclo del 15 al 14 cruza dos meses y puede tener dos
   * tarifas; multiplicar todas las horas por una sola no cuadraba con la nómina.
   */
  const salary = useMemo(
    () =>
      days.reduce((suma, d) => {
        const h = Number(hoursByDay.get(d)?.hours ?? 0)
        if (h === 0) return suma
        return suma + h * resolveRate(rates, d).hourly
      }, 0),
    [days, hoursByDay, rates]
  )

  /**
   * Las citas del periodo, vengan de la agenda o añadidas a mano por un admin. Se muestran juntas porque para el
   * comercial son lo mismo: dos comisiones que cobra. La marca `manual` solo sirve para poder quitarla.
   */
  const periodQualified: CitaDelCiclo[] = useMemo(() => {
    const fromAgenda = appointments
      .filter((a) => a.comercial_id === selectedUserId)
      .filter((a) => {
        const t = new Date(a.start_time).getTime()
        return t >= period.start.getTime() && t < period.end.getTime()
      })
      .map((a) => ({
        id: a.id,
        name: a.lead_name,
        company: a.lead_company,
        at: new Date(a.start_time),
        dia: diaEnEspana(a.start_time),
        // La de SU día, no la del final del ciclo.
        commission: comisionDeCita(a.status, rates, diaEnEspana(a.start_time)),
        semi: a.status === 'semi_qualified',
        fijo: false,
        manual: false,
      }))

    const fromManual = manual
      .filter((m) => m.user_id === selectedUserId)
      .map((m) => ({
        id: m.id,
        name: m.lead_name,
        company: m.notes,
        // Mediodía UTC: así el día no se desplaza al comparar con los límites del ciclo, que son medianoche en España.
        at: new Date(`${m.appointment_date}T12:00:00Z`),
        dia: m.appointment_date,
        // Una cita a mano puede llevar su importe escrito, y entonces manda ese. Si se dejó en blanco, la del mes de su fecha.
        commission:
          m.commission != null
            ? Number(m.commission)
            : resolveRate(rates, m.appointment_date).commission,
        semi: false,
        fijo: m.commission != null,
        manual: true,
      }))
      .filter(
        (m) =>
          m.at.getTime() >= period.start.getTime() && m.at.getTime() < period.end.getTime()
      )

    return [...fromAgenda, ...fromManual].sort((a, b) => a.at.getTime() - b.at.getTime())
  }, [appointments, manual, selectedUserId, period, rates])

  /** LAS TARIFAS DEL CICLO, QUE PUEDEN SER DOS (el ciclo cruza dos meses). */
  const tarifasDelCiclo = useMemo(() => {
    const meses = [...new Set(days.map((d) => d.slice(0, 7)))].sort()
    const vistas = meses.map((mes) => {
      const r = resolveRate(rates, `${mes}-01`)
      const semi = r.commissionSemi > 0 ? ` · ${formatDollars(r.commissionSemi)}/semi` : ''
      return { mes, texto: `${formatDollars(r.hourly)}/h · ${formatDollars(r.commission)}/cita${semi}` }
    })
    // Si las dos mitades del ciclo cobran lo mismo, una línea basta.
    if (vistas.length > 1 && vistas.every((v) => v.texto === vistas[0].texto)) {
      return vistas[0].texto
    }
    return vistas.map((v) => `${nombreCortoDeMes(v.mes)} ${v.texto}`).join('  ·  ')
  }, [days, rates])

  /** «20 h × 15 $ · 20 h × 25 $» en vez de «40 h × 25 $». */
  const desgloseHoras = useMemo(() => {
    const porTarifa = new Map<number, number>()
    for (const d of days) {
      const h = Number(hoursByDay.get(d)?.hours ?? 0)
      if (h === 0) continue
      const t = resolveRate(rates, d).hourly
      porTarifa.set(t, (porTarifa.get(t) ?? 0) + h)
    }
    return [...porTarifa]
      .sort((a, b) => a[0] - b[0])
      .map(([tarifa, horas]) => `${horas.toLocaleString('es-ES')} h × ${formatDollars(tarifa)}`)
      .join(' · ')
  }, [days, hoursByDay, rates])

  /** LOS MESES DEL CICLO QUE NO TIENEN TARIFA PUESTA (y se están pagando a la de por defecto). */
  const mesesSinTarifa = useMemo(
    () =>
      [...new Set(days.map((d) => d.slice(0, 7)))]
        .sort()
        .filter((m) => resolveRate(rates, `${m}-01`).source === 'defecto'),
    [days, rates]
  )

  /** «3 × 15 $ · 2 × 25 $» en vez de «5 citas × 25 $». */
  const desgloseComisiones = useMemo(() => {
    const porImporte = new Map<number, number>()
    for (const a of periodQualified) {
      porImporte.set(a.commission, (porImporte.get(a.commission) ?? 0) + 1)
    }
    return [...porImporte]
      .sort((a, b) => a[0] - b[0])
      .map(([importe, cuantas]) => `${cuantas} × ${formatDollars(importe)}`)
      .join(' · ')
  }, [periodQualified])

  const commissions = periodQualified.reduce((sum, a) => sum + a.commission, 0)
  const semiDelPeriodo = periodQualified.filter((a) => a.semi).length
  const total = salary + commissions

  /* ------------------------------------------------------------------ */
  /* Lo nuevo: solo lee lo de arriba o llama al motor de la nómina       */
  /* ------------------------------------------------------------------ */

  const horasDe = (d: string) => Number(hoursByDay.get(d)?.hours ?? 0)

  const progreso = useMemo(() => progresoDelCiclo(days, today, horasDe), [days, today, hoursByDay]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Series diarias hasta hoy (o el ciclo entero si ya ha pasado) para las sparklines */
  const series = useMemo(() => {
    const visibles = days.filter((d) => d <= today)
    const base = visibles.length >= 2 ? visibles : days
    const horas = base.map((d) => Number(hoursByDay.get(d)?.hours ?? 0))
    const sueldoDia = base.map((d) => Number(hoursByDay.get(d)?.hours ?? 0) * resolveRate(rates, d).hourly)
    const comisionDia = base.map((d) => periodQualified.filter((a) => a.dia === d).reduce((s, a) => s + a.commission, 0))
    return { horas, sueldo: acumulado(sueldoDia), comisiones: acumulado(comisionDia) }
  }, [days, today, hoursByDay, rates, periodQualified])

  /** Lo que se llevaba en el ciclo anterior A ESTAS ALTURAS, con cycleCostForUser (el motor que paga). */
  const anterior = useMemo(() => {
    const claveAnt = cicloAnterior(period.key)
    const diasAnt = periodDays(payrollPeriod(offset - 1))
    const corte = corteEquivalente(diasAnt, progreso.transcurridos)
    return costeAnteriorHasta(selectedUserId, { hours, rates, qualified: appointments, manual }, claveAnt, corte)
  }, [period.key, offset, progreso.transcurridos, selectedUserId, hours, rates, appointments, manual])

  return {
    period,
    days,
    hoursByDay,
    totalHours,
    workedDays,
    salary,
    periodQualified,
    tarifasDelCiclo,
    desgloseHoras,
    mesesSinTarifa,
    desgloseComisiones,
    commissions,
    semiDelPeriodo,
    total,
    progreso,
    series,
    anterior,
  }
}

export type NominaCiclo = ReturnType<typeof useNominaCiclo>
