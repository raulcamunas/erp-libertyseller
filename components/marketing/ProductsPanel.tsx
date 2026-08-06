'use client'

import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  CalendarPlus,
  Check,
  ChevronLeft,
  Package,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import {
  MarketingProduct,
  MarketingProductWeek,
  formatEuros,
  formatInt,
  formatPct,
} from '@/lib/types/marketing'
import {
  ClientTacos,
  ProductWeekStats,
  inputValue,
  numInput,
  parseDecimal,
  parseInteger,
  textInput,
} from './shared'

/** Alta de producto: solo el ASIN es obligatorio, es la clave de enlace */
export interface NewProductDraft {
  asin: string
  sku: string | null
  name: string | null
}

export interface ProductsPanelProps {
  /** Ya cruzados con sus cifras de la semana y con el gasto de sus campañas */
  stats: ProductWeekStats[]
  /** Agregado del cliente, para el pie y para el aviso de cobertura */
  summary: ClientTacos
  /** Identifica la semana abierta; sin ella las cifras semanales no tienen dónde guardarse */
  weekId: string | null
  onCreateWeek: () => void
  onPatchProduct: (product: MarketingProduct, patch: Partial<MarketingProduct>) => void
  onPatchWeek: (product: MarketingProduct, patch: Partial<MarketingProductWeek>) => void
  /** Devuelve si se creó, para saber si hay que cerrar el formulario */
  onAdd: (draft: NewProductDraft) => Promise<boolean>
  onRemove: (product: MarketingProduct) => void
  /** En móvil el panel ocupa toda la pantalla y hace falta volver a las campañas */
  showBack: boolean
  onBack: () => void
  className?: string
}

const th =
  'text-[10px] font-semibold text-white/40 uppercase tracking-wider border-b border-white/10 py-1.5 whitespace-nowrap'

/** Cabecera de grupo: de dónde sale cada bloque de columnas */
const thGroup =
  'text-[9px] font-semibold uppercase tracking-[0.12em] py-1 border-b border-white/[0.06] whitespace-nowrap'

const TACOS_HINT =
  'Gasto publicitario de todas sus campañas de la semana entre las ventas totales de Sellerboard. Mide el producto entero, no una campaña suelta.'

