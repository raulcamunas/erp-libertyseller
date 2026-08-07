'use client'

import { useState } from 'react'
import { Undo2 } from 'lucide-react'
import {
  AMAZON_FIELD_LABELS,
  whyNotEditable,
  type AmazonListing,
  type AmazonSubmissionField,
} from '@/lib/types/amazon'
import {
  formatCampo,
  formatValorGuardado,
  parseCampo,
  submissionStatusHint,
  type CellState,
} from '@/lib/amazon/catalogo'
import { numInput } from './shared'

/**
 * UNA CELDA DE PRECIO O DE STOCK.
 *
 * NADA DE LO QUE PASA AQUÍ VIAJA A AMAZON (decisión C). Escribir en esta celda
 * apunta el cambio en una lista de pendientes y se acabó; lo que sale hacia la
 * tienda del cliente sale desde el botón «Enviar cambios», y solo después de
 * enseñar la lista completa. Un 1499 donde se quería 14,99 tiene que poder
 * verse y deshacerse antes de llegar a ninguna parte.
 *
 * LOS CUATRO ESTADOS QUE PUEDE TENER, Y POR QUÉ SE DISTINGUEN:
 *
 *   NORMAL      — lo que Amazon dice que hay hoy.
 *   EDITADA     — hay algo tecleado sin enviar. Se pinta en naranja CON EL
 *                 VALOR ANTERIOR AL LADO, porque «12,99» a secas no dice si te
 *                 has equivocado; «12,99 (antes 14,99)» sí. Y con su botón de
 *                 deshacer, una a una.
 *   EN CONFLICTO — hay algo tecleado Y el precio de Amazon se ha movido por
 *                 debajo desde que lo escribiste. Es el caso de la decisión E y
 *                 se marca en amarillo: no está mal, pero lo decidiste mirando
 *                 otro número.
 *   ENVIADA     — salió hacia Amazon y todavía no consta aplicado, o lo
 *                 rechazaron. Amazon contesta «aceptado» en cuanto entiende la
 *                 petición, no cuando la aplica: hasta que el refresco no
 *                 vuelve a leer el listing no hay ninguna prueba de que el
 *                 cambio esté puesto, y eso hay que verlo o se manda dos veces.
 *
 * Y una celda que NO se puede editar lo dice al pasar por encima, con el
 * motivo. El caso que importa es el stock de un FBA: ahí la cantidad la lleva
 * Amazon, y un cambio enviado no da error — se ignora en silencio y en pantalla
 * parece aplicado.
 */
