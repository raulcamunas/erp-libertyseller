'use client'

import { useCallback, useEffect, useState } from 'react'
import { History, Loader2, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  AMAZON_FIELD_LABELS,
  AMAZON_SOURCE_LABELS,
  AMAZON_SUBMISSION_STATUS_HINTS,
  marketplaceLabel,
  submissionStatusLabel,
  type AmazonChangeSource,
  type AmazonSubmission,
  type AmazonSubmissionStatus,
} from '@/lib/types/amazon'
import { formatValorGuardado } from '@/lib/amazon/catalogo'
import { postAmazon, type HistoryResponse } from '@/lib/amazon/client'
import { fieldInput, formatDayTime, ghostButton, submissionPill } from './shared'

/**
 * EL HISTORIAL DE CAMBIOS DE UN CLIENTE (decisión D).
 *
 * No es una pantalla de depuración ni un extra: es la única forma de contestar
 * a «¿por qué mi producto aparece a otro precio?». Por eso cada línea lleva el
 * valor ANTERIOR y el nuevo, quién lo mandó, cuándo, qué contestó Amazon y su
 * identificador de envío —que es lo único que sirve para abrir un caso con el
 * soporte de Amazon—.
 *
 * El «quién» sale de `created_by`, que la tabla guarda como UUID; los nombres
 * llegan resueltos desde el servidor en `authors` (ver loadSubmissionAuthors).
 * Con más de un admin en la agencia, sin ese dato el historial contesta qué
 * pasó y cuándo, pero no quién lo hizo, que es la mitad de la pregunta.
 *
 * Y por eso se filtra por SKU y por fecha: son las dos formas en las que llega
 * la pregunta. «El SKU X está mal» y «algo cambió el martes».
 *
 * El filtro se resuelve en la base, no aquí. Esta tabla no se purga nunca, así
 * que traérsela entera para recortarla en el navegador funciona el primer mes y
 * deja de funcionar justo cuando el historial empieza a servir para algo.
 */
