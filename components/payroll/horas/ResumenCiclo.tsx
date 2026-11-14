'use client'

import { AlertTriangle, ListChecks } from 'lucide-react'
import { Tarjeta } from '@/components/ui-ls'
import { formatoHoras } from '@/lib/payroll/horas'
import type { NominaCiclo } from './useNominaCiclo'
import { nombreCortoDeMes } from './fechas'

/** El resumen del ciclo de siempre (horas, días, media, citas y tarifa aplicada), ahora como tarjeta del kit. */
export function ResumenCiclo({ nomina, soloMirando }: { nomina: NominaCiclo; soloMirando: boolean }) {
  const { totalHours, workedDays, periodQualified, semiDelPeriodo, tarifasDelCiclo, mesesSinTarifa } = nomina
  const filas = [
    { label: 'Horas totales', value: `${formatoHoras(totalHours)} h` },
    { label: 'Días trabajados', value: String(workedDays) },
    { label: 'Media por día', value: workedDays ? `${(totalHours / workedDays).toFixed(1).replace('.', ',')} h` : '—' },
    // Las dos siguientes son dinero: fuera cuando solo se supervisa.
    ...(soloMirando
      ? []
      : [
          {
            label: 'Citas que cobran',
            value: semiDelPeriodo > 0 ? `${periodQualified.length - semiDelPeriodo} + ${semiDelPeriodo} semi` : String(periodQualified.length),
          },
          { label: 'Tarifa aplicada', value: tarifasDelCiclo },
        ]),
  ]
  return (
    <Tarjeta titulo="Resumen del ciclo" icono={ListChecks} acento="neutro" indice={1}>
      <dl className="space-y-2">
        {filas.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 text-[13px] text-[var(--ls-t3)]">{r.label}</dt>
            <dd className="text-right text-[13px] font-medium tabular-nums text-[var(--ls-t1)]">{r.value}</dd>
          </div>
        ))}
      </dl>
      {/* Cuando un mes del ciclo NO tiene tarifa se está pagando a la de por defecto: merece decirse. */}
      {mesesSinTarifa.length > 0 && !soloMirando && (
        <p className="mt-3 flex items-start gap-2 rounded-[10px] border border-[color-mix(in_srgb,var(--ls-e-ambar)_30%,transparent)] bg-[color-mix(in_srgb,var(--ls-e-ambar)_8%,transparent)] px-3 py-2 text-[12px] text-[var(--ls-e-ambar)]">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            Sin tarifa puesta en {mesesSinTarifa.map(nombreCortoDeMes).join(' y ')}: esa parte del ciclo se está pagando a la de por defecto.
          </span>
        </p>
      )}
    </Tarjeta>
  )
}
