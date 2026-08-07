'use client'

import { useState } from 'react'
import { Copy, Link2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  AMAZON_REGIONS,
  AMAZON_REGION_IDS,
  marketplacesPrincipales,
  type AmazonClient,
  type AmazonRegion,
} from '@/lib/types/amazon'
import { postAmazon, type ConsentLinkResponse } from '@/lib/amazon/client'
import { Dialogo } from './Dialogo'
import { fieldInput, ghostButton, infoBox, primaryButton, warnBox } from './shared'

/**
 * GENERA EL ENLACE QUE HAY QUE MANDARLE AL CLIENTE.
 *
 * Este diálogo no conecta nada: produce una URL. Quien conecta es el cliente,
 * abriéndola desde su Seller Central y dando su consentimiento. Por eso lo que
 * se enseña al final es el enlace, grande y con un botón de copiar, y no un
 * «hecho».
 *
 * SE ELIGEN DOS COSAS Y LAS DOS IMPORTAN:
 *
 *   El CLIENTE, porque el enlace lleva dentro un `state` atado a su ficha y es
 *   lo único que dirá de quién es la autorización cuando vuelva. Mandarle a un
 *   cliente el enlace de otro engancha su tienda a la ficha equivocada.
 *
 *   La REGIÓN, porque una autorización cubre una región entera: la de Europa
 *   vale para España, Francia, Italia y Alemania a la vez, y Estados Unidos
 *   necesita la suya. Se enseñan los países de cada una para que se vea.
 */
export function EnlaceDialog({
  clients,
  presetClientId,
  presetRegion,
  onClose,
}: {
  clients: AmazonClient[]
  /** Cuando se abre desde la tarjeta de un cliente concreto */
  presetClientId?: string
  presetRegion?: AmazonRegion
  onClose: () => void
}) {
  const [clientId, setClientId] = useState(presetClientId ?? clients[0]?.id ?? '')
  const [region, setRegion] = useState<AmazonRegion>(presetRegion ?? 'eu')
  const [saving, setSaving] = useState(false)
  const [link, setLink] = useState<ConsentLinkResponse | null>(null)

  // Extremo Oriente no tiene dirección de consentimiento comprobada, así que no
  // se ofrece: es mejor no poder elegirlo que generar un enlace que falla con
  // el cliente delante. Está explicado en AMAZON_REGIONS.
  const regiones = AMAZON_REGION_IDS.filter((r) => AMAZON_REGIONS[r].sellerCentralUrl)

  async function generar() {
    if (!clientId) {
      toast.error('Elige un cliente')
      return
    }
    setSaving(true)
    const res = await postAmazon<ConsentLinkResponse>('/api/amazon/connect', { clientId, region })
    setSaving(false)

    if (!res.ok) {
      toast.error(res.error)
      return
    }
    setLink(res.data)
  }

  async function copiar() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link.url)
      toast.success('Enlace copiado')
    } catch {
      // Sin portapapeles (permisos del navegador, http…). El enlace está a la
      // vista y es seleccionable, así que se dice eso en vez de fallar en seco.
      toast.error('No se ha podido copiar solo. Selecciona el enlace y cópialo a mano')
    }
  }

  const cliente = clients.find((c) => c.id === clientId)
  const caduca = link ? new Date(link.expiresAt) : null

  return (
    <Dialogo
      title={link ? 'Enlace listo para mandar' : 'Conectar la cuenta de un cliente'}
      subtitle={
        link
          ? 'Mándaselo al cliente. Lo abre él, desde su cuenta de Amazon'
          : 'Se genera un enlace que abre el propio cliente en su Seller Central'
      }
      onClose={onClose}
      maxWidth="max-w-lg"
    >
      {!link ? (
        <div className="space-y-3">
          <div>
            <label
              htmlFor="amazon-cliente"
              className="block text-[11px] text-white/45 mb-1 uppercase tracking-wider"
            >
              Cliente
            </label>
            <select
              id="amazon-cliente"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className={fieldInput}
            >
              {clients.length === 0 && <option value="">No hay clientes dados de alta</option>}
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="amazon-region"
              className="block text-[11px] text-white/45 mb-1 uppercase tracking-wider"
            >
              Región
            </label>
            <select
              id="amazon-region"
              value={region}
              onChange={(e) => setRegion(e.target.value as AmazonRegion)}
              className={fieldInput}
            >
              {regiones.map((r) => (
                <option key={r} value={r}>
                  {AMAZON_REGIONS[r].label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-white/35 mt-1 leading-relaxed">
              Una sola autorización cubre{' '}
              {marketplacesPrincipales(region)
                .map((m) => m.label)
                .join(', ')}
              . Si el cliente vende además en otra región, necesita un enlace aparte para esa.
            </p>
          </div>

          <div className={infoBox}>
            El enlace lleva dentro una marca única atada a{' '}
            <span className="text-white/75">{cliente?.name ?? 'este cliente'}</span>. Sirve una sola
            vez: en cuanto el cliente autorice, deja de valer. Si necesitas conectar a otro, genera
            otro enlace.
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className={ghostButton}>
              Cancelar
            </button>
            <button
              type="button"
              onClick={generar}
              disabled={saving || !clientId}
              className={primaryButton}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Link2 className="h-3.5 w-3.5" />
              )}
              Generar enlace
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[12px] text-white/60 leading-relaxed">
            Mándaselo a <span className="text-white">{cliente?.name}</span>. Tiene que abrirlo con
            el usuario <span className="text-white">principal</span> de su Seller Central: si entra
            con un usuario secundario, Amazon no le deja autorizar.
          </p>

          <textarea
            readOnly
            value={link.url}
            rows={4}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-2.5 py-2 text-[11px] text-white/80 outline-none focus:border-[#FF6600] transition-colors break-all resize-none"
          />

          {/* La ruta de vuelta NO la decide el ERP, la decide lo que haya
              escrito en Developer Central. Si no coinciden, el cliente autoriza
              bien y acaba en un 404 — y una letra de más no se ve leyendo:
              «/callbacks» y «/callbackas» pasaron las dos por aquí sin que
              nadie las notara hasta mirar la barra de direcciones. Enseñarla
              aquí al lado convierte eso en una comparación de dos segundos. */}
          {link.redirectUri && (
            <div className={infoBox}>
              <p className="mb-1.5">
                En Developer Central, la <span className="text-white/80">URI de redirección</span>{' '}
                tiene que ser exactamente esta:
              </p>
              <code className="block text-[11px] text-[#FF6600] break-all">{link.redirectUri}</code>
              <p className="mt-1.5 text-white/40">
                Si sobra o falta una letra, el cliente autoriza bien pero acaba en una página de
                error.
              </p>
            </div>
          )}

          <div className={warnBox}>
            Caduca el{' '}
            {caduca?.toLocaleString('es-ES', {
              day: 'numeric',
              month: 'long',
              hour: '2-digit',
              minute: '2-digit',
            })}
            . Si para entonces no lo ha abierto, no pasa nada: se genera otro y ya está.
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className={ghostButton}>
              Cerrar
            </button>
            <button type="button" onClick={copiar} className={primaryButton}>
              <Copy className="h-3.5 w-3.5" />
              Copiar enlace
            </button>
          </div>
        </div>
      )}
    </Dialogo>
  )
}
