'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { MapaDeApariencia } from '@/lib/tareas-clientes/apariencia'
import { BASE, pedir } from './api'

interface ContextoDeApariencia {
  mapa: MapaDeApariencia
  /** Falso si falta la migración 283: no se puede elegir todavía */
  disponible: boolean
  /** Pone el mío (`null` = quitarlo). Falla con el motivo si ya lo tiene otra persona */
  guardar: (color: string | null, icono: string | null) => Promise<void>
}

const VACIO: ContextoDeApariencia = { mapa: {}, disponible: false, guardar: async () => undefined }
const Contexto = createContext<ContextoDeApariencia>(VACIO)
export const useApariencia = (): ContextoDeApariencia => useContext(Contexto)
/** Solo para probar las pantallas con datos inventados (la vista de pruebas) */
export const ContextoDeAparienciaParaPruebas = Contexto

const REFRESCO_MINIMO_MS = 60_000

/**
 * El icono y el color de cada persona, a mano para todas las pantallas del módulo. Llega ya leído del servidor (sin parpadeo) y se relee al volver a la pestaña para ver lo que han
 * cambiado los demás.
 */
export function AparienciaProvider({ inicial, disponibleAlInicio, children }: { inicial: MapaDeApariencia; disponibleAlInicio: boolean; children: ReactNode }) {
  const [mapa, setMapa] = useState<MapaDeApariencia>(inicial)
  const [disponible, setDisponible] = useState(disponibleAlInicio)
  const ultima = useRef(Date.now())

  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState !== 'visible' || Date.now() - ultima.current < REFRESCO_MINIMO_MS) return
      ultima.current = Date.now()
      pedir<{ mapa: MapaDeApariencia; disponible: boolean }>(`${BASE}/apariencia`)
        .then((r) => {
          setMapa(r.mapa)
          setDisponible(r.disponible)
        })
        .catch(() => undefined)
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [])

  const guardar = useCallback(async (color: string | null, icono: string | null) => {
    const r = await pedir<{ mapa: MapaDeApariencia }>(`${BASE}/apariencia`, { metodo: 'PUT', cuerpo: { color, icono } })
    ultima.current = Date.now()
    setMapa(r.mapa)
  }, [])

  const valor = useMemo(() => ({ mapa, disponible, guardar }), [mapa, disponible, guardar])
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}
