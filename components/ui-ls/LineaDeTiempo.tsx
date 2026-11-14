import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { COLOR_ESTADO, type TonoEstado } from '@/lib/estilo/denso'
import { cn } from '@/lib/utils'
import { haceCuanto, mezcla } from './utilidades'

/**
 * LÍNEA DE TIEMPO, para historiales (cambios de una tarea, vida de un envío, acciones sobre una cuenta). Del más reciente al más antiguo, en el orden que se le pase.
 * Cada hito: un nodo con icono (o punto) del color del tono, título, quién y cuándo, y una descripción opcional.
 *
 *   <LineaDeTiempo eventos={[
 *     { id: '1', titulo: 'Envío recibido en Amazon', cuando: '2026-11-13T09:12:00Z', tono: 'verde', icono: PackageCheck, autor: 'Amazon' },
 *     { id: '2', titulo: 'Cajas cerradas', descripcion: '12 cajas · 480 uds', cuando: …, autor: 'Ana' },
 *   ]} />
 *
 * Con más de `maximo` hitos (25 por defecto) se cortan y se dice cuántos quedan: un historial de cientos de líneas no se pinta entero.
 */
export interface Hito {
  id: string
  titulo: ReactNode
  descripcion?: ReactNode
  cuando: Date | string | number
  tono?: TonoEstado
  icono?: LucideIcon
  autor?: string
}

export function LineaDeTiempo({ eventos, maximo = 25, pieSiHayMas, className }: { eventos: readonly Hito[]; maximo?: number; pieSiHayMas?: ReactNode; className?: string }) {
  const vistos = eventos.slice(0, maximo)
  const resto = eventos.length - vistos.length
  return (
    <div className={className}>
      <ol className="relative">
        {vistos.map((h, i) => {
          const color = COLOR_ESTADO[h.tono ?? 'gris']
          const Icono = h.icono
          const ultimo = i === vistos.length - 1
          const fecha = h.cuando instanceof Date ? h.cuando : new Date(h.cuando)
          return (
            <li key={h.id} className="relative flex gap-3 pb-5 last:pb-0">
              {!ultimo && <span aria-hidden className="absolute bottom-0 left-[13px] top-7 w-px" style={{ background: `linear-gradient(180deg, ${mezcla(color, 45)}, var(--ls-linea))` }} />}
              <span
                aria-hidden
                className={cn('relative z-[1] flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full', i === 0 && 'ring-4 ring-[color-mix(in_srgb,var(--ls-sup)_100%,transparent)]')}
                style={{ background: Icono ? mezcla(color, 16) : 'var(--ls-sup)', boxShadow: `inset 0 0 0 1px ${mezcla(color, 45)}${i === 0 ? `, 0 0 14px ${mezcla(color, 35)}` : ''}`, color }}
              >
                {Icono ? <Icono className="h-[13px] w-[13px]" /> : <span className="h-[7px] w-[7px] rounded-full" style={{ background: color }} />}
              </span>
              <div className="min-w-0 flex-1 pt-[3px]">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-[2px]">
                  <span className="text-[13px] font-medium text-[var(--ls-t1)]">{h.titulo}</span>
                  <time dateTime={Number.isFinite(fecha.getTime()) ? fecha.toISOString() : undefined} title={Number.isFinite(fecha.getTime()) ? fecha.toLocaleString('es-ES') : undefined} className="shrink-0 text-[11.5px] tabular-nums text-[var(--ls-t4)]">
                    {haceCuanto(fecha)}
                  </time>
                </div>
                {h.autor && <div className="text-[12px] text-[var(--ls-t3)]">{h.autor}</div>}
                {h.descripcion && <div className="mt-[6px] rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2 text-[12.5px] leading-[1.5] text-[var(--ls-t2)]">{h.descripcion}</div>}
              </div>
            </li>
          )
        })}
      </ol>
      {resto > 0 && <div className="mt-3 pl-[39px] text-[12px] text-[var(--ls-t4)]">{pieSiHayMas ?? `Y ${resto.toLocaleString('es-ES')} más antiguos`}</div>}
    </div>
  )
}
