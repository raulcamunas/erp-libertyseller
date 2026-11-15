'use client'

import { useEffect, useState } from 'react'

/**
 * CUÁNTO TAPA EL TECLADO DEL MÓVIL, en px, mientras `activo` (un panel o un diálogo abierto). 0 si no hay teclado.
 *
 * El ERP no declara `interactive-widget=resizes-content`, así que en Chrome de Android y en Safari el teclado se pone ENCIMA de la página sin encoger la ventana:
 * un `fixed; bottom: 0` (la hoja inferior del PanelLateral, con su «Guardar» en el pie) queda debajo del teclado, y el diálogo de Confirmación, centrado, deja el
 * botón de confirmar tapado justo cuando se escribe la palabra. Con esto se suben lo que tape el teclado.
 *
 * Se mide con visualViewport (lo que se ve de verdad): alto de la ventana − alto visible − desplazamiento del visible. Solo cuenta como teclado si hay un campo
 * con el foco y no hay zoom con los dedos (al ampliar, el visible también encoge y no es un teclado), y si pasa de 80 px (la barra del navegador que se esconde).
 */
export function useAltoDelTeclado(activo: boolean): number {
  const [alto, setAlto] = useState(0)
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!activo || !vv) {
      setAlto(0)
      return
    }
    let marco = 0
    const medir = () => {
      cancelAnimationFrame(marco)
      marco = requestAnimationFrame(() => {
        const el = document.activeElement as HTMLElement | null
        const escribiendo = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
        const tapado = Math.round(window.innerHeight - vv.height - vv.offsetTop)
        setAlto(escribiendo && Math.abs(vv.scale - 1) < 0.01 && tapado > 80 ? tapado : 0)
      })
    }
    medir()
    vv.addEventListener('resize', medir)
    vv.addEventListener('scroll', medir)
    // El foco cambia antes que el visualViewport al cerrar el teclado con «Hecho»: se vuelve a mirar al salir de un campo
    document.addEventListener('focusin', medir)
    document.addEventListener('focusout', medir)
    return () => {
      cancelAnimationFrame(marco)
      vv.removeEventListener('resize', medir)
      vv.removeEventListener('scroll', medir)
      document.removeEventListener('focusin', medir)
      document.removeEventListener('focusout', medir)
    }
  }, [activo])
  return alto
}
