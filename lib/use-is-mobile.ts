'use client'

import { useEffect, useState } from 'react'

/**
 * true por debajo del breakpoint `lg` de Tailwind (1024px).
 *
 * Arranca en false para que el servidor y el primer render del cliente
 * coincidan: si devolviera el valor real de entrada, React se quejaría de
 * hidratación. El ajuste ocurre en el primer efecto, imperceptible.
 */
export function useIsMobile(query = '(max-width: 1023px)'): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia(query)
    const apply = () => setIsMobile(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [query])

  return isMobile
}
