'use client'

import { useEffect, useRef, useState } from 'react'
import { combinarSeleccion, rectDeDosPuntos, recortar, seTocan, type Rect } from '@/lib/tareas-clientes/seleccion'

/**
 * EL CUADRO DE SELECCIÓN: pulsar sobre el fondo (no sobre una tarjeta, un botón, una cabecera…) y arrastrar dibuja un rectángulo, y las tareas que toca quedan marcadas.
 * Con Mayús, Ctrl o Cmd pulsado al empezar, se suman a las que ya estaban marcadas. Un clic en el fondo, sin arrastrar, quita la selección.
 *
 * Solo con el ratón: en el móvil arrastrar es desplazarse. Cada tarea que se puede marcar lleva `data-tarea-id`. Las que quedan tapadas por el borde de una columna con
 * desplazamiento (más abajo de lo que se ve) no cuentan aunque el cuadro pase por encima.
 */

const NO_EMPIEZA_AQUI = '[data-tarea-id], button, a, input, textarea, select, label, [role="dialog"], [role="menu"], [data-radix-popper-content-wrapper], .tc-columna-cabecera, .tc-grupo-cliente, [data-no-marco]'
const UMBRAL_PX = 5

export function useMarco(el: HTMLElement | null, opciones: { seleccion: ReadonlySet<string>; fijar: (s: Set<string>) => void; vaciar: () => void; activo: boolean }): { marco: Rect | null } {
  const [marco, setMarco] = useState<Rect | null>(null)
  // Lo último que hay en la pantalla, para que los oyentes (que se ponen una sola vez) no trabajen con datos viejos
  const ultimas = useRef(opciones)
  ultimas.current = opciones

  useEffect(() => {
    if (!el || !opciones.activo) return
    let inicio: { x: number; y: number; aditivo: boolean; base: Set<string> } | null = null
    let arrastrando = false
    let ultimoCalculo = 0
    let rectActual: Rect | null = null

    const tocadas = (r: Rect): string[] => {
      // La vista se busca cada vez: se vuelve a crear al cambiar de cliente o de vista
      const vista = el.querySelector<HTMLElement>('.tc-vista') ?? el
      const salida: string[] = []
      for (const n of el.querySelectorAll<HTMLElement>('[data-tarea-id]')) {
        const caja = n.getBoundingClientRect()
        // Lo que no se ve (cortado por la columna con scroll o por el recuadro de la vista) no se selecciona
        const columna = n.closest('.tc-columna-cuerpo')?.getBoundingClientRect() ?? null
        const enColumna = recortar(caja, columna)
        const visible = enColumna ? recortar(enColumna, vista.getBoundingClientRect()) : null
        if (visible && seTocan(r, visible) && n.dataset.tareaId) salida.push(n.dataset.tareaId)
      }
      return salida
    }

    const alMover = (e: PointerEvent) => {
      if (!inicio) return
      if (!arrastrando && Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) < UMBRAL_PX) return
      if (!arrastrando) {
        arrastrando = true
        document.body.classList.add('tc-marcando')
        window.getSelection()?.removeAllRanges()
      }
      const r = rectDeDosPuntos(inicio.x, inicio.y, e.clientX, e.clientY)
      rectActual = r
      setMarco(r)
      // Recalcular la selección a lo sumo cada 30 ms (con cientos de tareas, hacerlo en cada movimiento del ratón sobraría); al soltar se calcula una última vez
      const ahora = performance.now()
      if (ahora - ultimoCalculo >= 30) {
        ultimoCalculo = ahora
        ultimas.current.fijar(combinarSeleccion(inicio.base, tocadas(r), inicio.aditivo))
      }
    }

    const alSoltar = () => {
      window.removeEventListener('pointermove', alMover)
      document.body.classList.remove('tc-marcando')
      if (inicio && arrastrando && rectActual) ultimas.current.fijar(combinarSeleccion(inicio.base, tocadas(rectActual), inicio.aditivo))
      // Un clic en el fondo, sin arrastrar y sin Mayús: quita la selección
      if (inicio && !arrastrando && !inicio.aditivo) ultimas.current.vaciar()
      inicio = null
      arrastrando = false
      setMarco(null)
    }

    const alPulsar = (e: PointerEvent) => {
      if (e.button !== 0 || e.pointerType !== 'mouse') return
      const t = e.target
      // Solo se empieza desde dentro de la vista (no desde la cabecera con los botones)
      if (!(t instanceof HTMLElement) || !t.closest('.tc-vista') || t.closest(NO_EMPIEZA_AQUI)) return
      inicio = { x: e.clientX, y: e.clientY, aditivo: e.shiftKey || e.metaKey || e.ctrlKey, base: new Set(ultimas.current.seleccion) }
      arrastrando = false
      window.addEventListener('pointermove', alMover)
      window.addEventListener('pointerup', alSoltar, { once: true })
    }

    el.addEventListener('pointerdown', alPulsar)
    return () => {
      el.removeEventListener('pointerdown', alPulsar)
      window.removeEventListener('pointermove', alMover)
      window.removeEventListener('pointerup', alSoltar)
      document.body.classList.remove('tc-marcando')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [el, opciones.activo])

  return { marco }
}
