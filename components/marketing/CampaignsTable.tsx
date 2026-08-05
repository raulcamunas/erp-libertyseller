'use client'

import { useMemo } from 'react'
import { Plus, Trash2, Check, KeyRound, CalendarPlus } from 'lucide-react'
import {
  MarketingCampaign,
  MarketingCampaignStatus,
  MarketingCampaignType,
  CAMPAIGN_TYPES,
  CAMPAIGN_TYPE_LABELS,
  CAMPAIGN_TYPE_COLORS,
  CAMPAIGN_STATUSES,
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_STATUS_COLORS,
  acos,
  ctr,
  cvr,
  formatEuros,
  formatInt,
  formatPct,
} from '@/lib/types/marketing'
import {
  inputValue,
  numInput,
  optionClass,
  parseDecimal,
  parseInteger,
  selectInput,
  sumMetrics,
  textInput,
} from './shared'

/** Recuento de keywords por campaña, para la píldora de la fila */
export interface CampaignKeywordCount {
  total: number
  pending: number
}

export interface CampaignsTableProps {
  campaigns: MarketingCampaign[]
  /** Las mismas campañas la semana anterior, cruzadas por nombre para el delta de ACoS */
  previousCampaigns: MarketingCampaign[]
  keywordCounts: Map<string, CampaignKeywordCount>
  selectedId: string | null
  onSelect: (id: string) => void
  onPatch: (campaign: MarketingCampaign, patch: Partial<MarketingCampaign>) => void
  onAdd: () => void
  onRemove: (campaign: MarketingCampaign) => void
  /** Sin semana creada no hay dónde meter campañas */
  hasWeek: boolean
  onCreateWeek: () => void
  className?: string
}

/**
 * CTR, CVR y ACoS salen de los datos crudos, no se teclean. Solo si falta el
 * denominador se cae al porcentaje que venga pegado de Amazon, que es lo que
 * ocurre cuando se vuelca un informe suyo sin las columnas de impresiones.
 */
function derived(c: MarketingCampaign) {
  return {
    ctr: ctr(c.clicks, c.impressions) ?? c.ctr,
    cvr: cvr(c.orders, c.clicks) ?? c.cvr,
    acos: acos(c.spend, c.sales) ?? c.acos,
  }
}

const th =
  'text-[10px] font-semibold text-white/40 uppercase tracking-wider border-b border-white/10 py-1.5 whitespace-nowrap'

