'use client'

import type { ReactNode } from 'react'
import { PESTANAS_DEL_CRM, type PestanaDelCrm } from '@/lib/crm/pestanas'

/**
 * LA BARRA DE ARRIBA DEL CRM: CITA AGENDADA · EN SEGUIMIENTO · CERRADO.
 * ====================================================================
 * Tres pestañas grandes con cuántos leads hay en cada una. La activa lleva el filo naranja debajo y su punto de color (el mismo de la lista de siempre: azul, amarillo, verde).
 * A la derecha va lo que afecta a las tres (la búsqueda y, si se ven todos los clientes, el responsable). Qué hay dentro de cada pestaña lo decide lib/crm/pestanas.ts.
 */

const PUNTO: Record<PestanaDelCrm, string> = { cita: '#3B82F6', seguimiento: '#EAB308', cerrado: '#22C55E' }

export function BarraDePestanas({ activa, cuentas, onElegir, derecha }: { activa: PestanaDelCrm; cuentas: Record<PestanaDelCrm, number>; onElegir: (p: PestanaDelCrm) => void; derecha?: ReactNode }) {
  return (
    <div className="flex shrink-0 flex-wrap items-end gap-x-3 gap-y-1 border-b border-[var(--ls-linea)]">
      <div role="tablist" aria-label="Fases del CRM" className="flex min-w-0 items-end gap-0.5 overflow-x-auto">
        {PESTANAS_DEL_CRM.map((p) => {
          const encendida = activa === p.id
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={encendida}
              title={p.ayuda}
              onClick={() => onElegir(p.id)}
              className={`relative inline-flex h-[38px] shrink-0 items-center gap-1.5 whitespace-nowrap px-2.5 text-[12.5px] outline-none transition-colors focus-visible:bg-[var(--ls-sup3)] sm:gap-2 sm:px-3.5 sm:text-[13px] ${
                encendida ? 'font-semibold text-[var(--ls-t1)]' : 'font-medium text-[var(--ls-t3)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]'
              }`}
            >
              <span className="hidden h-[8px] w-[8px] shrink-0 rounded-full sm:block" style={{ backgroundColor: PUNTO[p.id], opacity: encendida ? 1 : 0.55 }} />
              {p.nombre}
              <span
                className={`inline-flex h-[18px] min-w-[22px] items-center justify-center rounded-[5px] px-1.5 text-[11px] font-semibold tabular-nums ${
                  encendida ? 'border border-[var(--ls-acc-borde)] bg-[var(--ls-acc-relleno)] text-[var(--ls-acc-tinta)]' : 'border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] text-[var(--ls-t3)]'
                }`}
              >
                {cuentas[p.id]}
              </span>
              {encendida && <span className="absolute inset-x-2 bottom-[-1px] h-[2px] rounded-t-[2px] bg-[var(--ls-acc-graf)]" />}
            </button>
          )
        })}
      </div>
      {derecha && <div className="flex min-w-0 flex-1 items-center justify-end gap-2 pb-[5px]">{derecha}</div>}
    </div>
  )
}
