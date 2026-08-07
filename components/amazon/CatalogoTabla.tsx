'use client'

import {
  canEditQuantity,
  type AmazonListing,
  type AmazonPendingChange,
  type AmazonSubmission,
  type AmazonSubmissionField,
} from '@/lib/types/amazon'
import { canalLabel, cellState, formatCampo, listingStatusLabel } from '@/lib/amazon/catalogo'
import { CeldaEditable } from './CeldaEditable'
import { STICKY_BG, TH, TH_STICKY_LEFT, tableShell } from './shared'

/**
 * EL CATÁLOGO, EN TABLA.
 *
 * POR QUÉ NO HAY VIRTUALIZACIÓN. Porque en este ERP no la hay en ninguna tabla
 * —ni una librería en package.json, ni una implementación a mano— y meter la
 * primera aquí significaría que esta pantalla se comporta distinta de todas las
 * demás al hacer scroll, buscar con Ctrl+F o imprimir. Lo que sí hay, y es lo
 * que se copia, es la paginación incremental de Cold Calling: se pintan las
 * primeras filas y hay un botón que trae más. Con eso un catálogo de varios
 * miles se abre instantáneo y el navegador solo carga con lo que se está
 * mirando.
 *
 * El recorte lo hace quien llama (`listings` ya viene cortado), para que la
 * cuenta de «quedan N» se calcule una sola vez sobre el total filtrado.
 *
 * EL SCROLL HORIZONTAL VIVE DENTRO DE LA CAJA. La caja no crece: crece la
 * tabla. Sin eso, nueve columnas arrastran la página entera de lado y se llevan
 * la barra lateral por delante.
 */
