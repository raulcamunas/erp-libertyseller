'use client'

import type { LoteEnvio } from '@/lib/fba/plan-tipos'
import { cx } from '../comun/ui'
import { entero } from '../formato'
import { partesDelEmbudo, type ClaveEmbudo } from './useLotes'

/**
 * EL EMBUDO DE UN ENVÍO, AL 100 % (spec remesas-pro §5.3).
 *
 * Una barra partida: vendidas (--viz-1), retiradas o mermas (--ls-e-magenta), quedan (--viz-2) y no llegaron
 * (--ls-e-rojo, rayado). Las cuatro suman lo que se mandó y los porcentajes suman 100. Con `compacto` es la minibarra de
 * las tarjetas del móvil (sin leyenda).
 *
 *   <EmbudoLote embudo={lote.embudo} />
 *   <EmbudoLote embudo={lote.embudo} compacto />
 */

export const COLOR_EMBUDO: Record<ClaveEmbudo, string> = {
  vendidas: 'var(--viz-1)',
  retiradas: 'var(--ls-e-magenta)',
  quedan: 'var(--viz-2)',
  noLlegaron: 'var(--ls-e-rojo)',
}

/** El rayado de lo que no llegó: el color y la superficie en franjas de 45° (se distingue sin ver el color) */
export const RAYADO_ROJO = 'repeating-linear-gradient(135deg, var(--ls-e-rojo) 0 4px, color-mix(in srgb, var(--ls-e-rojo) 35%, var(--ls-sup)) 4px 7px)'

function fondo(clave: ClaveEmbudo): string {
  return clave === 'noLlegaron' ? RAYADO_ROJO : COLOR_EMBUDO[clave]
}

export function EmbudoLote({ embudo, compacto = false, className }: { embudo: LoteEnvio['embudo']; compacto?: boolean; className?: string }) {
  const partes = partesDelEmbudo(embudo)
  const total = partes.reduce((s, p) => s + p.valor, 0)
  const descripcion = partes
    .filter((p) => p.valor > 0)
    .map((p) => `${p.texto}: ${entero(p.valor)} (${p.pct} %)`)
    .join(', ')

  return (
    <div className={cx('min-w-0', className)}>
      <div
        role="img"
        aria-label={total > 0 ? `De ${entero(embudo.enviadas)} enviadas: ${descripcion}` : 'Sin unidades'}
        className={cx('flex w-full gap-[2px] overflow-hidden rounded-full bg-[var(--ls-sup3)]', compacto ? 'h-[6px]' : 'h-[14px]')}
      >
        {partes
          .filter((p) => p.valor > 0)
          .map((p) => (
            <span
              key={p.clave}
              title={`${p.texto}: ${entero(p.valor)} ud (${p.pct} %)`}
              className="h-full min-w-[3px] transition-[width] duration-500 first:rounded-l-full last:rounded-r-full motion-reduce:transition-none"
              style={{ width: `${Math.max(p.pct, 0.5)}%`, background: fondo(p.clave) }}
            />
          ))}
      </div>
      {!compacto && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          {partes.map((p) => (
            <div key={p.clave} className="min-w-0">
              <dt className="flex items-center gap-[6px] truncate text-[11.5px] font-medium text-[var(--ls-t3)]">
                <span className="h-[9px] w-[9px] shrink-0 rounded-[3px]" style={{ background: fondo(p.clave) }} aria-hidden />
                {p.texto}
              </dt>
              <dd className="mt-[2px] flex items-baseline gap-[6px]">
                <span className="text-[17px] font-semibold tabular-nums tracking-[-0.02em] text-[var(--ls-t1)]">{entero(p.valor)}</span>
                <span className="text-[12px] tabular-nums text-[var(--ls-t4)]">{p.pct} %</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
