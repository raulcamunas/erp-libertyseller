'use client'

import { useMemo } from 'react'
import {
  Plus,
  Trash2,
  Check,
  ChevronLeft,
  MousePointerClick,
  ArrowUp,
  ArrowDown,
  Pause,
  Ban,
  type LucideIcon,
} from 'lucide-react'
import {
  MarketingCampaign,
  MarketingKeyword,
  MarketingBidAction,
  MarketingMatchType,
  BID_ACTIONS,
  BID_ACTION_LABELS,
  BID_ACTION_COLORS,
  MATCH_TYPES,
  MATCH_TYPE_LABELS,
  MATCH_TYPE_COLORS,
  acos,
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

export interface KeywordsPanelProps {
  campaign: MarketingCampaign | null
  keywords: MarketingKeyword[]
  onPatch: (keyword: MarketingKeyword, patch: Partial<MarketingKeyword>) => void
  onAdd: () => void
  onRemove: (keyword: MarketingKeyword) => void
  /** En móvil el panel ocupa toda la pantalla y hace falta volver a las campañas */
  showBack: boolean
  onBack: () => void
  className?: string
}

const th =
  'text-[10px] font-semibold text-white/40 uppercase tracking-wider border-b border-white/10 py-1.5 whitespace-nowrap'

const ACTION_ICONS: Partial<Record<MarketingBidAction, LucideIcon>> = {
  subir: ArrowUp,
  bajar: ArrowDown,
  pausar: Pause,
  negativizar: Ban,
}

export function KeywordsPanel({
  campaign,
  keywords,
  onPatch,
  onAdd,
  onRemove,
  showBack,
  onBack,
  className = '',
}: KeywordsPanelProps) {
  const totals = useMemo(() => sumMetrics(keywords), [keywords])

  // Lo que hay que ejecutar en Seller Central esta semana: todo lo que no sea
  // «mantener» y siga sin aplicar. Es el único número que de verdad manda el
  // trabajo del día, así que va arriba y en naranja.
  const summary = useMemo(() => {
    const counts: Record<MarketingBidAction, number> = {
      mantener: 0,
      subir: 0,
      bajar: 0,
      pausar: 0,
      negativizar: 0,
      nueva: 0,
    }
    let pending = 0
    for (const k of keywords) {
      counts[k.action] += 1
      if (k.action !== 'mantener' && !k.applied) pending += 1
    }
    return { counts, pending }
  }, [keywords])

  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/[0.02] flex flex-col min-h-0 overflow-hidden ${className}`}
    >
      <div className="px-3 py-2 border-b border-white/[0.06] flex items-center justify-between gap-2 flex-shrink-0 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {showBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1 text-[12px] font-medium text-white/60 hover:text-white transition-colors flex-shrink-0"
            >
              <ChevronLeft className="h-4 w-4" /> Campañas
            </button>
          )}
          <h3 className="text-[10px] font-semibold text-white/45 uppercase tracking-wider truncate">
            Keywords
            {campaign && (
              <span className="text-white/70 normal-case tracking-normal"> · {campaign.name}</span>
            )}
          </h3>
        </div>
        {campaign && (
          <button
            type="button"
            onClick={onAdd}
            className="text-[11px] font-medium text-white/45 hover:text-white transition-colors flex items-center gap-1 flex-shrink-0"
          >
            <Plus className="h-3 w-3" /> Nueva
          </button>
        )}
      </div>

      {!campaign ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <MousePointerClick className="h-6 w-6 text-white/20" />
          <p className="text-[13px] text-white/35">
            Pulsa una campaña para ver y ajustar sus palabras clave.
          </p>
        </div>
      ) : (
        <>
          {/* Resumen de acciones */}
          <div className="px-3 py-2 border-b border-white/[0.06] flex flex-wrap items-center gap-1.5 flex-shrink-0">
            {(['subir', 'bajar', 'pausar', 'negativizar'] as MarketingBidAction[]).map((a) => {
              const Icon = ACTION_ICONS[a]
              const n = summary.counts[a]
              return (
                <span
                  key={a}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium tabular-nums"
                  style={{
                    color: n > 0 ? BID_ACTION_COLORS[a] : undefined,
                    borderColor: n > 0 ? `${BID_ACTION_COLORS[a]}55` : 'rgba(255,255,255,0.08)',
                  }}
                >
                  {Icon && <Icon className="h-3 w-3" />}
                  <span className={n > 0 ? '' : 'text-white/25'}>
                    {n} {BID_ACTION_LABELS[a].toLowerCase()}
                  </span>
                </span>
              )
            })}
            <span className="flex-1" />
            {summary.pending > 0 ? (
              <span className="px-2 py-0.5 rounded-full bg-[#FF6600]/15 border border-[#FF6600]/40 text-[#FF6600] text-[11px] font-semibold tabular-nums">
                {summary.pending} por aplicar en Amazon
              </span>
            ) : keywords.length > 0 ? (
              <span className="px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/30 text-green-300 text-[11px] font-semibold flex items-center gap-1">
                <Check className="h-3 w-3" /> Todo aplicado
              </span>
            ) : null}
          </div>

          {keywords.length === 0 ? (
            <div className="flex-1 flex items-center justify-center px-6 text-center">
              <p className="text-[13px] text-white/35">
                Esta campaña no tiene keywords apuntadas todavía.
              </p>
            </div>
          ) : (
            <div className="flex-1 overflow-auto min-w-0">
              <table className="w-full min-w-[1120px] text-[12px] border-collapse">
                <thead className="sticky top-0 bg-[#0d0d0d] z-10">
                  <tr>
                    <th className={`${th} text-left px-2.5 min-w-[190px]`}>Palabra clave</th>
                    <th className={`${th} text-left px-1 w-[104px]`}>Concordancia</th>
                    <th className={`${th} text-right px-1 w-[74px]`}>Puja</th>
                    <th className={`${th} text-right px-1 w-[92px]`}>Sugerida</th>
                    <th className={`${th} text-left px-1 w-[110px]`}>Acción</th>
                    <th className={`${th} text-center px-1 w-[58px]`}>Aplicada</th>
                    <th className={`${th} text-right px-1 w-[76px]`}>Impr.</th>
                    <th className={`${th} text-right px-1 w-[58px]`}>Clics</th>
                    <th className={`${th} text-right px-1 w-[58px]`}>Pedidos</th>
                    <th className={`${th} text-right px-1 w-[78px]`}>Gasto</th>
                    <th className={`${th} text-right px-1 w-[82px]`}>Ventas</th>
                    <th className={`${th} text-right px-1 w-[74px]`}>ACoS</th>
                    <th className={`${th} text-left px-1 min-w-[150px]`}>Notas</th>
                    <th className={`${th} w-[30px]`} />
                  </tr>
                </thead>
                <tbody>
                  {keywords.map((k) => {
                    const kAcos = acos(k.spend, k.sales) ?? k.acos
                    const todo = k.action !== 'mantener' && !k.applied
                    // Diferencia entre lo que hay puesto y lo que se propone:
                    // es la magnitud del movimiento, que decide si merece la
                    // pena tocarlo o no.
                    const bidDelta =
                      k.current_bid != null && k.suggested_bid != null
                        ? Number(k.suggested_bid) - Number(k.current_bid)
                        : null

                    return (
                      <tr
                        key={k.id}
                        className={`border-b border-white/[0.04] group transition-colors ${
                          todo
                            ? 'bg-[#FF6600]/[0.07] hover:bg-[#FF6600]/[0.11]'
                            : k.applied && k.action !== 'mantener'
                              ? 'bg-green-500/[0.05] hover:bg-white/[0.03]'
                              : 'hover:bg-white/[0.03]'
                        }`}
                      >
                        <td className="px-1.5 py-1">
                          <div className="flex items-center gap-1.5">
                            {/* Franja naranja al principio de la fila: en una
                                tabla larga el tinte de fondo solo no basta
                                para localizar lo pendiente de un vistazo. */}
                            <span
                              className="h-3.5 w-[3px] rounded-full flex-shrink-0"
                              style={{
                                backgroundColor: todo ? '#FF6600' : 'transparent',
                              }}
                            />
                            <input
                              defaultValue={k.keyword}
                              key={`kw-${k.id}`}
                              onBlur={(e) => {
                                const v = e.target.value.trim()
                                if (v && v !== k.keyword) onPatch(k, { keyword: v })
                                else e.target.value = k.keyword
                              }}
                              className={`${textInput} font-medium`}
                            />
                          </div>
                        </td>

                        <td className="px-1 py-1">
                          <select
                            value={k.match_type}
                            onChange={(e) =>
                              onPatch(k, { match_type: e.target.value as MarketingMatchType })
                            }
                            style={{ color: MATCH_TYPE_COLORS[k.match_type] }}
                            className={`${selectInput} w-full`}
                          >
                            {MATCH_TYPES.map((m) => (
                              <option key={m} value={m} className={optionClass}>
                                {MATCH_TYPE_LABELS[m]}
                              </option>
                            ))}
                          </select>
                        </td>

                        <td className="px-1 py-1">
                          <input
                            defaultValue={inputValue(k.current_bid)}
                            key={`bid-${k.id}`}
                            onBlur={(e) => {
                              const parsed = parseDecimal(e.target.value)
                              if (parsed === undefined) {
                                e.target.value = inputValue(k.current_bid)
                                return
                              }
                              if ((k.current_bid ?? null) === parsed) return
                              onPatch(k, { current_bid: parsed })
                            }}
                            inputMode="decimal"
                            placeholder="—"
                            className={numInput}
                          />
                        </td>

                        <td className="px-1 py-1">
                          <div className="flex items-center gap-1 justify-end">
                            <input
                              defaultValue={inputValue(k.suggested_bid)}
                              key={`sbid-${k.id}`}
                              onBlur={(e) => {
                                const parsed = parseDecimal(e.target.value)
                                if (parsed === undefined) {
                                  e.target.value = inputValue(k.suggested_bid)
                                  return
                                }
                                if ((k.suggested_bid ?? null) === parsed) return
                                onPatch(k, { suggested_bid: parsed })
                              }}
                              inputMode="decimal"
                              placeholder="—"
                              className={numInput}
                              style={k.suggested_bid != null ? { color: '#FF6600' } : undefined}
                            />
                            {bidDelta != null && Math.abs(bidDelta) >= 0.005 && (
                              <span
                                className={`text-[9px] font-semibold tabular-nums flex-shrink-0 w-[28px] ${
                                  bidDelta > 0 ? 'text-green-300' : 'text-yellow-300'
                                }`}
                              >
                                {bidDelta > 0 ? '+' : ''}
                                {bidDelta.toLocaleString('es-ES', {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}
                              </span>
                            )}
                          </div>
                        </td>

                        <td className="px-1 py-1">
                          <select
                            value={k.action}
                            onChange={(e) =>
                              onPatch(k, { action: e.target.value as MarketingBidAction })
                            }
                            style={{ color: BID_ACTION_COLORS[k.action] }}
                            className={`${selectInput} w-full`}
                          >
                            {BID_ACTIONS.map((a) => (
                              <option key={a} value={a} className={optionClass}>
                                {BID_ACTION_LABELS[a]}
                              </option>
                            ))}
                          </select>
                        </td>

                        <td className="px-1 py-1 text-center">
                          <button
                            type="button"
                            onClick={() => onPatch(k, { applied: !k.applied })}
                            className={`h-5 w-5 rounded border flex items-center justify-center transition-colors mx-auto ${
                              k.applied
                                ? 'bg-green-500/25 border-green-500/50 text-green-300'
                                : 'border-white/15 text-transparent hover:border-white/35'
                            }`}
                            title={
                              k.applied ? 'Ya ejecutada en Amazon' : 'Marcar como ejecutada en Amazon'
                            }
                          >
                            <Check className="h-3 w-3" />
                          </button>
                        </td>

                        <td className="px-1 py-1">
                          <input
                            defaultValue={inputValue(k.impressions)}
                            key={`kimpr-${k.id}`}
                            onBlur={(e) => {
                              const parsed = parseInteger(e.target.value)
                              if (parsed === undefined) {
                                e.target.value = inputValue(k.impressions)
                                return
                              }
                              if ((k.impressions ?? null) === parsed) return
                              onPatch(k, { impressions: parsed })
                            }}
                            inputMode="numeric"
                            placeholder="—"
                            className={numInput}
                          />
                        </td>

                        <td className="px-1 py-1">
                          <input
                            defaultValue={inputValue(k.clicks)}
                            key={`kclicks-${k.id}`}
                            onBlur={(e) => {
                              const parsed = parseInteger(e.target.value)
                              if (parsed === undefined) {
                                e.target.value = inputValue(k.clicks)
                                return
                              }
                              if ((k.clicks ?? null) === parsed) return
                              onPatch(k, { clicks: parsed })
                            }}
                            inputMode="numeric"
                            placeholder="—"
                            className={numInput}
                          />
                        </td>

                        <td className="px-1 py-1">
                          <input
                            defaultValue={inputValue(k.orders)}
                            key={`korders-${k.id}`}
                            onBlur={(e) => {
                              const parsed = parseInteger(e.target.value)
                              if (parsed === undefined) {
                                e.target.value = inputValue(k.orders)
                                return
                              }
                              if ((k.orders ?? null) === parsed) return
                              onPatch(k, { orders: parsed })
                            }}
                            inputMode="numeric"
                            placeholder="—"
                            className={numInput}
                          />
                        </td>

                        <td className="px-1 py-1">
                          <input
                            defaultValue={inputValue(k.spend)}
                            key={`kspend-${k.id}`}
                            onBlur={(e) => {
                              const parsed = parseDecimal(e.target.value)
                              if (parsed === undefined) {
                                e.target.value = inputValue(k.spend)
                                return
                              }
                              if ((k.spend ?? null) === parsed) return
                              onPatch(k, { spend: parsed })
                            }}
                            inputMode="decimal"
                            placeholder="—"
                            className={numInput}
                          />
                        </td>

                        <td className="px-1 py-1">
                          <input
                            defaultValue={inputValue(k.sales)}
                            key={`ksales-${k.id}`}
                            onBlur={(e) => {
                              const parsed = parseDecimal(e.target.value)
                              if (parsed === undefined) {
                                e.target.value = inputValue(k.sales)
                                return
                              }
                              if ((k.sales ?? null) === parsed) return
                              onPatch(k, { sales: parsed })
                            }}
                            inputMode="decimal"
                            placeholder="—"
                            className={numInput}
                          />
                        </td>

                        <td className="px-1.5 py-1 text-right tabular-nums text-white font-semibold">
                          {formatPct(kAcos)}
                        </td>

                        <td className="px-1 py-1">
                          <input
                            defaultValue={k.notes ?? ''}
                            key={`knotes-${k.id}`}
                            onBlur={(e) => {
                              const v = e.target.value.trim()
                              if ((k.notes ?? '') === v) return
                              onPatch(k, { notes: v || null })
                            }}
                            placeholder="—"
                            className={textInput}
                            style={{ color: 'rgba(255,255,255,0.65)' }}
                          />
                        </td>

                        <td className="px-0.5 py-1">
                          <button
                            type="button"
                            onClick={() => onRemove(k)}
                            className="h-5 w-5 rounded flex items-center justify-center text-white/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                            title="Borrar keyword"
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
                      colSpan={6}
                      className="px-2.5 py-2 uppercase tracking-wider text-white/40 border-t border-white/10"
                    >
                      Total {keywords.length} keywords
                    </td>
                    <td className="px-1.5 py-2 text-right tabular-nums text-white/70 border-t border-white/10">
                      {formatInt(totals.impressions)}
                    </td>
                    <td className="px-1.5 py-2 text-right tabular-nums text-white/70 border-t border-white/10">
                      {formatInt(totals.clicks)}
                    </td>
                    <td className="px-1.5 py-2 text-right tabular-nums text-white/70 border-t border-white/10">
                      {formatInt(totals.orders)}
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
                    <td className="border-t border-white/10" colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
