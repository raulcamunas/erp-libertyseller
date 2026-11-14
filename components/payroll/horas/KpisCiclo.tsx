'use client'

import { CalendarDays, CheckCircle2, Clock, Gauge, Wallet } from 'lucide-react'
import { FilaDeKpis, Kpi, VIZ } from '@/components/ui-ls'
import { formatDollars } from '@/lib/types/payroll'
import { formatoHoras } from '@/lib/payroll/horas'
import type { NominaCiclo } from './useNominaCiclo'

const dolares = (n: number) => formatDollars(Math.round(n * 100) / 100)
const horas = (n: number) => `${formatoHoras(Math.round(n * 10) / 10)} h`

/**
 * LAS TRES CIFRAS DEL CICLO con su sparkline (en el móvil, carrusel con imán). Horas por día, y el sueldo y las
 * comisiones ACUMULADOS día a día. La variación es frente al ciclo anterior a estas alturas.
 * Solo mirando a otra persona sin ser admin: horas, días y media, sin dinero.
 */
export function KpisCiclo({ nomina, soloMirando }: { nomina: NominaCiclo; soloMirando: boolean }) {
  const { series, anterior, totalHours, workedDays, salary, commissions, periodQualified, semiDelPeriodo } = nomina

  if (soloMirando) {
    return (
      <FilaDeKpis className="mb-4">
        <Kpi indice={0} etiqueta="Horas" icono={Clock} acento="marca" valor={totalHours} formato={horas} anterior={anterior?.hours ?? null} serie={series.horas} nota={nomina.desgloseHoras ? `${workedDays} días con horas` : 'Sin horas todavía'} />
        <Kpi indice={1} etiqueta="Días trabajados" icono={CalendarDays} acento={VIZ[0]} valor={workedDays} nota={`de ${nomina.days.length} del ciclo`} />
        <Kpi indice={2} etiqueta="Media por día" icono={Gauge} acento={VIZ[2]} valor={workedDays ? totalHours / workedDays : null} formato={horas} nota="en los días con horas" />
      </FilaDeKpis>
    )
  }

  const citas = periodQualified.length
  return (
    <FilaDeKpis className="mb-4">
      <Kpi indice={0} etiqueta="Horas" icono={Clock} acento="marca" valor={totalHours} formato={horas} anterior={anterior?.hours ?? null} serie={series.horas} nota={workedDays ? `${workedDays} días · media ${horas(totalHours / workedDays)}` : 'Sin horas todavía'} />
      <Kpi indice={1} etiqueta="Salario" icono={Wallet} acento={VIZ[0]} valor={salary} formato={dolares} anterior={anterior?.salary ?? null} serie={series.sueldo} nota={nomina.desgloseHoras || 'Se suma al apuntar horas'} />
      <Kpi
        indice={2}
        etiqueta={semiDelPeriodo > 0 ? `Comisiones · ${citas - semiDelPeriodo} + ${semiDelPeriodo} semi` : `Comisiones · ${citas} ${citas === 1 ? 'cita' : 'citas'}`}
        icono={CheckCircle2}
        acento={VIZ[2]}
        valor={commissions}
        formato={dolares}
        anterior={anterior?.commissions ?? null}
        serie={series.comisiones}
        nota={citas === 0 ? 'Ninguna cita este ciclo' : nomina.desgloseComisiones}
      />
    </FilaDeKpis>
  )
}
