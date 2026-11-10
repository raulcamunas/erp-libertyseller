'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { PanelDeCumplimiento } from '@/lib/cumplimiento/panel-calculo'

const CADA_MS = 120_000

/**
 * El panel de un cliente (y un país, o todos). Se pide al servidor al elegir y cada dos minutos: las revisiones llegan solas cada hora y así la pantalla no se queda vieja si se deja abierta.
 */
export function usePanel(slug: string, mercado: string) {
  const [panel, setPanel] = useState<PanelDeCumplimiento | null>(null)
  const [cargando, setCargando] = useState(false)
  const peticion = useRef(0)

  const cargar = useCallback(async () => {
    const id = ++peticion.current
    setCargando(true)
    try {
      const res = await fetch('/api/cumplimiento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion: 'panel', cliente: slug, mercado }),
      })
      const json = (await res.json().catch(() => ({}))) as { panel?: PanelDeCumplimiento; error?: string }
      if (id !== peticion.current) return
      setPanel(res.ok && json.panel ? json.panel : { ok: false, error: json.error ?? `El servidor ha contestado ${res.status}` })
    } catch {
      if (id === peticion.current) setPanel((p) => p ?? { ok: false, error: 'No se ha podido conectar con el servidor.' })
    } finally {
      if (id === peticion.current) setCargando(false)
    }
  }, [slug, mercado])

  useEffect(() => {
    setPanel(null)
    void cargar()
    const t = setInterval(() => void cargar(), CADA_MS)
    return () => {
      clearInterval(t)
      peticion.current++
    }
  }, [cargar])

  return { panel, cargando, recargar: cargar }
}
