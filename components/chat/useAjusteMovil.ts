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
      // (si hay un campo con el foco, el teclado está abierto aunque la altura no lo diga)
      html.toggleAttribute('data-teclado', window.innerHeight - vv.height > 120 || (document.activeElement instanceof HTMLElement && document.activeElement.matches('textarea, input')))
      if (window.scrollY !== 0) window.scrollTo(0, 0)
    }
    aplicar()
    // El iPhone instalado como aplicación no siempre encoge `innerHeight` con el teclado: se sabe que está abierto porque hay un campo de texto con el foco
    const esCampo = (t: EventTarget | null) => t instanceof HTMLElement && (t.matches('textarea, input:not([type=checkbox]):not([type=radio]):not([type=range])') || t.isContentEditable)
    let quitar: number | undefined
    const alEnfocar = (e: FocusEvent) => {
      if (!esCampo(e.target)) return
      window.clearTimeout(quitar)
      html.setAttribute('data-teclado', '')
    }
    const alDesenfocar = (e: FocusEvent) => {
      if (!esCampo(e.target)) return
      // Pasar de un campo a otro no es cerrar el teclado
      quitar = window.setTimeout(() => {
        if (!esCampo(document.activeElement) && !(vv && window.innerHeight - vv.height > 120)) html.removeAttribute('data-teclado')
      }, 120)
    }
    document.addEventListener('focusin', alEnfocar)
    document.addEventListener('focusout', alDesenfocar)
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
      document.removeEventListener('focusin', alEnfocar)
      document.removeEventListener('focusout', alDesenfocar)
      window.clearTimeout(quitar)
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
