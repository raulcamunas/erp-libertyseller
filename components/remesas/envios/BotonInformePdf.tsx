'use client'

import { useState } from 'react'
import { FileText, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { BOTON } from '@/lib/estilo/denso'
import { bajarRespuesta } from '../comun/descargar'
import { sinRespuestaDe } from '../comun/errores'
import { cx } from '../comun/ui'

/**
 * «INFORME PDF»: CÓMO ESTÁ ESTE PEDIDO A DÍA DE HOY, PARA MANDÁRSELO AL CLIENTE.
 *
 * Lo enviado, lo que ha recibido Amazon, lo vendido y a qué ritmo, y lo que queda en el almacén y
 * para cuántos días, con la marca de Liberty Seller. Se genera al pulsar con lo que dice el panel en
 * ese momento (la ruta no guarda nada): para tener la foto de mañana basta con volver a descargarlo.
 *
 * Sale para quien pueda ver el envío —no hace falta poder editarlo— y tarda unos segundos, porque
 * la ruta recalcula el reparto del cliente entero: una remesa no se puede contar sin las demás del
 * mismo producto.
 */
export function BotonInformePdf({ remesaId, sinLineas }: { remesaId: string; sinLineas: boolean }) {
  const [bajando, setBajando] = useState(false)

  async function bajar() {
    setBajando(true)
    try {
      const res = await fetch(`/api/fba/remesas/${remesaId}/informe`)
      if (!res.ok) {
        const p = (await res.json().catch(() => null)) as { error?: string } | null
        toast.error(p?.error ?? sinRespuestaDe('No se ha podido generar el informe', res.status))
        return
      }
      await bajarRespuesta(res, 'informe-del-pedido.pdf')
      const paginas = Number(res.headers.get('X-Paginas') ?? 0)
      toast.success(paginas > 0 ? `Informe descargado: ${paginas} página${paginas === 1 ? '' : 's'}` : 'Informe descargado')
    } catch {
      toast.error('Se ha cortado la conexión con el servidor. Si la aplicación se estaba actualizando, espera un minuto; si no, revisa la conexión. Después vuelve a probar.')
    } finally {
      setBajando(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void bajar()}
      disabled={bajando || sinLineas}
      className={cx(BOTON.base, BOTON.secundario)}
      title={
        sinLineas
          ? 'Este pedido no tiene ninguna referencia: no hay nada que contar'
          : 'Descargar en PDF cómo está este pedido hoy —lo enviado, lo recibido, lo vendido y a qué ritmo— con la marca de Liberty Seller, para enviárselo al cliente'
      }
    >
      {bajando ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
      {bajando ? 'Generando…' : 'Informe PDF'}
    </button>
  )
}
