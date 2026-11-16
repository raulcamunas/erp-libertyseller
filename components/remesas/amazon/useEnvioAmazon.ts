'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { EstadoDelEnvio } from '@/lib/fba/envio-amazon-motor'
import { invalidarRemesas } from '../comun/useAgencia'

/**
 * EL ESTADO DEL ENVÍO A AMAZON, EN VIVO.
 *
 * Lee /api/fba/remesas/[id]/amazon al abrir. Mientras haya una operación de Amazon EN CURSO pregunta cada
 * 4 s (y solo con la pestaña visible): cada pregunta hace que el servidor mire esa operación una vez y dé
 * el paso siguiente si ha acabado. Sin nada en curso no hay sondeo: se relee al pulsar o al volver.
 */
const CADA_MS = 4_000

export function useEnvioAmazon(remesaId: string) {
  const [estado, setEstado] = useState<EstadoDelEnvio | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState<string | null>(null)
  const vivo = useRef(true)

  const leer = useCallback(async () => {
    try {
      const res = await fetch(`/api/fba/remesas/${remesaId}/amazon`, { cache: 'no-store' })
      const j = (await res.json().catch(() => null)) as (EstadoDelEnvio & { error?: string }) | null
      if (!vivo.current) return
      if (!res.ok) {
        setError(j?.error ?? 'No se ha podido leer el envío')
        return
      }
      setError(null)
      setEstado(j)
    } catch {
      if (vivo.current) setError('Sin conexión con el ERP')
    }
  }, [remesaId])

  useEffect(() => {
    vivo.current = true
    void leer()
    return () => {
      vivo.current = false
    }
  }, [leer])

  // Sondeo SOLO con algo en curso y la pestaña a la vista
  const enCurso = !!estado?.enCurso
  useEffect(() => {
    if (!enCurso) return
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void leer()
    }, CADA_MS)
    return () => window.clearInterval(t)
  }, [enCurso, leer])

  // Al volver a la pestaña se relee (el cliente puede haber aceptado el transporte entre medias)
  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === 'visible') void leer()
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [leer])

  /** Manda una acción. Devuelve true si salió bien; el error sale en un aviso */
  const enviar = useCallback(
    async (cuerpo: Record<string, unknown>, ruta = '', etiqueta = 'accion'): Promise<boolean> => {
      setTrabajando(etiqueta)
      try {
        const res = await fetch(`/api/fba/remesas/${remesaId}/amazon${ruta}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cuerpo),
        })
        const j = (await res.json().catch(() => null)) as (EstadoDelEnvio & { error?: string }) | null
        if (!res.ok) {
          toast.error(j?.error ?? 'No se ha podido dar el paso')
          void leer()
          return false
        }
        if (j && 'paso' in j) setEstado(j)
        // Un paso dado en Amazon puede mover la remesa: las pantallas de agencia vuelven a pedir sus datos
        invalidarRemesas()
        return true
      } catch {
        toast.error('Sin conexión con el ERP')
        return false
      } finally {
        setTrabajando(null)
      }
    },
    [remesaId, leer]
  )

  return { estado, error, trabajando, leer, enviar }
}
