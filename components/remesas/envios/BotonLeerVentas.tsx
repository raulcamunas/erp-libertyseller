'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CloudDownload, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { BOTON } from '@/lib/estilo/denso'
import { sinRespuestaDe } from '../comun/errores'
import { cx } from '../comun/ui'
import { fecha } from '../formato'

/**
 * «LEER VENTAS»: PEDIRLE A AMAZON YA EL LIBRO MAYOR DE ESTE ENVÍO.
 *
 * Las ventas de un envío salen del libro mayor de inventario de Amazon, y el ERP lo lee solo una vez
 * al día (la pasada de la noche). Eso está bien para el día a día, pero no para el momento en que se
 * acaba de traer un envío de Amazon: hasta la noche siguiente todo sale en cero y parece que no se ha
 * vendido nada. Este botón lo lee ahora, en la cuenta y el mercado de ESE envío, y le hace sitio a su
 * llegada aunque el envío sea antiguo (app/api/fba/sincronizar?remesa=).
 *
 * Amazon tarda entre uno y varios minutos en preparar el informe y la petición espera a que esté. Si la
 * conexión se corta por el camino el servidor sigue con lo suyo: el informe no depende de que esta pestaña
 * siga abierta, y por eso un fallo de red no se cuenta como un fallo de la lectura.
 *
 * Aunque se lea AHORA, el libro mayor de Amazon es diario: lo de hoy aparece mañana. Solo sale para
 * administradores, igual que «Leer de Amazon» del panel del cliente.
 */
export function BotonLeerVentas({ remesaId, destacado }: { remesaId: string; destacado: boolean }) {
  const router = useRouter()
  const [leyendo, setLeyendo] = useState(false)

  async function leer() {
    setLeyendo(true)
    try {
      const res = await fetch(`/api/fba/sincronizar?remesa=${encodeURIComponent(remesaId)}`, { method: 'POST' })
      const cuerpo = (await res.json().catch(() => null)) as {
        error?: string
        hasta?: string
        movimientos?: number
        remesasReconocidas?: number
        mercado?: { nombre: string }
      } | null
      if (!res.ok) {
        toast.error(cuerpo?.error ?? sinRespuestaDe('No se ha podido leer el libro mayor de Amazon', res.status), { duration: 14_000 })
        return
      }
      const reconocidas = cuerpo?.remesasReconocidas ?? 0
      toast.success(
        `Ventas leídas hasta el ${cuerpo?.hasta ? fecha(cuerpo.hasta) : 'día de hoy'}${cuerpo?.mercado ? ` en Amazon ${cuerpo.mercado.nombre}` : ''}: ${(cuerpo?.movimientos ?? 0).toLocaleString('es-ES')} movimientos` +
          (reconocidas > 0 ? ` · llegada confirmada en ${reconocidas} envío${reconocidas === 1 ? '' : 's'}` : ''),
        { duration: 9_000 }
      )
      router.refresh()
    } catch {
      toast.warning('Se ha cortado la conexión con el servidor, pero la lectura puede seguir en marcha. Vuelve a mirar dentro de unos minutos.', { duration: 12_000 })
    } finally {
      setLeyendo(false)
    }
  }

  return (
    <button
      type="button"
      onClick={() => void leer()}
      disabled={leyendo}
      className={cx(BOTON.base, destacado ? BOTON.primario : BOTON.secundario)}
      title={
        leyendo
          ? 'Amazon tarda unos minutos en preparar el informe. Puedes seguir trabajando'
          : 'Le pide a Amazon, y guarda, el libro mayor de este cliente hasta ayer —ventas, devoluciones y la llegada de este envío— para repartirlo entre sus envíos. Tarda unos minutos. El ERP ya lo lee solo cada noche; esto es para cuando no se puede esperar'
      }
    >
      {leyendo ? <Loader2 className="h-3 w-3 animate-spin" /> : <CloudDownload className="h-3 w-3" />}
      {leyendo ? 'Leyendo de Amazon…' : 'Leer ventas'}
    </button>
  )
}