export function CampaignsTable({
  campaigns,
  previousCampaigns,
  keywordCounts,
  selectedId,
  onSelect,
  onPatch,
  onAdd,
  onRemove,
  hasWeek,
  onCreateWeek,
  className = '',
}: CampaignsTableProps) {
  const totals = useMemo(() => sumMetrics(campaigns), [campaigns])

  // El nombre es lo único que se repite entre semanas: la fila de la semana
  // pasada es otra fila distinta con el mismo nombre.
  const previousAcos = useMemo(() => {
    const map = new Map<string, number | null>()
    for (const c of previousCampaigns) map.set(c.name.trim().toLowerCase(), derived(c).acos)
    return map
  }, [previousCampaigns])

  const reviewed = campaigns.filter((c) => c.review_status === 'hecho').length

  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/[0.02] flex flex-col min-h-0 overflow-hidden ${className}`}
    >
      <div className="px-3 py-2 border-b border-white/[0.06] flex items-center justify-between gap-2 flex-shrink-0">
        <h3 className="text-[10px] font-semibold text-white/45 uppercase tracking-wider flex items-center gap-2">
          Campañas
          <span className="text-white/25 normal-case tracking-normal">
            {reviewed}/{campaigns.length} revisadas
          </span>
        </h3>
        {hasWeek && (
          <button
            type="button"
            onClick={onAdd}
            className="text-[11px] font-medium text-white/45 hover:text-white transition-colors flex items-center gap-1"
          >
            <Plus className="h-3 w-3" /> Nueva campaña
          </button>
        )}
      </div>

      {!hasWeek ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <CalendarPlus className="h-6 w-6 text-white/20" />
          <p className="text-[13px] text-white/35">
            Esta semana todavía no está abierta para este cliente.
          </p>
          <button
            type="button"
            onClick={onCreateWeek}
            className="h-8 px-4 rounded-full bg-gradient-to-b from-[#FF7A1F] to-[#FF6600] text-white text-[12px] font-semibold"
          >
            Abrir la semana
          </button>
        </div>
      ) : campaigns.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-[13px] text-white/35">
            Sin campañas. Añade la primera o duplica la estructura de la semana pasada.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto min-w-0">
          <table className="w-full min-w-[1180px] text-[12px] border-collapse">
            <thead className="sticky top-0 bg-[#0d0d0d] z-10">
              <tr>
                <th className={`${th} text-left px-2.5 min-w-[190px]`}>Campaña</th>
                <th className={`${th} text-left px-1 w-[124px]`}>Tipo</th>
                <th className={`${th} text-left px-1 w-[92px]`}>Estado</th>
                <th className={`${th} text-right px-1 w-[76px]`}>Presup./día</th>
                <th className={`${th} text-right px-1 w-[82px]`}>Impr.</th>
                <th className={`${th} text-right px-1 w-[62px]`}>Clics</th>
                <th className={`${th} text-right px-1 w-[64px]`}>CTR</th>
                <th className={`${th} text-right px-1 w-[58px]`}>Pedidos</th>
                <th className={`${th} text-right px-1 w-[64px]`}>CVR</th>
                <th className={`${th} text-right px-1 w-[82px]`}>Gasto</th>
                <th className={`${th} text-right px-1 w-[88px]`}>Ventas</th>
                <th className={`${th} text-right px-1 w-[96px]`}>ACoS</th>
                <th className={`${th} text-right px-1 w-[76px]`}>TACoS</th>
                <th className={`${th} text-center px-1 w-[58px]`}>Revisada</th>
                <th className={`${th} w-[30px]`} />
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => {
                const d = derived(c)
                const prev = previousAcos.get(c.name.trim().toLowerCase())
                // Un ACoS que sube es dinero que se escapa, así que la flecha
                // hacia arriba tiene que ir en rojo: el color no puede salir
                // del signo.
                const acosDelta =
                  d.acos != null && prev != null && Number.isFinite(prev)
                    ? Number(d.acos) - Number(prev)
                    : null
                const counts = keywordCounts.get(c.id)
                const selected = c.id === selectedId

                return (
                  <tr
                    key={c.id}
                    onClick={() => onSelect(c.id)}
                    className={`border-b border-white/[0.04] group cursor-pointer transition-colors ${
                      selected
                        ? 'bg-[#FF6600]/[0.08]'
                        : c.review_status === 'hecho'
                          ? 'bg-green-500/[0.05] hover:bg-white/[0.03]'
                          : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    <td className="px-1.5 py-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="h-3 w-[3px] rounded-full flex-shrink-0"
                          style={{
                            backgroundColor: selected
                              ? '#FF6600'
                              : CAMPAIGN_TYPE_COLORS[c.campaign_type],
                          }}
                        />
                        <input
                          defaultValue={c.name}
                          key={`name-${c.id}`}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={(e) => {
                            const v = e.target.value.trim()
                            if (v && v !== c.name) onPatch(c, { name: v })
                            else e.target.value = c.name
                          }}
                          className={`${textInput} font-medium`}
                        />
                        {counts && counts.total > 0 && (
                          <span
                            className={`flex-shrink-0 flex items-center gap-0.5 text-[10px] tabular-nums px-1 py-0.5 rounded ${
                              counts.pending > 0
                                ? 'text-[#FF6600] bg-[#FF6600]/10'
                                : 'text-white/30'
                            }`}
                            title={
                              counts.pending > 0
                                ? `${counts.pending} de ${counts.total} keywords por aplicar`
                                : `${counts.total} keywords, todas aplicadas`
                            }
                          >
                            <KeyRound className="h-2.5 w-2.5" />
                            {counts.pending > 0 ? counts.pending : counts.total}
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="px-1 py-1">
                      <select
                        value={c.campaign_type}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          onPatch(c, {
                            campaign_type: e.target.value as MarketingCampaignType,
                          })
                        }
                        style={{ color: CAMPAIGN_TYPE_COLORS[c.campaign_type] }}
                        className={`${selectInput} w-full`}
                      >
                        {CAMPAIGN_TYPES.map((t) => (
                          <option key={t} value={t} className={optionClass}>
                            {CAMPAIGN_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="px-1 py-1">
                      <select
                        value={c.status}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) =>
                          onPatch(c, { status: e.target.value as MarketingCampaignStatus })
                        }
                        style={{ color: CAMPAIGN_STATUS_COLORS[c.status] }}
                        className={`${selectInput} w-full`}
                      >
                        {CAMPAIGN_STATUSES.map((s) => (
                          <option key={s} value={s} className={optionClass}>
                            {CAMPAIGN_STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="px-1 py-1">
                      <input
                        defaultValue={inputValue(c.daily_budget)}
                        key={`budget-${c.id}`}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => {
                          const parsed = parseDecimal(e.target.value)
                          if (parsed === undefined) {
                            e.target.value = inputValue(c.daily_budget)
                            return
                          }
                          if ((c.daily_budget ?? null) === parsed) return
                          onPatch(c, { daily_budget: parsed })
                        }}
                        inputMode="decimal"
                        placeholder="—"
                        className={numInput}
                      />
                    </td>

                    <td className="px-1 py-1">
                      <input
                        defaultValue={inputValue(c.impressions)}
                        key={`impr-${c.id}`}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => {
                          const parsed = parseInteger(e.target.value)
                          if (parsed === undefined) {
                            e.target.value = inputValue(c.impressions)
                            return
                          }
                          if ((c.impressions ?? null) === parsed) return
                          onPatch(c, { impressions: parsed })
                        }}
                        inputMode="numeric"
                        placeholder="—"
                        className={numInput}
                      />
                    </td>

                    <td className="px-1 py-1">
                      <input
                        defaultValue={inputValue(c.clicks)}
                        key={`clicks-${c.id}`}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => {
                          const parsed = parseInteger(e.target.value)
                          if (parsed === undefined) {
                            e.target.value = inputValue(c.clicks)
                            return
                          }
                          if ((c.clicks ?? null) === parsed) return
                          onPatch(c, { clicks: parsed })
                        }}
                        inputMode="numeric"
                        placeholder="—"
                        className={numInput}
                      />
                    </td>

                    <td className="px-1.5 py-1 text-right tabular-nums text-white/55">
                      {formatPct(d.ctr)}
                    </td>

                    <td className="px-1 py-1">
                      <input
                        defaultValue={inputValue(c.orders)}
                        key={`orders-${c.id}`}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => {
                          const parsed = parseInteger(e.target.value)
                          if (parsed === undefined) {
                            e.target.value = inputValue(c.orders)
                            return
                          }
                          if ((c.orders ?? null) === parsed) return
                          onPatch(c, { orders: parsed })
                        }}
                        inputMode="numeric"
                        placeholder="—"
                        className={numInput}
                      />
                    </td>

                    <td className="px-1.5 py-1 text-right tabular-nums text-white/55">
                      {formatPct(d.cvr)}
                    </td>

                    <td className="px-1 py-1">
                      <input
                        defaultValue={inputValue(c.spend)}
                        key={`spend-${c.id}`}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => {
                          const parsed = parseDecimal(e.target.value)
                          if (parsed === undefined) {
                            e.target.value = inputValue(c.spend)
                            return
                          }
                          if ((c.spend ?? null) === parsed) return
                          onPatch(c, { spend: parsed })
                        }}
                        inputMode="decimal"
                        placeholder="—"
                        className={numInput}
                      />
                    </td>

                    <td className="px-1 py-1">
                      <input
                        defaultValue={inputValue(c.sales)}
                        key={`sales-${c.id}`}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => {
                          const parsed = parseDecimal(e.target.value)
                          if (parsed === undefined) {
                            e.target.value = inputValue(c.sales)
                            return
                          }
                          if ((c.sales ?? null) === parsed) return
                          onPatch(c, { sales: parsed })
                        }}
                        inputMode="decimal"
                        placeholder="—"
                        className={numInput}
                      />
                    </td>

                    <td className="px-1.5 py-1 text-right tabular-nums">
                      <span className="inline-flex items-center gap-1 justify-end">
                        <span className="text-white font-semibold">{formatPct(d.acos)}</span>
                        {acosDelta != null && Math.abs(acosDelta) >= 0.1 && (
                          <span
                            className={`text-[9px] font-semibold ${
                              acosDelta < 0 ? 'text-green-300' : 'text-red-300'
                            }`}
                            title={`Semana pasada: ${formatPct(prev)}`}
                          >
                            {acosDelta > 0 ? '▲' : '▼'}
                            {Math.abs(acosDelta).toLocaleString('es-ES', {
                              maximumFractionDigits: 0,
                            })}
                          </span>
                        )}
                      </span>
                    </td>

                    {/* El TACoS es el único porcentaje que no se puede derivar
                        aquí: su denominador es la facturación total de la
                        cuenta, que este módulo no guarda. Se teclea. */}
                    <td className="px-1 py-1">
                      <input
                        defaultValue={inputValue(c.tacos)}
                        key={`tacos-${c.id}`}
                        onClick={(e) => e.stopPropagation()}
                        onBlur={(e) => {
                          const parsed = parseDecimal(e.target.value)
                          if (parsed === undefined) {
                            e.target.value = inputValue(c.tacos)
                            return
                          }
                          if ((c.tacos ?? null) === parsed) return
                          onPatch(c, { tacos: parsed })
                        }}
                        inputMode="decimal"
                        placeholder="—"
                        title="Gasto de la campaña sobre la facturación total de la cuenta"
                        className={numInput}
                        style={{ color: 'rgba(255,255,255,0.6)' }}
                      />
                    </td>

                    <td className="px-1 py-1 text-center">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onPatch(c, {
                            review_status: c.review_status === 'hecho' ? 'pendiente' : 'hecho',
                          })
                        }}
                        className={`h-5 w-5 rounded border flex items-center justify-center transition-colors mx-auto ${
                          c.review_status === 'hecho'
                            ? 'bg-green-500/25 border-green-500/50 text-green-300'
                            : 'border-white/15 text-transparent hover:border-white/35'
                        }`}
                        title={c.review_status === 'hecho' ? 'Revisada' : 'Marcar como revisada'}
                      >
                        <Check className="h-3 w-3" />
                      </button>
                    </td>

                    <td className="px-0.5 py-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onRemove(c)
                        }}
                        className="h-5 w-5 rounded flex items-center justify-center text-white/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                        title="Borrar campaña"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>

            <tfoot className="sticky bottom-0 bg-[#0d0d0d]">
              <tr className="text-[11px]">
                <td
                  colSpan={4}
                  className="px-2.5 py-2 uppercase tracking-wider text-white/40 border-t border-white/10"
                >
                  Total semana
                </td>
                <td className="px-1.5 py-2 text-right tabular-nums text-white/70 border-t border-white/10">
                  {formatInt(totals.impressions)}
                </td>
                <td className="px-1.5 py-2 text-right tabular-nums text-white/70 border-t border-white/10">
                  {formatInt(totals.clicks)}
                </td>
                <td className="px-1.5 py-2 text-right tabular-nums text-white/70 border-t border-white/10">
                  {formatPct(totals.ctr)}
                </td>
                <td className="px-1.5 py-2 text-right tabular-nums text-white/70 border-t border-white/10">
                  {formatInt(totals.orders)}
                </td>
                <td className="px-1.5 py-2 text-right tabular-nums text-white/70 border-t border-white/10">
                  {formatPct(totals.cvr)}
                </td>
                <td className="px-1.5 py-2 text-right tabular-nums text-red-300 font-semibold border-t border-white/10">
                  {formatEuros(totals.spend)}
                </td>
                <td className="px-1.5 py-2 text-right tabular-nums text-green-300 font-semibold border-t border-white/10">
                  {formatEuros(totals.sales)}
                </td>
                <td className="px-1.5 py-2 text-right tabular-nums text-white font-bold border-t border-white/10">
                  {formatPct(totals.acos)}
                </td>
                <td className="px-1.5 py-2 text-right tabular-nums text-white/70 border-t border-white/10">
                  {formatPct(totals.tacos)}
                </td>
                <td className="border-t border-white/10" colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
