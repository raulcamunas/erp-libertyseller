'use client'

import { useState } from 'react'
import { Loader2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { postAmazon, type AmazonMutation, type AmazonView } from '@/lib/amazon/client'
import { Dialogo } from './Dialogo'
import { fieldInput, ghostButton, infoBox, primaryButton } from './shared'

/**
 * Alta de un cliente al que todavía no se le ha conectado nada.
 *
 * La ficha va antes que la conexión y no al revés: el enlace de autorización
 * lleva dentro a qué cliente pertenece, así que tiene que existir para poder
 * generarlo.
 *
 * Es una lista propia, independiente de la de Sincronismo de stock y de la de
 * Tesorería. Aquí solo entra quien vaya a autorizarnos su cuenta de Amazon.
 */
export function AltaClienteDialog({
  onDone,
  onClose,
}: {
  onDone: (view: AmazonView, clientId: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)

  async function guardar() {
    const limpio = name.trim()
    if (!limpio) {
      toast.error('Ponle un nombre al cliente')
      return
    }

    setSaving(true)
    const res = await postAmazon<AmazonMutation>('/api/amazon/clients', { name: limpio })
    setSaving(false)

    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(res.data.message ?? 'Cliente dado de alta')
    onDone(res.data, res.data.client?.id ?? '')
    onClose()
  }

  return (
    <Dialogo
      title="Añadir un cliente"
      subtitle="Solo el nombre; lo demás lo rellena Amazon al autorizar"
      onClose={onClose}
    >
      <div className="space-y-3">
        <div>
          <label
            htmlFor="amazon-nombre"
            className="block text-[11px] text-white/45 mb-1 uppercase tracking-wider"
          >
            Nombre
          </label>
          <input
            id="amazon-nombre"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') guardar()
            }}
            placeholder="Shoplamp"
            autoFocus
            className={fieldInput}
          />
        </div>

        <div className={infoBox}>
          El nombre de la tienda y los países en los que vende no se ponen aquí: los dice Amazon
          cuando el cliente autoriza, y se rellenan solos.
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className={ghostButton}>
            Cancelar
          </button>
          <button
            type="button"
            onClick={guardar}
            disabled={saving || name.trim() === ''}
            className={primaryButton}
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <UserPlus className="h-3.5 w-3.5" />
            )}
            Dar de alta
          </button>
        </div>
      </div>
    </Dialogo>
  )
}
