'use client'

import dynamic from 'next/dynamic'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, type ReactNode } from 'react'
import { EsqueletoDeCartera } from '@/components/cold-calling/EsqueletoDeCartera'
import { Esqueleto } from '@/components/rendimiento/ui'
import type { UserProfile } from '@/lib/supabase/get-user-profile'

/**
 * LAS APLICACIONES QUE SE QUEDAN ABIERTAS: Cold Calling y Correo.
 * ================================================================
 * Un comercial salta de una a otra todo el día —mira un lead, le escribe, vuelve a la lista—, y con las pantallas de siempre cada salto
 * las tiraba y las volvía a pedir al servidor: se perdía el lead abierto, el filtro, lo escrito a medias y hasta dónde estaba la lista, y la
 * cartera entera tardaba en volver a llegar.
 *
 * El layout de /dashboard NO se vuelve a montar al navegar entre sus páginas, así que este es el sitio donde una aplicación puede
 * sobrevivir a un cambio de pantalla: la PRIMERA vez que se entra en una se monta, y desde entonces se QUEDA MONTADA y solo se oculta
 * cuando se está en otra. Volver es instantáneo y está exactamente como se dejó. Lo que está oculto sigue vivo: el canal en tiempo real,
 * la lectura de Rinkel cada minuto y la del correo nuevo siguen corriendo; lo que NO hace es atender al teclado (cada aplicación recibe
 * `activa` y se desentiende de las teclas cuando no lo es).
 *
 * LAS PÁGINAS DE ESAS RUTAS NO PINTAN NADA (`return null`): existen para que la dirección, el menú y el botón de atrás sigan funcionando
 * y para que el middleware siga cerrando la puerta a quien no tenga la aplicación. Lo que se ve lo pinta esto.
 *
 * OCULTAR NO ES `display: none`. Con `display: none` el navegador tira el recuadro de cada elemento y, al volver, la lista vuelve arriba
 * (se pierde el scroll). Se oculta con `visibility: hidden` y sin altura, que mantiene el recuadro y, con él, la posición del scroll.
 *
 * EL CÓDIGO DE CADA APLICACIÓN SE BAJA SOLO LA PRIMERA VEZ QUE SE ENTRA (import dinámico): no engorda las demás pantallas del ERP. Y para que
 * esa primera vez no espere a la descarga, quien trabaja con ellas (admin y employees) las baja ya, cuando el navegador está parado, nada más
 * abrir cualquier pantalla del ERP. Solo el código: los datos se piden al entrar.
 */

const ColdCallingApp = dynamic(() => import('@/components/cold-calling/ColdCallingApp').then((m) => m.ColdCallingApp), {
  ssr: false,
  loading: () => (
    <div className="flex h-[calc(100dvh-8rem)] min-w-0 flex-col lg:h-[calc(100vh-4rem)]">
      <EsqueletoDeCartera />
    </div>
  ),
})

const CorreoApp = dynamic(() => import('@/components/correo/CorreoApp').then((m) => m.CorreoApp), {
  ssr: false,
  loading: () => (
    <div className="space-y-3 pb-6" aria-busy="true" aria-label="Cargando el correo">
      <Esqueleto className="h-7 w-40" />
      <Esqueleto className="h-[calc(100dvh-10.5rem)] min-h-[540px] w-full" />
    </div>
  ),
})

const RUTA_COLD_CALLING = '/dashboard/cold-calling'
const RUTA_CORREO = '/dashboard/correo'

const esLaRuta = (pathname: string, ruta: string) => pathname === ruta || pathname.startsWith(`${ruta}/`)

function Ranura({ activa, children }: { activa: boolean; children: ReactNode }) {
  return (
    <div
      // Oculta sin `display: none` (ver arriba): sin altura, fuera del flujo, invisible y sin recibir clics ni foco. Conserva su anchura
      // para que, al volver, medir la lista no empiece de cero
      className={activa ? 'rend-fundido' : 'pointer-events-none invisible absolute left-0 top-0 h-0 w-full overflow-hidden'}
      aria-hidden={activa ? undefined : true}
    >
      {children}
    </div>
  )
}

export function AppsPersistentes({ perfil }: { perfil: UserProfile }) {
  const pathname = usePathname() ?? ''
  const enColdCalling = esLaRuta(pathname, RUTA_COLD_CALLING)
  const enCorreo = esLaRuta(pathname, RUTA_CORREO)

  // Con el navegador parado se baja el código de las dos, para que el primer clic en Cold Calling o en Correo no espere a la descarga
  const esDelEquipo = perfil.role === 'admin' || perfil.role === 'employee'
  useEffect(() => {
    if (!esDelEquipo) return
    const precargar = () => {
      void import('@/components/cold-calling/ColdCallingApp')
      void import('@/components/correo/CorreoApp')
    }
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(precargar, { timeout: 4000 })
      return () => window.cancelIdleCallback(id)
    }
    const id = window.setTimeout(precargar, 2500)
    return () => window.clearTimeout(id)
  }, [esDelEquipo])

  // Una vez montada, no se desmonta hasta recargar la pestaña. Se apunta al pintar y no en un efecto para que no haya un cuadro de por medio
  const montadas = useRef({ coldCalling: false, correo: false })
  if (enColdCalling) montadas.current.coldCalling = true
  if (enCorreo) montadas.current.correo = true

  return (
    <>
      {montadas.current.coldCalling && (
        <Ranura activa={enColdCalling}>
          <ColdCallingApp perfil={perfil} activa={enColdCalling} />
        </Ranura>
      )}
      {montadas.current.correo && (
        <Ranura activa={enCorreo}>
          <CorreoApp perfil={perfil} activa={enCorreo} />
        </Ranura>
      )}
    </>
  )
}
