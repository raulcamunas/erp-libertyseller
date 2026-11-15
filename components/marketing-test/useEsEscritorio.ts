'use client'

import { useSyncExternalStore } from 'react'

const CONSULTA = '(min-width: 1024px)' // el `lg` de Tailwind

function suscribir(avisar: () => void) {
  const m = window.matchMedia(CONSULTA)
  m.addEventListener('change', avisar)
  return () => m.removeEventListener('change', avisar)
}

/**
 * ¿Se ve en escritorio (lg o más)? Para pintar SOLO una de las dos versiones de una lista (tabla en escritorio, tarjetas en el móvil). Con `hidden lg:block` se montaban las
 * dos: en el móvil, abrir una campaña con 800 segmentaciones montaba además la tabla escondida (80.000 nodos, 2,4 s de bloqueo con la CPU de un móvil medio) y en «Campañas»
 * la campaña abierta se montaba dos veces (dos lecturas a Amazon). En el servidor no hay ventana: se pinta la del móvil y se corrige al hidratar.
 */
export function useEsEscritorio(): boolean {
  return useSyncExternalStore(
    suscribir,
    () => window.matchMedia(CONSULTA).matches,
    () => false,
  )
}
