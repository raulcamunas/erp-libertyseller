'use client'

import { useMemo } from 'react'
import { History, Loader2 } from 'lucide-react'
import { StockRun, formatInt } from '@/lib/types/stock-sync'
import { formatDateTime } from './shared'

export interface StockRunsHistoryProps {
  /** Últimos procesos del cliente, del más reciente al más antiguo */
  runs: StockRun[]
  /** El tablero está releyendo del servidor: tras procesar o tras importar */
  loading?: boolean
  className?: string
}

const th =
  'text-[10px] font-semibold text-white/40 uppercase tracking-wider border-b border-white/10 py-1.5 whitespace-nowrap'

export function StockRunsHistory({
  runs,
  loading = false,
  className = '',
}: StockRunsHistoryProps) {
  /**
   * Cuánto ha crecido el número de líneas sin casar respecto al proceso
   * anterior.
   *
   * Es el indicador de salud del módulo y el único que se puede leer de un
   * vistazo: que un lunes pasen de 86 a 300 no significa que el cliente haya
   * dado de alta 214 productos, significa que ha cambiado el formato del
   * volcado o que la exportación salió a medias. Sin la comparación, un
   * número grande parece normal porque el de al lado también lo es.
   */
  const deltas = useMemo(() => {
    const map = new Map<string, number | null>()
    runs.forEach((run, i) => {
      const previous = runs[i + 1]
      const a = run.rows_unmatched
      const b = previous?.rows_unmatched
      map.set(run.id, a == null || b == null ? null : a - b)
    })
    return map
  }, [runs])

  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/[0.02] flex flex-col min-h-0 overflow-hidden ${className}`}
    >
      <div className="px-3 py-2 border-b border-white/[0.06] flex items-center gap-2 flex-shrink-0 min-w-0">
        <h3 className="text-[10px] font-semibold text-white/45 uppercase tracking-wider flex items-center gap-2 truncate">
          {loading ? (
            <Loader2 className="h-3 w-3 text-[#FF6600] animate-spin flex-shrink-0" />
          ) : (
            <History className="h-3 w-3 flex-shrink-0" />
          )}
          Historial de procesos
        </h3>
      </div>

      {runs.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-6 text-center py-6">
          <p className="text-[13px] text-white/35">Todavía no se ha procesado ningún volcado.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto min-w-0">
          <table className="w-full min-w-[520px] text-[12px] border-collapse">
            <thead className="sticky top-0 bg-[#0d0d0d] z-10">
              <tr>
                <th className={`${th} text-left px-2.5 w-[112px]`}>Fecha</th>
                <th className={`${th} text-left px-1`}>Fichero</th>
                <th className={`${th} text-right px-1 w-[70px]`}>Casan</th>
                <th className={`${th} text-right px-1 w-[92px]`}>Sin casar</th>
                <th className={`${th} text-right px-2.5 w-[80px]`}>Unidades</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const delta = deltas.get(run.id) ?? null
                return (
                  <tr
                    key={run.id}
                    className="border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors"
                    title={run.notes ?? undefined}
                  >
                    <td className="px-2.5 py-1.5 text-white/70 tabular-nums whitespace-nowrap">
                      {formatDateTime(run.created_at)}
                    </td>
                    <td className="px-1 py-1.5 text-white/45 truncate max-w-0">
                      <span className="block truncate" title={run.source_filename ?? undefined}>
                        {run.source_filename ?? '—'}
                      </span>
                      {run.ean_filename && (
                        <span
                          className="block truncate text-[10px] text-white/25"
                          title={run.ean_filename}
                        >
                          + {run.ean_filename}
                        </span>
                      )}
                    </td>
                    <td className="px-1 py-1.5 text-right tabular-nums text-green-300/90">
                      {formatInt(run.rows_matched)}
                    </td>
                    <td className="px-1 py-1.5 text-right tabular-nums">
                      <span className={run.rows_unmatched ? 'text-red-300/90' : 'text-white/30'}>
                        {formatInt(run.rows_unmatched)}
                      </span>
                      {delta !== null && delta !== 0 && (
                        <span
                          className={`ml-1 text-[10px] ${
                            delta > 0 ? 'text-red-400' : 'text-green-400/70'
                          }`}
                          title={
                            delta > 0
                              ? `${delta} más que el proceso anterior. Si el salto es grande, mira el formato del volcado antes que el mapeo`
                              : `${Math.abs(delta)} menos que el proceso anterior`
                          }
                        >
                          {delta > 0 ? '▲' : '▼'}
                          {Math.abs(delta)}
                        </span>
                      )}
                    </td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums text-white/70">
                      {formatInt(run.total_units)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
