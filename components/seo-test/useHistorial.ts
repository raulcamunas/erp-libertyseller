'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { llamar } from '@/components/marketing-test/llamar'
import type { ConsultaHistorica } from '@/lib/seo/datos'
import type { GastoSemanal } from '@/lib/seo/periodo-mostrado'
import type { TramoSinVentas } from '@/lib/seo/sin-stock'

export interface DatosDeHistorial {
  filas: ConsultaHistorica[]
  /** Gasto de publicidad por ASIN y semana (domingo a sábado). null si el cliente no tiene Marketing Test en ese país */
  gastoSemanal: GastoSemanal[] | null
  /** Por ASIN, los tramos sin ninguna venta en FBA (probable rotura de stock). null si no se ha podido leer */
  sinVentas?: Record<string, TramoSinVentas[]> | null
}

/**
 * El historial de las búsquedas de una cuenta (o de un producto), cargado APARTE de useCuentaSeo para no frenar la primera pintura: la tabla sale con lo de la cuenta y las gráficas se rellenan
 * cuando llega esto. Sin `semanas` ni `meses` trae todo lo leído.
 */
export function useHistorial(cuentaId: string | null | undefined, opciones: { asin?: string | null; semanas?: number | null; meses?: number | null } = {}) {
  const { asin = null, semanas = null, meses = null } = opciones
  const [filas, setFilas] = useState<ConsultaHistorica[]>([])
  const [gastoSemanal, setGastoSemanal] = useState<GastoSemanal[] | null>(null)
  const [sinVentas, setSinVentas] = useState<Record<string, TramoSinVentas[]> | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generacion = useRef(0)

  const cargar = useCallback(async () => {
    const mia = ++generacion.current
    if (!cuentaId) {
      setFilas([])
      setGastoSemanal(null)
      setSinVentas(null)
      setCargando(false)
      return
    }
    setCargando(true)
    setError(null)
    try {
      const q = new URLSearchParams({ cuenta: cuentaId })
      if (asin) q.set('asin', asin)
      if (semanas) q.set('semanas', String(semanas))
      if (meses) q.set('meses', String(meses))
      const d = await llamar<DatosDeHistorial>(`/api/seo/historial?${q.toString()}`)
      if (generacion.current !== mia) return
      setFilas(d.filas ?? [])
      setGastoSemanal(d.gastoSemanal ?? null)
      setSinVentas(d.sinVentas ?? null)
    } catch (e) {
      if (generacion.current === mia) setError(e instanceof Error ? e.message : 'No se ha podido cargar el historial.')
    } finally {
      if (generacion.current === mia) setCargando(false)
    }
  }, [cuentaId, asin, semanas, meses])

  useEffect(() => {
    setFilas([])
    setGastoSemanal(null)
    setSinVentas(null)
    void cargar()
    return () => {
      generacion.current++
    }
  }, [cargar])

  return { filas, gastoSemanal, sinVentas, cargando, error, recargar: cargar }
}
