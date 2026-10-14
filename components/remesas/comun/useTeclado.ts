'use client'

import { useEffect, type RefObject } from 'react'

/**
 * MOVERSE POR UNA LISTA CON LAS FLECHAS.
 *
 * Quien pasa horas recorriendo envíos no quiere coger el ratón para cada uno:
 * flecha abajo y flecha arriba cambian el elegido, y el elegido se mantiene a la
 * vista. Solo escucha cuando el foco está dentro de la lista y NO en un campo de
 * texto, para no pisar la búsqueda ni cualquier cuadro de escritura.
 */
export function useTecladoDeLista(contenedor: RefObject<HTMLElement>, ids: string[], elegido: string | null, onElegir: (id: string) => void) {
  useEffect(() => {
    const el = contenedor.current
    if (!el) return

    function alPulsar(e: KeyboardEvent) {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      const destino = e.target as HTMLElement | null
      if (destino && ['INPUT', 'TEXTAREA', 'SELECT'].includes(destino.tagName)) return
      if (ids.length === 0) return
      e.preventDefault()
      const i = elegido ? ids.indexOf(elegido) : -1
      const sig = e.key === 'ArrowDown' ? Math.min(ids.length - 1, i + 1) : Math.max(0, i - 1)
      if (ids[sig] && ids[sig] !== elegido) onElegir(ids[sig])
    }

    el.addEventListener('keydown', alPulsar)
    return () => el.removeEventListener('keydown', alPulsar)
  }, [contenedor, ids, elegido, onElegir])

  // El elegido se mantiene a la vista aunque se cambie con las flechas
  useEffect(() => {
    if (!elegido) return
    contenedor.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [contenedor, elegido])
}
