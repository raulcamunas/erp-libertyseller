'use client'

import { CalendarClock } from 'lucide-react'
import { diaConSemana, sumarDias } from '@/lib/cold-calling/fechas'
import { CAMPO } from '@/lib/estilo/denso'
import { ChipDeFiltro } from '@/components/rendimiento/ui'

/**
 * EL DÍA QUE SE MIRA EN LA AGENDA DE RELLAMADAS: hoy, mañana o el que se elija.
 *
 * Entrar en la agenda siempre te deja en HOY, y el día NO se recuerda de un día para otro (a diferencia de los filtros): una fecha
 * recordada de ayer abriría la pantalla en un día que ya pasó, con la lista vacía y sin ninguna pista de por qué. Aquí lo útil es
 * volver siempre a hoy; mirar otro día es una decisión del momento.
 */

interface Props {
  dia: string
  hoy: string
  onDia: (dia: string) => void
  /** Cuántas rellamadas tiene el día que se mira */
  delDia: number
  /** Las que se pasaron de fecha. Solo se cuentan mirando HOY */
  atrasadas: number
}

export function NavegadorDeDias({ dia, hoy, onDia, delDia, atrasadas }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ChipDeFiltro activo={dia === hoy} onClick={() => onDia(hoy)}>
        Hoy
      </ChipDeFiltro>
      <ChipDeFiltro activo={dia === sumarDias(hoy, 1)} onClick={() => onDia(sumarDias(hoy, 1))}>
        Mañana
      </ChipDeFiltro>
      <input
        type="date"
        value={dia}
        onChange={(e) => onDia(e.target.value || hoy)}
        aria-label="Mirar las rellamadas de otro día"
        title="Mirar las rellamadas de otro día"
        className={`${CAMPO.input} !h-6 !w-[128px] [color-scheme:dark] [.light_&]:[color-scheme:light]`}
      />
      <span className="flex items-center gap-1.5 text-[11.5px] text-[var(--ls-t3)]">
        <CalendarClock className="h-3.5 w-3.5 text-[var(--ls-t4)]" aria-hidden />
        <strong className="tabular-nums text-[var(--ls-t1)]">{delDia}</strong> {delDia === 1 ? 'rellamada' : 'rellamadas'} para el {diaConSemana(dia)}
        {dia === hoy && atrasadas > 0 && (
          <span className="text-[var(--ls-e-ambar)]">
            · {atrasadas} {atrasadas === 1 ? 'atrasada' : 'atrasadas'}
          </span>
        )}
      </span>
    </div>
  )
}
