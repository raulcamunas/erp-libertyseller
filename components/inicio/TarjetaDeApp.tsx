'use client'

import Link from 'next/link'
import { useRef, type CSSProperties, type MouseEvent, type ReactNode } from 'react'

/**
 * UNA TARJETA DE LA PANTALLA DE INICIO. Es un enlace a la aplicación, con su entrada escalonada y un foco de luz que sigue al ratón por encima.
 *
 * Aquí solo se apunta dónde está el ratón (dos variables CSS, `--mx` y `--my`, dentro de la tarjeta); el resto —el brillo del borde, el halo de
 * dentro, la elevación y el icono que se inclina— lo pone el estilo (`inicio-tarjeta`, en el bloque «Inicio y acceso» de app/globals.css), así que sin
 * ratón (o con un móvil) la tarjeta es igual de útil y solo le falta el brillo.
 *
 * El contenido llega ya pintado por el servidor (`children`): el icono es un componente y no se puede pasar a un componente del navegador, pero sí el
 * elemento ya montado.
 */
export function TarjetaDeApp({ href, indice, children }: { href: string; indice: number; children: ReactNode }) {
  const ref = useRef<HTMLAnchorElement>(null)

  function alMover(e: MouseEvent<HTMLAnchorElement>) {
    const el = ref.current
    if (!el) return
    const caja = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - caja.left}px`)
    el.style.setProperty('--my', `${e.clientY - caja.top}px`)
  }

  // Hasta el escalón 14 y de ahí en adelante todas a la vez: con treinta aplicaciones la última no puede tardar dos segundos en aparecer
  const escalon = { '--d': Math.min(indice, 14) } as CSSProperties

  return (
    <Link ref={ref} href={href} onMouseMove={alMover} className="inicio-tarjeta inicio-aparece" style={escalon}>
      {children}
    </Link>
  )
}
