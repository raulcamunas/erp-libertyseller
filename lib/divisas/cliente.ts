'use client'

import { useSyncExternalStore } from 'react'
import { ponerTipos, suscribirTipos, tiposActuales } from './estado'

/**
 * LOS TIPOS DE CAMBIO EN EL NAVEGADOR: se piden una vez (/api/tipos-de-cambio) y los componentes que enseñan importes en otra moneda se suscriben con
 * `useTiposDeCambio()` para volver a pintarse en euros en cuanto llegan (el cálculo, `aEuros`, está en ./estado).
 */
let pedido = false

function pedir() {
  if (pedido || typeof window === 'undefined') return
  pedido = true
  fetch('/api/tipos-de-cambio')
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { porEuro?: Record<string, number> } | null) => {
      if (j?.porEuro) ponerTipos(j.porEuro)
    })
    .catch(() => {
      pedido = false
    })
}

export function useTiposDeCambio(): Record<string, number> | null {
  return useSyncExternalStore(
    (o) => {
      const quitar = suscribirTipos(o)
      pedir()
      return quitar
    },
    tiposActuales,
    () => null
  )
}
