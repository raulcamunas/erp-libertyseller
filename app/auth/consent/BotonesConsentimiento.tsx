'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { redireccionPermitida } from '@/lib/mcp/consentimiento'

/**
 * Los dos botones de la pantalla de consentimiento.
 *
 * Hablan con Supabase desde el navegador, con la sesión de quien está delante, y
 * después vuelven a Claude con la dirección que devuelve Supabase. ANTES de
 * navegar se comprueba otra vez que esa dirección es de Claude: es la última
 * barrera, por si algo entre medias la hubiera cambiado.
 */
export function BotonesConsentimiento({
  authorizationId,
  puedeAprobar,
}: {
  authorizationId: string
  /** false = solo se ofrece cancelar (rol no permitido, o la aplicación no es Claude) */
  puedeAprobar: boolean
}) {
  const [haciendo, setHaciendo] = useState<'aprobar' | 'cancelar' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function decidir(aprobar: boolean) {
    setHaciendo(aprobar ? 'aprobar' : 'cancelar')
    setError(null)
    try {
      const api = createClient().auth.oauth
      const opciones = { skipBrowserRedirect: true }
      const { data, error: fallo } = aprobar
        ? await api.approveAuthorization(authorizationId, opciones)
        : await api.denyAuthorization(authorizationId, opciones)
      if (fallo || !data?.redirect_url) {
        throw new Error(fallo?.message ?? 'Supabase no ha devuelto a dónde volver.')
      }
      const veredicto = redireccionPermitida(data.redirect_url, { conConsulta: true })
      if (!veredicto.permitida) throw new Error(veredicto.motivo)
      window.location.href = data.redirect_url
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido completar la operación.')
      setHaciendo(null)
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded-lg p-3">{error}</div>
      )}
      <div className="flex gap-3">
        {puedeAprobar && (
          <Button className="flex-1" disabled={haciendo !== null} onClick={() => decidir(true)}>
            {haciendo === 'aprobar' ? 'Conectando…' : 'Permitir'}
          </Button>
        )}
        <Button
          variant="outline"
          className="flex-1"
          disabled={haciendo !== null}
          onClick={() => decidir(false)}
        >
          {haciendo === 'cancelar' ? 'Cancelando…' : 'Cancelar'}
        </Button>
      </div>
    </div>
  )
}
