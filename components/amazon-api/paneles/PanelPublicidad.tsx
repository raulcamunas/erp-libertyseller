'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { ListaInfo, SeccionInfo } from '@/components/ui/BotonInfo'
import { MarketingApiBoard, type ClienteAds } from '@/components/marketing-api/MarketingApiBoard'
import type { ClienteMarketing } from '@/lib/ads/datos'

/**
 * PESTAÑA «PUBLICIDAD» — LA CONEXIÓN CON AMAZON ADS.
 *
 * Vivía en su propio módulo del menú y se ha traído aquí, que es donde le toca
 * por la regla de siempre: CONFIGURAR va en Amazon API, TRABAJAR va en Growth
 * Partner. Autorizar una cuenta de publicidad y decidir qué perfiles se
 * trabajan es configurar, igual que conectar la cuenta de vendedor en «Cuentas»
 * o decir de dónde llega el fichero de stock en «Origen».
 *
 *
 * ============ POR QUÉ SE CARGA SUS PROPIOS DATOS ============
 *
 * La carcasa reparte a los nueve paneles un `AmazonView` común que se construye
 * en CADA visita a Amazon API. Meter ahí las conexiones de Ads haría que las
 * otras ocho pestañas pagaran esa consulta sin usarla nunca. Se pide al abrir
 * esta, y solo al abrir esta.
 */
export function PanelPublicidad() {
  const [datos, setDatos] = useState<{
    clientes: ClienteAds[]
    clientesMarketing: ClienteMarketing[]
    urlDeVuelta: string
    aviso: string | null
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    fetch('/api/ads/estado')
      .then(async (res) => {
        const payload = await res.json().catch(() => null)
        if (cancelado) return
        if (!res.ok) {
          setError(payload?.error ?? 'No se ha podido cargar')
          return
        }
        setDatos(payload)
      })
      .catch(() => {
        if (!cancelado) setError('No hay conexión con el servidor')
      })
    return () => {
      cancelado = true
    }
  }, [])

  if (error) {
    return <p className="text-[12px] text-red-300/80">{error}</p>
  }
  if (!datos) {
    return (
      <div className="flex items-center gap-2 text-white/35 py-8">
        <Loader2 className="h-4 w-4 animate-spin text-[#FF6600]" />
        <span className="text-[12px]">Cargando las conexiones de publicidad…</span>
      </div>
    )
  }

  return (
    <MarketingApiBoard
      clientes={datos.clientes}
      clientesMarketing={datos.clientesMarketing}
      urlDeVuelta={datos.urlDeVuelta}
      aviso={datos.aviso}
    />
  )
}

export function InfoPublicidad() {
  return (
    <>
      <SeccionInfo titulo="Qué hay aquí">
        <p>
          La autorización de Amazon Ads y qué cuentas de anunciante se trabajan. De momento solo
          eso: conectar y elegir. Los informes y las métricas se montarán encima cuando esté
          decidida la estructura.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="La autorización es NUESTRA, no del cliente">
        <p>
          Se autoriza una vez, con la cuenta de Amazon de la agencia. A partir de ahí, cada cliente
          que nos dé acceso a su perfil de publicidad aparece aquí solo, sin volver a autorizar
          nada.
        </p>
        <p>
          Por eso bajo una misma conexión salen cuentas de anunciantes distintos —y también las de
          encargos antiguos a los que ese correo sigue teniendo acceso—.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Los dos interruptores de cada cuenta">
        <ListaInfo>
          <li>
            <strong>Se usa</strong> — si el ERP le pide informes y guarda sus datos. Nacen todas
            apagadas: una cuenta se trabaja porque alguien la marca, nunca porque apareciera en una
            lista.
          </li>
          <li>
            <strong>Cliente</strong> — de quién es esa cuenta. Es la lista de clientes de{' '}
            <em>publicidad</em>, que no son los mismos que los de la pestaña «Cuentas».
          </li>
        </ListaInfo>
        <p>
          Sin cliente asignado no se trabaja, aunque esté encendida: no habría dónde guardar sus
          datos sin mezclarlos con los de otro anunciante, y eso es justo lo que el acuerdo con
          Amazon no permite.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Si Amazon rechaza la conexión">
        <p>
          El fallo número uno es la <strong>URL de vuelta</strong>: tiene que estar registrada letra
          por letra en «Allowed Return URLs» de la aplicación en Login with Amazon. Cuando no
          coincide, el error de Amazon no la menciona. Por eso está escrita arriba, para poder
          compararla.
        </p>
      </SeccionInfo>
    </>
  )
}
