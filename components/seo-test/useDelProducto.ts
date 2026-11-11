'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { llamar } from '@/components/marketing-test/llamar'

/**
 * Lo que se pide aparte para UN producto (la competencia, lo de Marketing Test, las propuestas de ficha): se carga al elegirlo y se descarta si mientras tanto se elige otro.
 */
export function useDelProducto<T>(url: string | null) {
  const [datos, setDatos] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const peticion = useRef(0)

  const cargar = useCallback(async () => {
    if (!url) return
    const id = ++peticion.current
    setCargando(true)
    try {
      const r = await llamar<T>(url)
      if (id !== peticion.current) return
      setDatos(r)
      setError(null)
    } catch (e) {
      if (id === peticion.current) setError(e instanceof Error ? e.message : 'No se ha podido cargar.')
    } finally {
      if (id === peticion.current) setCargando(false)
    }
  }, [url])

  useEffect(() => {
    setDatos(null)
    setError(null)
    void cargar()
  }, [cargar])

  return { datos, error, cargando, recargar: cargar }
}