export function ProductsPanel({
  stats,
  summary,
  weekId,
  onCreateWeek,
  onPatchProduct,
  onPatchWeek,
  onAdd,
  onRemove,
  showBack,
  onBack,
  className = '',
}: ProductsPanelProps) {
  const [creating, setCreating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<NewProductDraft>({ asin: '', sku: null, name: null })

  const totals = useMemo(() => {
    let adSpend = 0
    let totalSales = 0
    let units = 0
    let margin = 0
    let withSales = 0
    let withMargin = 0

    for (const s of stats) {
      adSpend += s.adSpend
      if (s.totalSales != null) {
        totalSales += Number(s.totalSales) || 0
        withSales += 1
      }
      units += Number(s.unitsSold) || 0
      if (s.margin != null) {
        margin += s.margin
        withMargin += 1
      }
    }

    return {
      adSpend,
      units,
      totalSales: withSales > 0 ? totalSales : null,
      margin: withMargin > 0 ? margin : null,
    }
  }, [stats])

  const blind = stats.filter((s) => s.blind).length
  const pending = stats.filter((s) => s.totalSales == null).length

  async function submitDraft(e: React.FormEvent) {
    e.preventDefault()
    if (saving) return
    const asin = draft.asin.trim().toUpperCase().replace(/\s/g, '')
    if (!asin) return
    setSaving(true)
    const ok = await onAdd({
      asin,
      sku: draft.sku?.trim() || null,
      name: draft.name?.trim() || null,
    })
    setSaving(false)
    if (ok) {
      setDraft({ asin: '', sku: null, name: null })
      setCreating(false)
    }
  }

  const weekDisabled = !weekId

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
          <h3 className="text-[10px] font-semibold text-white/45 uppercase tracking-wider flex items-center gap-2 truncate">
            Productos
            <span className="text-white/25 normal-case tracking-normal">
              {stats.length - pending}/{stats.length} con ventas de Sellerboard
            </span>
          </h3>
        </div>
        {!creating && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="text-[11px] font-medium text-white/45 hover:text-white transition-colors flex items-center gap-1 flex-shrink-0"
          >
            <Plus className="h-3 w-3" /> Nuevo producto
          </button>
        )}
      </div>

      {creating && (
        <form
          onSubmit={submitDraft}
          className="px-3 py-2 border-b border-white/[0.06] flex flex-wrap items-center gap-1.5 flex-shrink-0 bg-white/[0.02]"
        >
          <input
            autoFocus
            value={draft.asin}
            onChange={(e) => setDraft((d) => ({ ...d, asin: e.target.value }))}
            placeholder="ASIN"
            className="h-8 w-[130px] rounded-lg border border-white/10 bg-white/[0.04] px-2 text-[12px] text-white font-mono uppercase outline-none focus:border-[#FF6600] placeholder:text-white/25 placeholder:font-sans placeholder:normal-case"
          />
          <input
            value={draft.sku ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, sku: e.target.value }))}
            placeholder="SKU"
            className="h-8 w-[120px] rounded-lg border border-white/10 bg-white/[0.04] px-2 text-[12px] text-white outline-none focus:border-[#FF6600] placeholder:text-white/25"
          />
          <input
            value={draft.name ?? ''}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="Nombre del producto"
            className="h-8 flex-1 min-w-[150px] rounded-lg border border-white/10 bg-white/[0.04] px-2 text-[12px] text-white outline-none focus:border-[#FF6600] placeholder:text-white/25"
          />
          <button
            type="submit"
            disabled={saving || !draft.asin.trim()}
            className="h-8 px-3 rounded-lg bg-gradient-to-b from-[#FF7A1F] to-[#FF6600] text-white text-[12px] font-semibold disabled:opacity-40"
          >
            {saving ? 'Añadiendo...' : 'Añadir'}
          </button>
          <button
            type="button"
            onClick={() => setCreating(false)}
            className="h-8 w-8 rounded-lg flex items-center justify-center text-white/40 hover:text-white transition-colors"
            title="Cancelar"
          >
            <X className="h-4 w-4" />
          </button>
        </form>
      )}

      {/* El aviso de arriba es el trabajo pendiente del especialista: mientras
          queden productos con gasto y sin ventas volcadas, ningún TACoS de esta
          pantalla cubre la cuenta entera. */}
      {(blind > 0 || summary.unlinkedCampaigns > 0) && (
        <div className="px-3 py-1.5 border-b border-white/[0.06] flex items-start gap-1.5 flex-shrink-0 bg-[#FBBF24]/[0.07]">
          <AlertTriangle className="h-3.5 w-3.5 text-[#FBBF24] flex-shrink-0 mt-[1px]" />
          <p className="text-[11px] text-[#FBBF24]/90 min-w-0">
            {blind > 0 && (
              <>
                {blind} {blind === 1 ? 'producto gasta' : 'productos gastan'} en publicidad sin
                ventas totales de Sellerboard
              </>
            )}
            {blind > 0 && summary.unlinkedCampaigns > 0 && ' · '}
            {summary.unlinkedCampaigns > 0 && (
              <>
                {summary.unlinkedCampaigns}{' '}
                {summary.unlinkedCampaigns === 1 ? 'campaña gasta' : 'campañas gastan'} sin producto
                enlazado
              </>
            )}
            <span className="text-[#FBBF24]/60">
              {' '}
              — {formatEuros(summary.uncoveredSpend)} de gasto fuera del TACoS
            </span>
          </p>
        </div>
      )}

      {stats.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <Package className="h-6 w-6 text-white/20" />
          <p className="text-[13px] text-white/35">
            Este cliente todavía no tiene productos dados de alta.
          </p>
          <p className="text-[11px] text-white/25 max-w-[380px]">
            El ASIN es lo que enlaza cada campaña con su producto, porque las campañas se nombran
            «ASIN | SKU | RESUMEN | TIPO».
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto min-w-0">
          <table className="w-full min-w-[1120px] text-[12px] border-collapse">
            <thead className="sticky top-0 bg-[#0d0d0d] z-10">
              <tr>
                <th
                  colSpan={4}
                  className={`${thGroup} text-left px-2.5 text-white/30`}
                  title="Ficha del producto: no cambia de una semana a otra"
                >
                  Catálogo
                </th>
                <th
                  colSpan={3}
                  className={`${thGroup} text-right px-1 text-[#34D399]/60`}
                  title="Se teclea desde Sellerboard con el mismo rango de fechas que se filtró en Amazon Ads"
                >
                  Semana · Sellerboard
                </th>
                <th
                  colSpan={5}
                  className={`${thGroup} text-right px-1 text-[#FF6600]/70`}
                  title="No se teclea: sale de las cifras de la izquierda y de las campañas de la semana enlazadas a este producto"
                >
                  Calculado
                </th>
              </tr>
              <tr>
                <th className={`${th} text-left px-2.5 min-w-[190px]`}>Producto</th>
                <th className={`${th} text-left px-1 w-[118px]`}>ASIN</th>
                <th className={`${th} text-left px-1 w-[110px]`}>SKU</th>
                <th className={`${th} text-center px-1 w-[54px]`}>Activo</th>
                <th className={`${th} text-right px-1 w-[106px]`} title="Orgánicas + publicidad">
                  Ventas totales
                </th>
                <th className={`${th} text-right px-1 w-[64px]`}>Uds.</th>
                <th className={`${th} text-right px-1 w-[86px]`}>Coste ud.</th>
                <th
                  className={`${th} text-right px-1 w-[96px]`}
                  title="Ventas totales menos coste × unidades. Bruto: no descuenta publicidad ni comisiones de Amazon"
                >
                  Margen
                </th>
                <th className={`${th} text-right px-1 w-[92px]`}>Gasto ads</th>
                <th className={`${th} text-right px-1 w-[84px]`} title={TACOS_HINT}>
                  TACoS
                </th>
                <th className={`${th} text-center px-1 w-[70px]`}>Campañas</th>
                <th className={`${th} w-[30px]`} />
              </tr>
            </thead>

            <tbody>
              {stats.map((s) => {
                const p = s.product
                // La clave lleva la semana porque el producto es el mismo de una
                // semana a otra: sin ella, los campos no controlados seguirían
                // enseñando la cifra de la semana anterior al navegar.
                const wk = `${p.id}-${weekId ?? 'sin-semana'}`

                return (
                  <tr
                    key={p.id}
                    className={`border-b border-white/[0.04] group transition-colors ${
                      s.blind
                        ? 'bg-[#FBBF24]/[0.07] hover:bg-[#FBBF24]/[0.11]'
                        : 'hover:bg-white/[0.03]'
                    } ${p.is_active ? '' : 'opacity-45'}`}
                  >
                    <td className="px-1.5 py-1">
                      <div className="flex items-center gap-1.5">
                        {/* Igual que en keywords: en una tabla larga el tinte de
                            fondo por sí solo no localiza lo pendiente. */}
                        <span
                          className="h-3.5 w-[3px] rounded-full flex-shrink-0"
                          style={{ backgroundColor: s.blind ? '#FBBF24' : 'transparent' }}
                          title={
                            s.blind
                              ? 'Gasta en publicidad y no tiene ventas totales: su TACoS está a ciegas esta semana'
                              : undefined
                          }
                        />
                        <input
                          defaultValue={p.name ?? ''}
                          key={`name-${p.id}`}
                          onBlur={(e) => {
                            const v = e.target.value.trim() || null
                            if (v !== (p.name ?? null)) onPatchProduct(p, { name: v })
                          }}
                          placeholder="Sin nombre"
                          className={`${textInput} font-medium`}
                        />
                      </div>
                    </td>

                    <td className="px-1 py-1">
                      <input
                        defaultValue={p.asin}
                        key={`asin-${p.id}`}
                        onBlur={(e) => {
                          const v = e.target.value.trim().toUpperCase().replace(/\s/g, '')
                          // Vaciarlo dejaría al producto sin clave de enlace y
                          // la columna es NOT NULL: se revierte sin tocar nada.
                          if (!v || v === p.asin) {
                            e.target.value = p.asin
                            return
                          }
                          onPatchProduct(p, { asin: v })
                        }}
                        title="Cambiarlo reenlaza las campañas que empiecen por este ASIN"
                        className={`${textInput} font-mono text-[11px] uppercase`}
                      />
                    </td>

                    <td className="px-1 py-1">
                      <input
                        defaultValue={p.sku ?? ''}
                        key={`sku-${p.id}`}
                        onBlur={(e) => {
                          const v = e.target.value.trim() || null
                          if (v !== (p.sku ?? null)) onPatchProduct(p, { sku: v })
                        }}
                        placeholder="—"
                        className={`${textInput} text-[11px]`}
                      />
                    </td>

                    <td className="px-1 py-1 text-center">
                      <button
                        type="button"
                        onClick={() => onPatchProduct(p, { is_active: !p.is_active })}
                        className={`h-5 w-5 rounded border flex items-center justify-center transition-colors mx-auto ${
                          p.is_active
                            ? 'bg-green-500/25 border-green-500/50 text-green-300'
                            : 'border-white/15 text-transparent hover:border-white/35'
                        }`}
                        title={p.is_active ? 'Activo' : 'Archivado'}
                      >
                        <Check className="h-3 w-3" />
                      </button>
                    </td>

                    <td className="px-1 py-1">
                      <input
                        defaultValue={inputValue(s.totalSales)}
                        key={`sales-${wk}`}
                        disabled={weekDisabled}
                        onBlur={(e) => {
                          const parsed = parseDecimal(e.target.value)
                          if (parsed === undefined) {
                            e.target.value = inputValue(s.totalSales)
                            return
                          }
                          if ((s.totalSales ?? null) === parsed) return
                          onPatchWeek(p, { total_sales: parsed })
                        }}
                        inputMode="decimal"
                        placeholder={weekDisabled ? '' : '—'}
                        title="Ventas totales del producto en Sellerboard, orgánicas + publicidad, con el mismo rango de fechas que Amazon Ads"
                        className={`${numInput} ${
                          s.blind ? 'ring-1 ring-[#FBBF24]/40 bg-[#FBBF24]/[0.06]' : ''
                        } disabled:opacity-30`}
                      />
                    </td>

                    <td className="px-1 py-1">
                      <input
                        defaultValue={inputValue(s.unitsSold)}
                        key={`units-${wk}`}
                        disabled={weekDisabled}
                        onBlur={(e) => {
                          const parsed = parseInteger(e.target.value)
                          if (parsed === undefined) {
                            e.target.value = inputValue(s.unitsSold)
                            return
                          }
                          if ((s.unitsSold ?? null) === parsed) return
                          onPatchWeek(p, { units_sold: parsed })
                        }}
                        inputMode="numeric"
                        placeholder={weekDisabled ? '' : '—'}
                        className={`${numInput} disabled:opacity-30`}
                      />
                    </td>

                    <td className="px-1 py-1">
                      <input
                        defaultValue={inputValue(s.unitCost)}
                        key={`cost-${wk}`}
                        disabled={weekDisabled}
                        onBlur={(e) => {
                          const parsed = parseDecimal(e.target.value)
                          if (parsed === undefined) {
                            e.target.value = inputValue(s.unitCost)
                            return
                          }
                          if ((s.unitCost ?? null) === parsed) return
                          onPatchWeek(p, { unit_cost: parsed })
                        }}
                        inputMode="decimal"
                        placeholder={weekDisabled ? '' : '—'}
                        title="Coste de compra por unidad esa semana: queda documentado aunque el proveedor lo cambie"
                        className={`${numInput} disabled:opacity-30`}
                      />
                    </td>

                    <td className="px-1.5 py-1 text-right tabular-nums text-white/55">
                      {formatEuros(s.margin)}
                    </td>

                    <td className="px-1.5 py-1 text-right tabular-nums text-red-300">
                      {s.campaigns > 0 ? formatEuros(s.adSpend) : '—'}
                    </td>

                    <td className="px-1.5 py-1 text-right tabular-nums">
                      {s.tacos != null ? (
                        <span
                          className="text-white font-semibold"
                          title={`${formatEuros(s.adSpend)} de gasto entre ${formatEuros(
                            s.totalSales
                          )} de ventas totales`}
                        >
                          {formatPct(s.tacos)}
                        </span>
                      ) : s.blind ? (
                        <span
                          className="text-[#FBBF24] font-semibold text-[11px]"
                          title="Falta volcar las ventas totales de Sellerboard de esta semana"
                        >
                          falta
                        </span>
                      ) : (
                        <span className="text-white/20">—</span>
                      )}
                    </td>

                    <td className="px-1 py-1 text-center">
                      {s.campaigns > 0 ? (
                        <span className="text-[11px] tabular-nums text-white/45">{s.campaigns}</span>
                      ) : (
                        <span
                          className="text-[10px] text-white/20"
                          title="Ninguna campaña de esta semana empieza por su ASIN ni está enlazada a mano"
                        >
                          sin enlazar
                        </span>
                      )}
                    </td>

                    <td className="px-0.5 py-1">
                      <button
                        type="button"
                        onClick={() => onRemove(p)}
                        className="h-5 w-5 rounded flex items-center justify-center text-white/20 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                        title="Borrar producto"
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
                <td className="px-1.5 py-2 text-right tabular-nums text-green-300 font-semibold border-t border-white/10">
                  {formatEuros(totals.totalSales)}
                </td>
                <td className="px-1.5 py-2 text-right tabular-nums text-white/70 border-t border-white/10">
                  {formatInt(totals.units)}
                </td>
                <td className="border-t border-white/10" />
                <td className="px-1.5 py-2 text-right tabular-nums text-white/70 border-t border-white/10">
                  {formatEuros(totals.margin)}
                </td>
                <td className="px-1.5 py-2 text-right tabular-nums text-red-300 font-semibold border-t border-white/10">
                  {formatEuros(totals.adSpend)}
                </td>
                <td className="px-1.5 py-2 text-right tabular-nums text-white font-bold border-t border-white/10">
                  <span className="inline-flex items-center gap-1">
                    {summary.partial && (
                      <AlertTriangle
                        className="h-3 w-3 text-[#FBBF24]"
                        aria-label="Parcial"
                      />
                    )}
                    {formatPct(summary.tacos)}
                  </span>
                </td>
                <td className="border-t border-white/10" colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {weekDisabled && stats.length > 0 && (
        <div className="px-3 py-2 border-t border-white/[0.06] flex items-center justify-between gap-2 flex-shrink-0 flex-wrap">
          <p className="text-[11px] text-white/35 flex items-center gap-1.5 min-w-0">
            <CalendarPlus className="h-3.5 w-3.5 flex-shrink-0" />
            Esta semana no está abierta: las cifras de Sellerboard no tienen dónde guardarse.
          </p>
          <button
            type="button"
            onClick={onCreateWeek}
            className="h-7 px-3 rounded-full bg-gradient-to-b from-[#FF7A1F] to-[#FF6600] text-white text-[11px] font-semibold flex-shrink-0"
          >
            Abrir la semana
          </button>
        </div>
      )}
    </div>
  )
}