export function HistorialPanel({
  connectionId,
  initialSubmissions,
  initialAuthors,
  className = '',
}: {
  connectionId: string
  /** Lo que ya trajo la carga del catálogo: se pinta sin pedir nada */
  initialSubmissions: AmazonSubmission[]
  /** id de perfil -> nombre, para el «quién lo mandó» de cada línea */
  initialAuthors: Record<string, string>
  className?: string
}) {
  const [submissions, setSubmissions] = useState(initialSubmissions)
  const [authors, setAuthors] = useState(initialAuthors)
  const [sku, setSku] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [loading, setLoading] = useState(false)
  const [tope, setTope] = useState<number | null>(null)

  // El historial que llega de fuera (un envío que acaba de terminar) manda
  // mientras no haya un filtro puesto: si lo hay, machacarlo borraría la
  // búsqueda que la persona está mirando.
  const sinFiltro = sku.trim() === '' && desde === '' && hasta === ''
  useEffect(() => {
    if (sinFiltro) setSubmissions(initialSubmissions)
  }, [initialSubmissions, sinFiltro])
  // Los nombres se acumulan siempre, con filtro o sin él: son un diccionario,
  // no un resultado. Perder los de una búsqueda anterior dejaría líneas sin
  // autor al quitar el filtro.
  useEffect(() => {
    setAuthors((prev) => ({ ...prev, ...initialAuthors }))
  }, [initialAuthors])

  const buscar = useCallback(async () => {
    setLoading(true)
    const res = await postAmazon<HistoryResponse>('/api/amazon/history', {
      connectionId,
      sku: sku.trim() || null,
      from: desde || null,
      to: hasta || null,
    })
    setLoading(false)

    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setSubmissions(res.data.submissions)
    setAuthors((prev) => ({ ...prev, ...res.data.authors }))
    // Si vuelven justo las que caben, hay más sin enseñar y hay que decirlo:
    // una lista cortada en silencio se lee como «no hay nada más», que en un
    // historial es exactamente la conclusión equivocada.
    setTope(res.data.submissions.length >= res.data.limit ? res.data.limit : null)
  }, [connectionId, sku, desde, hasta])

  function limpiar() {
    setSku('')
    setDesde('')
    setHasta('')
    setSubmissions(initialSubmissions)
    setTope(null)
  }

  return (
    <div
      className={`rounded-2xl border border-white/10 bg-white/[0.02] flex flex-col min-h-0 min-w-0 overflow-hidden ${className}`}
    >
      <div className="px-3 py-2 border-b border-white/[0.06] flex-shrink-0 flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold text-white/45 uppercase tracking-wider flex items-center gap-2">
          <History className="h-3 w-3 flex-shrink-0" /> Historial de cambios
        </h3>
        {!sinFiltro && (
          <button
            type="button"
            onClick={limpiar}
            className="text-[10px] text-white/40 hover:text-white transition-colors flex items-center gap-1"
          >
            <X className="h-2.5 w-2.5" />
            Quitar filtros
          </button>
        )}
      </div>

      <div className="px-3 py-2 border-b border-white/[0.06] flex-shrink-0 flex flex-wrap items-end gap-2">
        <div className="min-w-[130px] flex-1">
          <label
            htmlFor="amazon-hist-sku"
            className="block text-[10px] text-white/40 mb-0.5 uppercase tracking-wider"
          >
            SKU
          </label>
          <input
            id="amazon-hist-sku"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') buscar()
            }}
            placeholder="Parte del SKU"
            className={fieldInput}
          />
        </div>

        <div className="w-[132px]">
          <label
            htmlFor="amazon-hist-desde"
            className="block text-[10px] text-white/40 mb-0.5 uppercase tracking-wider"
          >
            Desde
          </label>
          <input
            id="amazon-hist-desde"
            type="date"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            // Sin [color-scheme:dark] el selector nativo de fecha sale blanco
            // sobre el fondo oscuro y no se lee.
            className={`${fieldInput} [color-scheme:dark]`}
          />
        </div>

        <div className="w-[132px]">
          <label
            htmlFor="amazon-hist-hasta"
            className="block text-[10px] text-white/40 mb-0.5 uppercase tracking-wider"
          >
            Hasta
          </label>
          <input
            id="amazon-hist-hasta"
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            className={`${fieldInput} [color-scheme:dark]`}
          />
        </div>

        <button type="button" onClick={buscar} disabled={loading} className={ghostButton}>
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Search className="h-3.5 w-3.5" />
          )}
          Buscar
        </button>
      </div>

      {submissions.length === 0 ? (
        <div className="flex-1 flex items-center justify-center px-6 py-8 text-center">
          <p className="text-[12px] text-white/35">
            {sinFiltro
              ? 'Todavía no se ha enviado ningún cambio a esta cuenta.'
              : 'Ningún cambio con esos filtros.'}
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto min-w-0 divide-y divide-white/[0.04]">
          {submissions.map((s) => (
            <LineaHistorial key={s.id} submission={s} authors={authors} />
          ))}

          {tope !== null && (
            <p className="px-3 py-2 text-[10px] text-white/35 leading-relaxed">
              Se enseñan los {tope} más recientes que cumplen el filtro. Si buscas algo más
              antiguo, acota las fechas.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function LineaHistorial({
  submission: s,
  authors,
}: {
  submission: AmazonSubmission
  authors: Record<string, string>
}) {
  const estado = s.status as AmazonSubmissionStatus
  // Sin autor solo cuando lo lanzó un proceso automático (created_by va a NULL)
  // o cuando esa persona ya no está en el ERP y la fila quedó en SET NULL.
  const autor = s.created_by ? (authors[s.created_by] ?? null) : null

  return (
    <div className="px-3 py-2 min-w-0">
      <div className="flex items-baseline gap-2 min-w-0">
        <span title={s.sku} className="text-[12px] text-white/85 tabular-nums truncate min-w-0">
          {s.sku}
        </span>
        <span className="text-[10px] text-white/40 uppercase tracking-wider flex-shrink-0">
          {AMAZON_FIELD_LABELS[s.field] ?? s.field}
        </span>
        <span
          className={`${submissionPill(s.status)} flex-shrink-0 ml-auto`}
          title={AMAZON_SUBMISSION_STATUS_HINTS[estado] ?? undefined}
        >
          {submissionStatusLabel(s.status)}
        </span>
      </div>

      <div className="flex items-baseline flex-wrap gap-x-2 gap-y-0.5 mt-0.5 text-[11px] tabular-nums">
        <span className="text-white/40 line-through">
          {formatValorGuardado(s.field, s.previous_value, s.currency)}
        </span>
        <span className="text-white/25">→</span>
        <span className="text-white/85 font-semibold">
          {formatValorGuardado(s.field, s.new_value, s.currency)}
        </span>
        <span className="text-white/30">
          · {marketplaceLabel(s.marketplace_id)} · {formatDayTime(s.created_at)}
          {' · '}
          {autor ?? 'proceso automático'}
          {s.source !== 'manual' &&
            ` · ${AMAZON_SOURCE_LABELS[s.source as AmazonChangeSource] ?? s.source}`}
        </span>
      </div>

      {s.error_message && (
        <p
          className={`text-[10px] mt-0.5 leading-relaxed ${
            estado === 'invalido' || estado === 'error' ? 'text-red-300' : 'text-yellow-300'
          }`}
        >
          {s.error_message}
        </p>
      )}

      {/* El identificador de envío de Amazon. Es lo único que sirve para abrir
          un caso con su soporte, así que se enseña aunque sea feo. */}
      {s.submission_id && (
        <p className="text-[10px] text-white/25 mt-0.5 truncate tabular-nums">
          Envío {s.submission_id}
        </p>
      )}
    </div>
  )
}
