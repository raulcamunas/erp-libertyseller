import { useCallback, useRef } from 'react'

/**
 * Una función con la identidad siempre igual que ejecuta SIEMPRE la última versión de lo que se le pasó.
 *
 * Para los manejadores que se le pasan a componentes memorizados (las columnas y los bloques del calendario): si el manejador cambiara en cada pintado, la memoria no
 * serviría de nada y se repintaría todo igual; si se congelara con `useCallback([])`, leería el estado de la primera vez. Con esto ninguna de las dos cosas.
 */
export function useEstable<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ultima = useRef(fn)
  ultima.current = fn
  return useCallback((...args: A) => ultima.current(...args), [])
}
