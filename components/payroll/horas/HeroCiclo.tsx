'use client'

import { CalendarCheck, Clock, Wallet } from 'lucide-react'
import { BarraDeProgreso, CifraAnimada, Insignia, Tarjeta, Variacion } from '@/components/ui-ls'
import { formatDollars } from '@/lib/types/payroll'
import { diaDeCobro, formatoHoras } from '@/lib/payroll/horas'
import type { NominaCiclo } from './useNominaCiclo'
import { diaYMesLargo } from './fechas'

/**
 * LA CABECERA DEL CICLO: lo que llevas ganado en grande (o las horas, si solo se supervisa), la comparación con el
 * ciclo anterior A ESTAS ALTURAS (mismo número de días) y el progreso: días del ciclo y días laborables apuntados.
 *
 * Cuando se mira a otra persona sin ser admin (`soloMirando`) NO sale dinero: el supervisor ve horas, no sueldos.
 */
export function HeroCiclo({ nomina, soloMirando, enCurso }: { nomina: NominaCiclo; soloMirando: boolean; enCurso: boolean }) {
  const { progreso, anterior, total, totalHours, period } = nomina
  const cerrado = progreso.transcurridos >= progreso.total
  const futuro = progreso.transcurridos === 0

  const valor = soloMirando ? totalHours : total
  const valorAnterior = anterior ? (soloMirando ? anterior.hours : anterior.total) : null
  const formato = soloMirando ? (n: number) => `${formatoHoras(Math.round(n * 100) / 100)} h` : (n: number) => formatDollars(Math.round(n * 100) / 100)

  return (
    <Tarjeta variante="destacada" acento="marca" className="mb-4" cuerpoClassName="p-5 sm:p-6">
      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-[var(--ls-t3)]">
              {soloMirando ? <Clock className="h-3.5 w-3.5" /> : <Wallet className="h-3.5 w-3.5" />}
              {soloMirando ? 'Horas fichadas en este ciclo' : enCurso ? 'Llevas ganado este ciclo' : 'Ganado en este ciclo'}
            </span>
            {cerrado && <Insignia tono="gris" tamano="sm">Ciclo cerrado</Insignia>}
            {futuro && <Insignia tono="azul" tamano="sm">Aún no ha empezado</Insignia>}
            {enCurso && !cerrado && <Insignia tono="verde" vivo tamano="sm">En curso</Insignia>}
          </div>
          <div className="mt-2 text-[40px] font-semibold leading-none tracking-[-0.04em] text-[var(--ls-t1)] tabular-nums sm:text-[52px]">
            <CifraAnimada valor={valor} formato={formato} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px] text-[var(--ls-t3)]">
            {valorAnterior != null && valorAnterior > 0 ? (
              <>
                <Variacion actual={valor} anterior={valorAnterior} mejor="sube" />
                <span>
                  frente a {formato(valorAnterior)} {cerrado ? 'del ciclo anterior' : 'a estas alturas del ciclo anterior'}
                </span>
              </>
            ) : (
              !futuro && <span>Sin datos del ciclo anterior para comparar</span>
            )}
          </div>
          {!soloMirando && (
            <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-[var(--ls-t4)]">
              <CalendarCheck className="h-3.5 w-3.5" />
              Se cobra el {diaYMesLargo(diaDeCobro(period.key))}
            </p>
          )}
        </div>

        <div className="space-y-4 rounded-[12px] border border-[var(--ls-linea)] bg-[color-mix(in_srgb,var(--ls-sup2)_70%,transparent)] p-4">
          <BarraDeProgreso
            acento="marca"
            valor={progreso.transcurridos}
            maximo={progreso.total}
            etiqueta="Días del ciclo"
            detalle={futuro ? `0 de ${progreso.total}` : cerrado ? `${progreso.total} de ${progreso.total}` : `Día ${progreso.transcurridos} de ${progreso.total}`}
          />
          <BarraDeProgreso
            tono={progreso.laborablesHastaHoy > 0 && progreso.laborablesConHoras < progreso.laborablesHastaHoy ? 'ambar' : 'verde'}
            valor={progreso.laborablesConHoras}
            maximo={Math.max(1, progreso.laborablesHastaHoy)}
            etiqueta="Laborables con horas"
            detalle={`${progreso.laborablesConHoras} de ${progreso.laborablesHastaHoy}`}
          />
          <div className="flex items-baseline justify-between gap-3 text-[12px]">
            <span className="text-[var(--ls-t3)]">Horas · media por día trabajado</span>
            <span className="font-medium tabular-nums text-[var(--ls-t1)]">
              {formatoHoras(totalHours)} h · {nomina.workedDays ? `${formatoHoras(Math.round((totalHours / nomina.workedDays) * 10) / 10)} h` : '—'}
            </span>
          </div>
        </div>
      </div>
    </Tarjeta>
  )
}