export function CatalogoTabla({
  listings,
  pending,
  sent,
  onEdit,
  onUndo,
  readOnly,
}: {
  listings: AmazonListing[]
  pending: Map<string, AmazonPendingChange>
  sent: Map<string, AmazonSubmission>
  onEdit: (listing: AmazonListing, field: AmazonSubmissionField, value: number) => void
  onUndo: (listing: AmazonListing, field: AmazonSubmissionField) => void
  readOnly: boolean
}) {
  return (
    <div className={tableShell}>
      <table className="border-collapse text-[12px] min-w-max">
        <thead className={`sticky top-0 z-20 ${STICKY_BG}`}>
          <tr>
            <th className={`${TH_STICKY_LEFT} min-w-[190px]`}>SKU</th>
            <th className={`${TH} min-w-[120px]`}>ASIN</th>
            <th className={`${TH} min-w-[280px]`}>Título</th>
            <th className={`${TH} text-right min-w-[120px]`}>Precio</th>
            <th className={`${TH} text-right min-w-[110px]`}>Stock</th>
            <th className={`${TH} min-w-[110px]`}>Logística</th>
            <th className={`${TH} min-w-[150px]`}>Estado</th>
          </tr>
        </thead>
        <tbody>
          {listings.map((l) => {
            const precio = cellState({ listing: l, field: 'precio', pending, sent })
            const stock = cellState({ listing: l, field: 'cantidad', pending, sent })
            const tocado = precio.draft !== null || stock.draft !== null

            return (
              <tr
                key={l.id}
                className={`border-b border-white/[0.04] ${
                  tocado ? 'bg-[#FF6600]/[0.04]' : 'hover:bg-white/[0.03]'
                }`}
              >
                <td
                  className="sticky left-0 z-10 px-2 py-1 border-r border-white/[0.07] min-w-[190px] max-w-[240px]"
                  // El tinte de «fila tocada» es translúcido: sobre una celda
                  // congelada dejaría ver el resto de la fila pasando por
                  // debajo. Se pinta encima de un fondo OPACO para que tape.
                  //
                  // Y ese fondo es var(--surface), no el «#0d0d0d» de siempre.
                  // El tema claro del ERP funciona reinterpretando las CLASES
                  // de Tailwind (bg-[#0d0d0d] pasa a blanco bajo html.light),
                  // y a un estilo en línea no llega: con el color escrito a
                  // mano, esta columna se quedaría negra sobre el tema claro.
                  // La variable sí cambia con el tema.
                  style={{
                    backgroundColor: 'var(--surface)',
                    backgroundImage: tocado
                      ? 'linear-gradient(rgba(255,102,0,0.06), rgba(255,102,0,0.06))'
                      : undefined,
                  }}
                >
                  <span
                    title={l.sku}
                    className="block truncate text-white/85 font-medium tabular-nums"
                  >
                    {l.sku}
                  </span>
                </td>

                <td className="px-2 py-1 tabular-nums text-white/55">
                  {l.asin ? (
                    <span className="whitespace-nowrap">{l.asin}</span>
                  ) : (
                    <span className="text-white/20">—</span>
                  )}
                </td>

                <td className="px-2 py-1 max-w-[380px]">
                  <span
                    title={l.title ?? undefined}
                    className={`block truncate ${l.title ? 'text-white/65' : 'text-white/20'}`}
                  >
                    {l.title ?? 'Sin título'}
                  </span>
                </td>

                <td className="px-1 py-0.5">
                  <CeldaEditable
                    listing={l}
                    field="precio"
                    state={precio}
                    onEdit={(v) => onEdit(l, 'precio', v)}
                    onUndo={() => onUndo(l, 'precio')}
                    readOnly={readOnly}
                  />
                </td>

                <td className="px-1 py-0.5">
                  <CeldaEditable
                    listing={l}
                    field="cantidad"
                    state={stock}
                    onEdit={(v) => onEdit(l, 'cantidad', v)}
                    onUndo={() => onUndo(l, 'cantidad')}
                    readOnly={readOnly}
                  />
                </td>

                <td className="px-2 py-1 whitespace-nowrap">
                  {/* Solo el canal del vendedor —el único cuyo stock se puede
                      escribir— se pinta en el tono fuerte. Un canal
                      desconocido va apagado como el de Amazon: si se pintara
                      como «Vendedor», la columna estaría invitando a tocar un
                      stock que la celda de al lado no deja tocar. */}
                  <span
                    className={
                      canEditQuantity(l) ? 'text-white/65' : 'text-white/45'
                    }
                  >
                    {canalLabel(l)}
                  </span>
                </td>

                <td className="px-2 py-1">
                  <EstadoListing listing={l} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * El estado que Amazon devuelve del listing.
 *
 * Un listing que no está «A la venta» no se puede arreglar cambiándole el
 * precio, así que se enseña al lado: es la explicación de por qué un producto
 * con precio y con stock no vende nada.
 */
function EstadoListing({ listing }: { listing: AmazonListing }) {
  if (!listing.listing_status || listing.listing_status.length === 0) {
    return <span className="text-white/20">—</span>
  }

  return (
    <span className="flex flex-wrap gap-1">
      {listing.listing_status.map((s) => (
        <span
          key={s}
          className={`text-[10px] px-1.5 py-0.5 rounded-md border whitespace-nowrap ${
            s === 'BUYABLE'
              ? 'border-green-500/30 bg-green-500/20 text-green-300'
              : 'border-white/10 bg-white/[0.03] text-white/50'
          }`}
        >
          {listingStatusLabel(s)}
        </span>
      ))}
    </span>
  )
}

/**
 * EL CATÁLOGO EN MÓVIL: consultable, no editable.
 *
 * Una tabla de siete columnas en una pantalla de 375 puntos no se lee: se
 * arrastra de lado buscando la columna. Aquí cada línea es una tarjeta con lo
 * único que se consulta desde el móvil —qué es, a cuánto está y cuánto queda—.
 *
 * Editar precios se queda para el escritorio a propósito, y no por falta de
 * sitio: tocar un precio con el pulgar, en el metro, sobre una celda de doce
 * píxeles, es exactamente cómo se manda un 1499 a la tienda de un cliente. Lo
 * que sí se ve es qué hay tecleado sin enviar, para poder comprobarlo.
 */
export function CatalogoTarjetas({
  listings,
  pending,
  sent,
}: {
  listings: AmazonListing[]
  pending: Map<string, AmazonPendingChange>
  sent: Map<string, AmazonSubmission>
}) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      {listings.map((l) => {
        const precio = cellState({ listing: l, field: 'precio', pending, sent })
        const stock = cellState({ listing: l, field: 'cantidad', pending, sent })
        const tocado = precio.draft !== null || stock.draft !== null

        return (
          <div
            key={l.id}
            className={`rounded-xl border p-2.5 min-w-0 ${
              tocado
                ? 'border-[#FF6600]/40 bg-[#FF6600]/[0.06]'
                : 'border-white/10 bg-white/[0.02]'
            }`}
          >
            <p className="text-[12px] font-medium text-white/85 truncate tabular-nums">{l.sku}</p>
            <p className="text-[11px] text-white/45 truncate mt-px">{l.title ?? 'Sin título'}</p>

            <div className="flex items-center gap-3 mt-1.5 text-[12px] tabular-nums">
              <ValorMovil
                etiqueta="Precio"
                listing={l}
                field="precio"
                state={precio}
              />
              <ValorMovil etiqueta="Stock" listing={l} field="cantidad" state={stock} />
            </div>

            <p className="text-[10px] text-white/30 mt-1.5 truncate">
              {canalLabel(l)}
              {l.asin && ` · ${l.asin}`}
            </p>
          </div>
        )
      })}
    </div>
  )
}

function ValorMovil({
  etiqueta,
  listing,
  field,
  state,
}: {
  etiqueta: string
  listing: AmazonListing
  field: AmazonSubmissionField
  state: ReturnType<typeof cellState>
}) {
  const moneda = field === 'precio' ? listing.currency : null
  const pendiente = state.draft !== null

  return (
    <span className="min-w-0">
      <span className="text-white/35 text-[10px] uppercase tracking-wider mr-1">{etiqueta}</span>
      {pendiente ? (
        <span className="text-white font-semibold">
          <span className="text-white/35 line-through mr-1 font-normal">
            {formatCampo(field, state.seen, moneda)}
          </span>
          {formatCampo(field, state.draft, moneda)}
        </span>
      ) : (
        <span className="text-white/75">{formatCampo(field, state.current, moneda)}</span>
      )}
    </span>
  )
}
