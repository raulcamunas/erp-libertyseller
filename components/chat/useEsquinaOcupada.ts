'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * ¿TAPA ALGO LA PASTILLA DEL CHAT? (24 nov 2026, Raúl: «siempre se solapa con algo»). La pastilla vive abajo a la derecha, justo donde los paneles laterales ponen sus botones
 * («Descartar · Hablado · Convertir») y donde acaban muchas tablas. Aquí se mira qué hay DEBAJO de su sitio de siempre; si hay un botón, un enlace, un campo, una imagen o texto,
 * o hay abierto un diálogo, la pastilla se aparta: se queda como una pestañita pegada al borde derecho, a media altura (DockDelChat), y vuelve a la esquina en cuanto queda libre.
 *
 * Se vuelve a mirar cuando cambia la página (se abre un panel, llega una lista), al desplazarse, al cambiar el tamaño de la ventana y, por si acaso, cada 2 s.
 */

const MARGEN = 18
const ALTO = 42
const HOLGURA = 6
const ANCHO_POR_DEFECTO = 110

/** Lo nuestro de la esquina no cuenta: la propia pastilla, la ventana del chat, sus tarjetas, los avisos y la cápsula de la junta */
const PROPIO = '.chat-dock-pastilla, .chat-dock, .chat-vistas, .chat-vista, .rend-aviso, .junta-capsula, [data-esquina-propia]'
const INTERACTIVO =
  'button, a[href], input, select, textarea, label, summary, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="switch"], [role="menuitem"], [contenteditable="true"]'
const MEDIOS = new Set(['IMG', 'CANVAS', 'VIDEO'])

function tapaAlgo(el: Element): boolean {
  if (el === document.documentElement || el === document.body) return false
  if (el.closest(INTERACTIVO)) return true
  if (MEDIOS.has(el.tagName) || el.closest('svg')) return true
  for (const n of Array.from(el.childNodes)) if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) return true
  return false
}

function hayDialogoAbierto(): boolean {
  for (const d of Array.from(document.querySelectorAll('[aria-modal="true"], [role="dialog"], dialog[open]'))) {
    if (d.closest(PROPIO)) continue
    if (d.getClientRects().length === 0) continue
    return true
  }
  return false
}

/** Se mira una rejilla de 5 × 3 puntos sobre el sitio de siempre de la pastilla (con un poco de holgura), aunque ahora esté apartada */
function esquinaOcupada(anchoDeLaPastilla: number): boolean {
  if (hayDialogoAbierto()) return true
  const w = window.innerWidth
  const h = window.innerHeight
  const x0 = w - MARGEN - anchoDeLaPastilla - HOLGURA
  const x1 = Math.min(w - 2, w - MARGEN + HOLGURA)
  const y0 = h - MARGEN - ALTO - HOLGURA
  const y1 = Math.min(h - 2, h - MARGEN + HOLGURA)
  for (let i = 0; i <= 4; i++) {
    for (let j = 0; j <= 2; j++) {
      const x = x0 + ((x1 - x0) * i) / 4
      const y = y0 + ((y1 - y0) * j) / 2
      const primero = document.elementsFromPoint(x, y).find((e) => !e.closest(PROPIO))
      if (primero && tapaAlgo(primero)) return true
    }
  }
  return false
}

export function useEsquinaOcupada(activa: boolean, pastilla: () => HTMLElement | null): boolean {
  const [ocupada, setOcupada] = useState(false)
  const ancho = useRef(ANCHO_POR_DEFECTO)
  const leer = useRef(pastilla)
  leer.current = pastilla

  useEffect(() => {
    if (!activa) {
      setOcupada(false)
      return
    }
    let t: ReturnType<typeof setTimeout> | null = null
    const mirar = () => {
      t = null
      const el = leer.current()
      // El ancho se toma mientras está en su sitio (apartada es más estrecha)
      if (el && el.dataset.apartada !== 'true' && el.offsetWidth > 0) ancho.current = el.offsetWidth
      setOcupada(esquinaOcupada(ancho.current))
    }
    const programar = (ms = 150) => {
      if (t) clearTimeout(t)
      t = setTimeout(mirar, ms)
    }
    mirar()
    const mo = new MutationObserver(() => programar())
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open', 'aria-hidden', 'data-state'] })
    const alDesplazar = () => programar(120)
    const alCambiarTamano = () => programar(120)
    window.addEventListener('scroll', alDesplazar, true)
    window.addEventListener('resize', alCambiarTamano)
    const cadaRato = setInterval(() => programar(0), 2000)
    return () => {
      if (t) clearTimeout(t)
      mo.disconnect()
      window.removeEventListener('scroll', alDesplazar, true)
      window.removeEventListener('resize', alCambiarTamano)
      clearInterval(cadaRato)
    }
  }, [activa])

  return activa && ocupada
}
