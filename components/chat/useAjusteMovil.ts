'use client'

import { useEffect } from 'react'

/**
 * EL CHAT, EN EL MÓVIL, COMO UNA APLICACIÓN: sin zoom, sin que la página se mueva y ajustado a lo que de verdad se ve.
 *   · El teclado del móvil no encoge la página, solo la parte visible (`visualViewport`): el chat toma esa altura y ese desplazamiento (--chat-alto, --chat-sube) y así la caja de
 *     escribir queda siempre justo encima del teclado y no se queda una franja vacía arriba.
 *   · Se bloquea el gesto de pellizcar (Safari lo ignora en el `viewport`) y la página no se desplaza por debajo.
 *   · `html[data-teclado]` avisa de que el teclado está abierto (para quitar el margen de la barra de inicio del iPhone).
 * Lo de dentro es de CSS (`html.chat-abierto` en globals.css). Solo se usa en la pantalla completa del chat, no en el dock.
 */
export function useAjusteMovil(activo: boolean): void {
  useEffect(() => {
    if (!activo) return
    const html = document.documentElement
    html.classList.add('chat-abierto')
    const vv = window.visualViewport
    const aplicar = () => {
      if (!vv) return
      html.style.setProperty('--chat-alto', `${Math.round(vv.height)}px`)
      html.style.setProperty('--chat-sube', `${Math.round(vv.offsetTop)}px`)
      html.toggleAttribute('data-teclado', window.innerHeight - vv.height > 120)
      if (window.scrollY !== 0) window.scrollTo(0, 0)
    }
    aplicar()
    vv?.addEventListener('resize', aplicar)
    vv?.addEventListener('scroll', aplicar)
    const parar = (e: Event) => e.preventDefault()
    const tocar = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault()
    }
    document.addEventListener('gesturestart', parar)
    document.addEventListener('gesturechange', parar)
    document.addEventListener('touchmove', tocar, { passive: false })
    return () => {
      vv?.removeEventListener('resize', aplicar)
      vv?.removeEventListener('scroll', aplicar)
      document.removeEventListener('gesturestart', parar)
      document.removeEventListener('gesturechange', parar)
      document.removeEventListener('touchmove', tocar)
      html.classList.remove('chat-abierto')
      html.removeAttribute('data-teclado')
      html.style.removeProperty('--chat-alto')
      html.style.removeProperty('--chat-sube')
    }
  }, [activo])
}
