'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {
  StockMapping,
  formatInt,
  normalizeCode,
  normalizeEan,
} from '@/lib/types/stock-sync'
import { ImportResult, cleanSkuText, codeInput, errorMessage, textInput } from './shared'

/** Lo mínimo para dar de alta una línea a mano; el resto se rellena editando */
export interface NewMappingDraft {
  sku_amazon: string
  ref_erp: string | null
  asin: string | null
  ean_final: string | null
}

export interface MappingsTableProps {
  clientId: string
  clientName: string
  mappings: StockMapping[]
  /** Guardado al vuelo, optimista; el tablero revierte y avisa si falla */
  onPatch: (row: StockMapping, patch: Partial<StockMapping>) => void
  /** Devuelve false si no se pudo crear, para que el formulario no se cierre y no se pierda lo tecleado */
  onCreate: (draft: NewMappingDraft) => Promise<boolean>
  onRemove: (row: StockMapping) => void
  /** Se llama al terminar una importación para que el tablero recargue */
  onImported: () => void
  /**
   * Solo admin y partner pueden borrar (política RLS de la 106). Al resto se
   * les ofrece desactivar, que es lo que conserva el histórico del cruce.
   */
  canDelete: boolean
  /**
   * Revisión externa de cada fila: cambia solo cuando otro navegador toca la
   * fila. Va en el `key` de los inputs para que un cambio ajeno se vea; los
   * propios no la tocan, porque remontar el input mientras se teclea la
   * siguiente celda se comería lo escrito.
   */
  revisions: Record<string, number>
  showBack: boolean
  onBack: () => void
  className?: string
}

/**
 * Filas por página. Con cientos de líneas hoy y miles mañana, pintarlas todas
 * mete miles de <input> en el árbol y la tabla se arrastra al escribir. La
 * paginación es la versión barata de la virtualización y además da algo que un
 * scroll infinito no da: saber por dónde vas.
 */
const PAGE_SIZE = 100

const th =
  'text-[10px] font-semibold text-white/40 uppercase tracking-wider border-b border-white/10 py-1.5 whitespace-nowrap'

/**
 * Texto contra el que se busca, con cada código en sus dos formas.
 *
 * Se guardan la cruda y la normalizada porque quien busca copia el código de
 * donde lo tenga: del volcado del cliente sale «0004000342» y en el mapeo está
 * guardado «4000342». Sin las dos, buscar lo que acabas de copiar no encuentra
 * nada y parece que la referencia no existe.
 */
function haystack(row: StockMapping): string {
  const parts = [
    row.ref_erp,
    row.sku_amazon,
    row.asin,
    row.ean_amazon,
    row.ean_erp,
    row.ean_final,
    row.titulo_amazon,
    row.todos_ean_erp,
  ]

  const raw = parts.filter(Boolean).join(' ').toLowerCase()
  const norm = [row.ref_erp, row.sku_amazon, row.ean_amazon, row.ean_erp, row.ean_final]
    .map((v) => normalizeCode(v))
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return `${raw} ${norm}`
}

