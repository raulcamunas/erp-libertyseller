'use client'

import { useState } from 'react'
import { FileSpreadsheet, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { BOTON } from '@/lib/estilo/denso'
import { bajarRespuesta } from '../comun/descargar'
import { cx } from '../comun/ui'

/**
 * «EXCEL»: LA PROPUESTA EN UN DOCUMENTO CON LA MARCA, PARA MANDÁRSELO AL CLIENTE.
 *
 * Qué producto, qué SKU y cuántas unidades van. Se genera al pulsar con lo que tiene la
 * propuesta en ese momento (la ruta no guarda nada), así que si se corrige una cantidad
 * basta con volver a descargarlo. Disponible para quien pueda ver la propuesta, en
 * cualquier fase.
 */
export function BotonExcel({ remesaId, vacia }: { remesaId: string; vacia: boolean }) {
  const [bajando, setBajando] = useState(false)

  async function bajar() {
    setBajando(true)
    try {
      const res = await fetch(`/api/fba/remesas/${remesaId}/excel`)
      if (!res.ok) {
        const p = (await res.json().catch(() => null)) as { error?: string } | null
        toast.error(p?.error ?? 'No se ha podido generar el Excel')
        return
      }
      await bajarRespuesta(res, 'propuesta-de-envio.xlsx')
      const lineas = Number(res.headers.get('X-Lineas') ?? 0)
      const unidades = Number(res.headers.get('X-Unidades') ?? 0)
      toast.success(`Excel descargado: ${lineas} referencia${lineas === 1 ? '' : 's'} y ${unidades.toLocaleString('es-ES')} unidades`)
    } catch {
      toast.error('No se ha podido descargar el Excel. Revisa la conexión y vuelve a probar.')
    } finally {
      setBajando(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void bajar()}
      disabled={bajando || vacia}
      className={cx(BOTON.base, BOTON.alto, BOTON.secundario)}
      title={vacia ? 'Añade alguna referencia: sin ellas no hay nada que enseñar' : 'Descargar la propuesta en Excel, con la marca de Liberty Seller, para enviársela al cliente'}
    >
      {bajando ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileSpreadsheet className="h-3 w-3" />}
      Descargar Excel
    </button>
  )
}