export function CeldaEditable({
  listing,
  field,
  state,
  onEdit,
  onUndo,
  readOnly,
}: {
  listing: AmazonListing
  field: AmazonSubmissionField
  state: CellState
  onEdit: (value: number) => void
  onUndo: () => void
  /** En móvil no se edita: la tabla es de consulta */
  readOnly: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const moneda = field === 'precio' ? listing.currency : null
  const bloqueo = whyNotEditable(listing, field)
  const editable = state.editable && !readOnly && !bloqueo

  function abrir() {
    if (!editable) return
    // Se arranca con el valor que se va a cambiar —el pendiente si lo hay— para
    // que corregir un dedazo sea retocar un dígito y no volver a escribirlo todo.
    const partida = state.draft ?? state.current
    setDraft(partida === null ? '' : String(partida).replace('.', ','))
    setError(null)
    setEditing(true)
  }

  function confirmar() {
    const res = parseCampo(field, draft)
    if (!res.ok) {
      // El error se queda EN LA CELDA y no se cierra la edición: cerrar y sacar
      // un aviso flotante deja a la persona delante del valor viejo sin saber
      // qué escribió mal.
      setError(res.error)
      return
    }
    setEditing(false)
    setError(null)
    onEdit(res.value)
  }

  if (editing) {
    return (
      <div className="min-w-[92px]">
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            if (error) setError(null)
          }}
          onBlur={confirmar}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            }
            if (e.key === 'Escape') {
              // Escape descarta lo tecleado en esta pasada, no la edición que ya
              // estuviera apuntada: para quitar esa está el botón de deshacer.
              setError(null)
              setEditing(false)
            }
          }}
          inputMode="decimal"
          autoFocus
          aria-label={`${AMAZON_FIELD_LABELS[field]} de ${listing.sku}`}
          className={`${numInput} ${error ? 'border-red-500/60' : ''}`}
        />
        {error && <p className="text-[10px] text-red-300 mt-0.5 leading-tight">{error}</p>}
      </div>
    )
  }

  if (!editable) {
    return (
      <div
        title={bloqueo ?? undefined}
        className="text-right tabular-nums text-[12px] text-white/30 px-1.5 py-1"
      >
        {formatCampo(field, state.current, moneda)}
      </div>
    )
  }

  const pendiente = state.draft !== null

  /**
   * Un envío que YA SALIÓ y todavía no consta aplicado.
   *
   * Mientras está así, la celda tiene que enseñar las DOS cosas: lo que hay hoy
   * en Amazon (que es lo que sigue habiendo, porque el espejo no cambia hasta
   * el siguiente barrido) y lo que se mandó. Sin el segundo número, después de
   * enviar veinte precios la tabla queda idéntica a como estaba y no hay forma
   * de comprobar qué salió sin abrir el historial y buscar el SKU.
   */
  const enviadoSinAplicar =
    state.sent !== null && (state.sent.status === 'pendiente' || state.sent.status === 'aceptado')

  return (
    <div className="flex items-center justify-end gap-1 min-w-[92px]">
      <button
        type="button"
        onClick={abrir}
        title={
          pendiente
            ? `Sin enviar. En Amazon ${state.conflict ? 'ahora' : ''} pone ${formatCampo(field, state.current, moneda)}`
            : state.sent
              ? submissionStatusHint(state.sent)
              : 'Pulsa para cambiarlo'
        }
        className={`flex-1 text-right tabular-nums text-[12px] rounded px-1.5 py-1 border transition-colors ${
          pendiente
            ? state.conflict
              ? 'border-yellow-500/50 bg-yellow-400/[0.09] text-white'
              : 'border-[#FF6600]/50 bg-[#FF6600]/[0.12] text-white font-semibold'
            : 'border-transparent text-white/75 hover:bg-white/[0.05]'
        }`}
      >
        {pendiente ? (
          <span className="flex items-center justify-end gap-1.5 min-w-0">
            <span className="text-white/35 line-through truncate">
              {formatCampo(field, state.seen, moneda)}
            </span>
            <span className="flex-shrink-0">{formatCampo(field, state.draft, moneda)}</span>
          </span>
        ) : (
          <span className="flex items-center justify-end gap-1.5 min-w-0">
            {state.sent && (
              <span
                aria-hidden
                className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${
                  state.sent.status === 'invalido' || state.sent.status === 'error'
                    ? 'bg-red-400'
                    : 'bg-yellow-400'
                }`}
              />
            )}
            {enviadoSinAplicar && state.sent ? (
              <>
                {/* Lo que sigue habiendo en Amazon, tachado, y al lado lo que
                    se mandó. Misma gramática que una edición sin enviar, pero
                    en amarillo: ahí el número nuevo está por salir, aquí ya
                    salió y falta que Amazon lo aplique. */}
                <span className="text-white/35 line-through truncate">
                  {formatCampo(field, state.current, moneda)}
                </span>
                <span className="text-yellow-300/80 flex-shrink-0">
                  {formatValorGuardado(field, state.sent.new_value, state.sent.currency)}
                </span>
              </>
            ) : (
              formatCampo(field, state.current, moneda)
            )}
          </span>
        )}
      </button>

      {pendiente && (
        <button
          type="button"
          onClick={onUndo}
          title="Deshacer este cambio"
          aria-label={`Deshacer el cambio de ${AMAZON_FIELD_LABELS[field].toLowerCase()} de ${listing.sku}`}
          className="flex-shrink-0 h-5 w-5 rounded flex items-center justify-center text-white/35 hover:text-white hover:bg-white/[0.08] transition-colors"
        >
          <Undo2 className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}