export function MappingsTable({
  clientId,
  clientName,
  mappings,
  onPatch,
  onCreate,
  onRemove,
  onImported,
  canDelete,
  revisions,
  showBack,
  onBack,
  className = '',
}: MappingsTableProps) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [draft, setDraft] = useState<NewMappingDraft | null>(null)
  const [saving, setSaving] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const index = useMemo(
    () => mappings.map((row) => ({ row, hay: haystack(row) })),
    [mappings]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return mappings

    const code = normalizeCode(q).toLowerCase()
    return index
      .filter(({ hay }) => hay.includes(q) || (code.length > 0 && hay.includes(code)))
      .map(({ row }) => row)
  }, [index, mappings, query])

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  // La página se recorta en vez de resetearse: al filtrar desde la página 5 lo
  // natural es caer en la última que exista, no perder el sitio del todo.
  const current = Math.min(page, pages - 1)
  const visible = useMemo(
    () => filtered.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE),
    [filtered, current]
  )

  useEffect(() => {
    if (page !== current) setPage(current)
  }, [page, current])

  // Cambiar de página sin volver arriba deja mirando el final de la nueva.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
  }, [current, query])

  const active = useMemo(() => mappings.filter((m) => m.is_active).length, [mappings])

  function goToPage(next: number) {
    setPage(Math.max(0, Math.min(pages - 1, next)))
  }

  async function saveDraft() {
    if (!draft || saving) return

    const sku = cleanSkuText(draft.sku_amazon)
    if (!sku) {
      toast.error('Hace falta el SKU de Amazon: es lo que identifica el listing en el fichero')
      return
    }
    if (mappings.some((m) => m.sku_amazon === sku)) {
      toast.error(`${clientName} ya tiene una línea con el SKU ${sku}`)
      return
    }

    setSaving(true)
    const ok = await onCreate({
      sku_amazon: sku,
      ref_erp: normalizeCode(draft.ref_erp) || null,
      asin: cleanSkuText(draft.asin ?? '').toUpperCase() || null,
      ean_final: normalizeEan(draft.ean_final) || null,
    })
    setSaving(false)
    if (ok) setDraft(null)
  }

  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/[0.02] flex flex-col min-h-0 overflow-hidden ${className}`}
    >
      {/* Cabecera */}
      <div className="px-3 py-2 border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-2 flex-shrink-0 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {showBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1 text-[12px] font-medium text-white/60 hover:text-white transition-colors flex-shrink-0"
            >
              <ChevronLeft className="h-4 w-4" /> Volver
            </button>
          )}
          <h3 className="text-[10px] font-semibold text-white/45 uppercase tracking-wider truncate">
            Base de datos actual
            <span
              className="text-white/25 normal-case tracking-normal"
              title="Cada fila es un listing publicado en Amazon. Las desactivadas no entran en el fichero"
            >
              {' '}
              · {formatInt(mappings.length)} filas, {formatInt(active)} activas
            </span>
          </h3>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <ImportButton clientId={clientId} onImported={onImported} />
          <button
            type="button"
            onClick={() =>
              setDraft(draft ? null : { sku_amazon: '', ref_erp: '', asin: '', ean_final: '' })
            }
            className="text-[11px] font-medium text-white/45 hover:text-white transition-colors flex items-center gap-1"
          >
            <Plus className="h-3 w-3" /> Añadir fila
          </button>
        </div>
      </div>

      {/* Buscador */}
      <div className="px-3 py-2 border-b border-white/[0.06] flex items-center gap-2 flex-shrink-0 min-w-0">
        <Search className="h-3.5 w-3.5 text-white/25 flex-shrink-0" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            // Al filtrar se vuelve a la primera página: quedarse en la séptima
            // de un resultado que ahora tiene dos es ver la tabla vacía.
            setPage(0)
          }}
          placeholder="Referencia, SKU, ASIN, EAN o título (los ceros a la izquierda dan igual)"
          className="flex-1 min-w-0 bg-transparent text-[12px] text-white outline-none placeholder:text-white/25"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="text-white/30 hover:text-white transition-colors flex-shrink-0"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        {query && (
          <span className="text-[11px] text-white/35 tabular-nums whitespace-nowrap flex-shrink-0">
            {formatInt(filtered.length)} coinciden
          </span>
        )}
      </div>

      {/* Alta a mano */}
      {draft && (
        <div className="px-3 py-2 border-b border-[#FF6600]/20 bg-[#FF6600]/[0.05] flex flex-wrap items-center gap-2 flex-shrink-0 min-w-0">
          <input
            autoFocus
            value={draft.sku_amazon}
            onChange={(e) => setDraft({ ...draft, sku_amazon: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && saveDraft()}
            placeholder="SKU de Amazon *"
            className="w-[150px] bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-[12px] text-white outline-none focus:border-[#FF6600] placeholder:text-white/25"
          />
          <input
            value={draft.ref_erp ?? ''}
            onChange={(e) => setDraft({ ...draft, ref_erp: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && saveDraft()}
            placeholder="REF_ERP"
            className="w-[120px] bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-[12px] text-white outline-none focus:border-[#FF6600] placeholder:text-white/25 tabular-nums"
          />
          <input
            value={draft.asin ?? ''}
            onChange={(e) => setDraft({ ...draft, asin: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && saveDraft()}
            placeholder="ASIN"
            className="w-[110px] bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-[12px] text-white outline-none focus:border-[#FF6600] placeholder:text-white/25 tabular-nums"
          />
          <input
            value={draft.ean_final ?? ''}
            onChange={(e) => setDraft({ ...draft, ean_final: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && saveDraft()}
            placeholder="EAN"
            className="w-[130px] bg-white/[0.04] border border-white/10 rounded px-2 py-1 text-[12px] text-white outline-none focus:border-[#FF6600] placeholder:text-white/25 tabular-nums"
          />
          <button
            type="button"
            onClick={saveDraft}
            disabled={saving}
            className="h-7 px-3 rounded-full bg-gradient-to-b from-[#FF7A1F] to-[#FF6600] text-white text-[11px] font-semibold flex items-center gap-1.5 disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            Guardar
          </button>
          <button
            type="button"
            onClick={() => setDraft(null)}
            className="text-[11px] text-white/40 hover:text-white transition-colors"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Tabla */}
      {mappings.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-[13px] text-white/35">
            {clientName} todavía no tiene tabla de mapeo.
          </p>
          <p className="text-[11px] text-white/25 max-w-[320px]">
            Importa el Excel de siempre («Base de datos.xlsx») con el botón de
            arriba, o da de alta las líneas a mano.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-[13px] text-white/35">Ninguna línea coincide con «{query}».</p>
          <p className="text-[11px] text-white/25">
            Si el producto existe en Amazon pero no está aquí, hay que darlo de alta:
            sin su fila no se le actualiza el stock.
          </p>
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-auto min-w-0">
          <table className="w-full min-w-[860px] text-[12px] border-collapse">
            <thead className="sticky top-0 bg-[#0d0d0d] z-10">
              <tr>
                <th className={`${th} w-[6px]`} />
                <th className={`${th} text-left px-2 w-[118px]`}>REF_ERP</th>
                <th className={`${th} text-left px-1 w-[150px]`}>SKU_AMAZON</th>
                <th className={`${th} text-left px-1 w-[112px]`}>ASIN</th>
                <th className={`${th} text-left px-1 w-[128px]`}>EAN_AMAZON</th>
                <th className={`${th} text-left px-1 w-[128px]`}>EAN_ERP</th>
                <th
                  className={`${th} text-left px-1 w-[128px]`}
                  title="El EAN que se da por bueno. Es el primero que prueba el cruce cuando la referencia no casa"
                >
                  EAN_FINAL
                </th>
                <th className={`${th} w-[56px]`} />
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const rev = revisions[row.id] ?? 0
                return (
                  <tr
                    key={row.id}
                    className={`border-b border-white/[0.04] group transition-colors hover:bg-white/[0.03] ${
                      row.is_active ? '' : 'opacity-40'
                    }`}
                  >
                    <td className="p-0">
                      <span
                        className="block h-6 w-[3px] rounded-full mx-auto"
                        style={{
                          backgroundColor: !row.is_active
                            ? '#64748B'
                            : row.ref_erp
                              ? '#34D399'
                              : row.ean_final
                                ? '#FBBF24'
                                : '#EF4444',
                        }}
                        title={
                          !row.is_active
                            ? 'Desactivada: no entra en el fichero de Amazon'
                            : row.ref_erp
                              ? 'Tiene referencia del ERP: cruza por la vía fiable'
                              : row.ean_final
                                ? 'Sin referencia; depende del EAN para cruzar'
                                : 'Ni referencia ni EAN: esta línea no puede casar con nada'
                        }
                      />
                    </td>

                    <td className="px-1 py-1">
                      <input
                        key={`ref-${row.id}-${rev}`}
                        defaultValue={row.ref_erp ?? ''}
                        placeholder="—"
                        onBlur={(e) => {
                          // Se guarda normalizada y se reescribe en el campo con
                          // esa forma: si se guardara «0004000342» y en pantalla
                          // se viera lo tecleado, la línea dejaría de casar sin
                          // que nada lo delatara.
                          const v = normalizeCode(e.target.value) || null
                          e.target.value = v ?? ''
                          if (v !== (row.ref_erp ?? null)) onPatch(row, { ref_erp: v })
                        }}
                        className={`${codeInput} font-medium`}
                        title="Referencia del artículo en el ERP del cliente. Se guarda sin ceros a la izquierda"
                      />
                    </td>

                    <td className="px-1 py-1">
                      <input
                        key={`sku-${row.id}-${rev}`}
                        defaultValue={row.sku_amazon}
                        onBlur={(e) => {
                          const v = cleanSkuText(e.target.value)
                          if (!v) {
                            // Sin SKU no hay listing: se revierte en vez de
                            // guardar una fila que el cruce descartaría.
                            e.target.value = row.sku_amazon
                            toast.error('El SKU de Amazon no puede quedarse vacío')
                            return
                          }
                          e.target.value = v
                          if (v !== row.sku_amazon) onPatch(row, { sku_amazon: v })
                        }}
                        className={`${textInput} font-medium`}
                        title={row.titulo_amazon ?? 'SKU del listing en Amazon'}
                      />
                    </td>

                    <td className="px-1 py-1">
                      <input
                        key={`asin-${row.id}-${rev}`}
                        defaultValue={row.asin ?? ''}
                        placeholder="—"
                        onBlur={(e) => {
                          const v = cleanSkuText(e.target.value).toUpperCase() || null
                          e.target.value = v ?? ''
                          if (v !== (row.asin ?? null)) onPatch(row, { asin: v })
                        }}
                        className={codeInput}
                      />
                    </td>

                    <EanCell
                      row={row}
                      rev={rev}
                      field="ean_amazon"
                      onPatch={onPatch}
                      title="EAN que publica Amazon en el listing"
                    />
                    <EanCell
                      row={row}
                      rev={rev}
                      field="ean_erp"
                      onPatch={onPatch}
                      title="EAN habitual del artículo en el ERP del cliente"
                    />
                    <EanCell
                      row={row}
                      rev={rev}
                      field="ean_final"
                      onPatch={onPatch}
                      title="El EAN que se da por bueno; es el que usa el cruce"
                    />

                    <td className="px-1 py-1">
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          type="button"
                          onClick={() => onPatch(row, { is_active: !row.is_active })}
                          className="text-white/20 hover:text-white/70 transition-colors p-0.5"
                          title={
                            row.is_active
                              ? 'Desactivar: deja de subirse a Amazon pero se conserva el histórico'
                              : 'Reactivar: vuelve a entrar en el fichero'
                          }
                        >
                          {row.is_active ? (
                            <Eye className="h-3.5 w-3.5" />
                          ) : (
                            <EyeOff className="h-3.5 w-3.5" />
                          )}
                        </button>
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => onRemove(row)}
                            className="text-white/15 hover:text-red-400 transition-colors p-0.5 opacity-0 group-hover:opacity-100"
                            title="Borrar la línea del mapeo"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Paginación */}
      {pages > 1 && (
        <div className="px-3 py-1.5 border-t border-white/[0.06] flex items-center justify-between gap-2 flex-shrink-0 bg-[#0d0d0d]">
          <span className="text-[11px] text-white/35 tabular-nums truncate">
            {formatInt(current * PAGE_SIZE + 1)}–
            {formatInt(Math.min((current + 1) * PAGE_SIZE, filtered.length))} de{' '}
            {formatInt(filtered.length)}
          </span>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              type="button"
              onClick={() => goToPage(current - 1)}
              disabled={current === 0}
              className="h-6 w-6 flex items-center justify-center rounded-full text-white/50 hover:text-white hover:bg-white/[0.06] transition-colors disabled:opacity-20"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="text-[11px] text-white/45 tabular-nums px-1 whitespace-nowrap">
              {current + 1} / {pages}
            </span>
            <button
              type="button"
              onClick={() => goToPage(current + 1)}
              disabled={current >= pages - 1}
              className="h-6 w-6 flex items-center justify-center rounded-full text-white/50 hover:text-white hover:bg-white/[0.06] transition-colors disabled:opacity-20"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// =====================================================
// Celda de EAN
// =====================================================

/**
 * Las tres columnas de EAN se comportan igual, así que van por una sola celda.
 *
 * Al guardar se normaliza (solo dígitos y sin el relleno del GTIN-14) y se
 * reescribe el campo: si lo tecleado no parece un EAN se queda en blanco, que
 * es más honesto que guardar un código que el cruce nunca va a encontrar.
 */
function EanCell({
  row,
  rev,
  field,
  onPatch,
  title,
}: {
  row: StockMapping
  rev: number
  field: 'ean_amazon' | 'ean_erp' | 'ean_final'
  onPatch: (row: StockMapping, patch: Partial<StockMapping>) => void
  title: string
}) {
  return (
    <td className="px-1 py-1">
      <input
        key={`${field}-${row.id}-${rev}`}
        defaultValue={row[field] ?? ''}
        placeholder="—"
        onBlur={(e) => {
          const typed = e.target.value.trim()
          const v = normalizeEan(typed) || null
          if (typed && !v) {
            e.target.value = row[field] ?? ''
            toast.error(`«${typed}» no parece un código de barras. Un EAN tiene 13 dígitos`)
            return
          }
          e.target.value = v ?? ''
          // El aserto es por la clave calculada: TypeScript no sabe que `field`
          // solo puede ser una de las tres columnas de EAN y ensancha el
          // literal a un índice de string.
          if (v !== (row[field] ?? null)) onPatch(row, { [field]: v } as Partial<StockMapping>)
        }}
        className={codeInput}
        title={title}
      />
    </td>
  )
}

// =====================================================
// Importar CSV / XLSX
// =====================================================

function ImportButton({ clientId, onImported }: { clientId: string; onImported: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [sheet, setSheet] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  async function run() {
    if (!file || importing) return

    setImporting(true)
    try {
      const form = new FormData()
      form.append('client_id', clientId)
      form.append('file', file)
      if (sheet.trim()) form.append('sheet', sheet.trim())

      const res = await fetch('/api/stock-sync/import-mappings', { method: 'POST', body: form })
      if (!res.ok) {
        toast.error(await errorMessage(res, 'No se ha podido importar el fichero'))
        return
      }

      const data = (await res.json()) as ImportResult
      setResult(data)
      setFile(null)
      onImported()
      toast.success(
        `${formatInt(data.inserted)} nuevas y ${formatInt(data.updated)} actualizadas`
      )
    } catch (err) {
      console.error('Error importando el mapeo:', err)
      toast.error('No se ha podido contactar con el servidor. Comprueba la conexión')
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="text-[11px] font-medium text-white/45 hover:text-white transition-colors flex items-center gap-1"
        title="Sube el Excel o el CSV con la tabla de mapeo. Las líneas que ya existan se actualizan, no se duplican"
      >
        <Upload className="h-3 w-3" /> Importar
      </button>

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0]
          if (picked) {
            setFile(picked)
            setResult(null)
          }
          e.target.value = ''
        }}
      />

      {/* Confirmación: importar pisa datos, así que no se lanza con un solo clic */}
      {file && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-[420px] rounded-2xl border border-white/10 bg-[#101010] p-4 flex flex-col gap-3">
            <div>
              <h4 className="text-[14px] font-semibold text-white">Importar tabla de mapeo</h4>
              <p className="text-[12px] text-white/50 mt-0.5 break-all">{file.name}</p>
            </div>

            <div>
              <label className="text-[11px] text-white/45 block mb-1">
                Hoja del Excel (opcional)
              </label>
              <input
                value={sheet}
                onChange={(e) => setSheet(e.target.value)}
                placeholder="Ahora"
                className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-2.5 py-1.5 text-[12px] text-white outline-none focus:border-[#FF6600] placeholder:text-white/25"
              />
              <p className="text-[11px] text-white/30 mt-1 leading-snug">
                En blanco coge la primera hoja que tenga una columna de SKU. El
                Excel de trabajo trae dos («Ahora» y «Antes»): escribe cuál si no
                quieres dejarlo al azar.
              </p>
            </div>

            <p className="text-[11px] text-white/45 leading-snug rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-2">
              Los SKU que ya existan se actualizan con lo que traiga el fichero;
              los nuevos se dan de alta. Nada se borra, así que las correcciones
              hechas a mano en columnas que el fichero no traiga se conservan.
            </p>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setFile(null)}
                className="h-8 px-3 rounded-full text-[12px] text-white/50 hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={run}
                disabled={importing}
                className="h-8 px-4 rounded-full bg-gradient-to-b from-[#FF7A1F] to-[#FF6600] text-white text-[12px] font-semibold flex items-center gap-2 disabled:opacity-40"
              >
                {importing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                {importing ? 'Importando...' : 'Importar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resultado de la última importación */}
      {result && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-[460px] rounded-2xl border border-white/10 bg-[#101010] p-4 flex flex-col gap-3 max-h-[80vh] overflow-auto">
            <h4 className="text-[14px] font-semibold text-white">
              Importación terminada
              <span className="text-white/40 font-normal"> · hoja «{result.sheet}»</span>
            </h4>

            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-white/35">Nuevas</p>
                <p className="text-[19px] font-bold text-green-300 tabular-nums">
                  {formatInt(result.inserted)}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-white/35">Actualizadas</p>
                <p className="text-[19px] font-bold text-white tabular-nums">
                  {formatInt(result.updated)}
                </p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wider text-white/35">Descartadas</p>
                <p
                  className={`text-[19px] font-bold tabular-nums ${
                    result.discarded > 0 ? 'text-amber-300' : 'text-white/40'
                  }`}
                >
                  {formatInt(result.discarded)}
                </p>
              </div>
            </div>

            <p className="text-[11px] text-white/40">
              Se han leído {formatInt(result.rowsRead)} filas del fichero.
            </p>

            {result.discardedReasons.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {result.discardedReasons.map((r, i) => (
                  <div
                    key={i}
                    className="rounded-lg border border-amber-400/20 bg-amber-400/[0.05] px-2.5 py-1.5"
                  >
                    <p className="text-[11px] text-amber-200/85">
                      {formatInt(r.rows)} · {r.reason}
                    </p>
                    {r.examples.length > 0 && (
                      <p className="text-[10px] text-white/30 mt-0.5 break-all">
                        {r.examples.join(', ')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {result.missingColumns.length > 0 && (
              <div className="rounded-lg border border-red-400/25 bg-red-500/[0.06] px-2.5 py-2">
                <p className="text-[11px] text-red-200/85 leading-snug">
                  El fichero no traía {result.missingColumns.join(', ')}. Esas columnas
                  se han quedado como estaban; si el mapeo dependía de ellas, el
                  cruce empeorará sin avisar.
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={() => setResult(null)}
              className="h-8 px-4 rounded-full bg-white/[0.06] text-white text-[12px] font-medium self-end hover:bg-white/[0.1] transition-colors"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}
    </>
  )
}
