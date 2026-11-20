'use client'

import { useEffect } from 'react'

/**
 * ¿ESTÁ EL TECLADO DEL MÓVIL ABIERTO? Pone `html[data-escribiendo]` mientras lo está, para esconder la barra de abajo (si no, el teclado la sube y se
 * come media pantalla). Es lo mismo que hace el chat a pantalla completa con `data-teclado` (components/chat/useAjusteMovil.ts), pero para todo el
 * ERP y sin tocar nada más. Solo en pantallas estrechas: en el escritorio no hace nada.
 *
 * Se sabe de dos maneras, porque ninguna vale sola: hay un campo de texto con el foco (el iPhone instalado como aplicación no siempre encoge la
 * ventana) o la parte visible (`visualViewport`) es bastante más baja que la ventana.
 */
const esCampo = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.matches('textarea, select, input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit]):not([type=file]):not([type=color])') || t.isContentEditable)

export function useTeclado(): void {
  useEffect(() => {
    const estrecha = window.matchMedia('(max-width: 1023.98px)')
    const html = document.documentElement
    const vv = window.visualViewport
    let quitar: number | undefined

    const decidir = () => {
      const abierto = estrecha.matches && (esCampo(document.activeElement) || (vv ? window.innerHeight - vv.height > 150 : false))
      html.toggleAttribute('data-escribiendo', abierto)
    }
    const alEnfocar = (e: FocusEvent) => {
      if (!esCampo(e.target)) return
      window.clearTimeout(quitar)
      decidir()
    }
    // Pasar de un campo a otro no es cerrar el teclado: se espera un poco antes de decidir
    const alDesenfocar = () => {
      window.clearTimeout(quitar)
      quitar = window.setTimeout(decidir, 120)
    }

    document.addEventListener('focusin', alEnfocar)
    document.addEventListener('focusout', alDesenfocar)
    vv?.addEventListener('resize', decidir)
    estrecha.addEventListener('change', decidir)
    return () => {
      window.clearTimeout(quitar)
      document.removeEventListener('focusin', alEnfocar)
      document.removeEventListener('focusout', alDesenfocar)
      vv?.removeEventListener('resize', decidir)
      estrecha.removeEventListener('change', decidir)
      html.removeAttribute('data-escribiendo')
    }
  }, [])
}
