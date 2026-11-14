'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LineaDePropuesta } from '@/lib/fba/propuesta-cliente'

/**
 * EL GUARDADO AUTOMÁTICO DE LA PROPUESTA DEL CLIENTE.
 *
 * Como el de las cajas (components/encaje/useAutoguardado.ts): el cliente no pulsa «guardar», cada cambio se
 * manda solo al rato de dejar de tocar, UNA petición a la vez y con lo último. Lleva la versión de las
 * líneas (bloqueo optimista, migración 309): si la agencia cambia la propuesta mientras él la mira, el
 * servidor contesta 409 y se deja de guardar hasta recargar, para no pisar lo de la agencia.
 */

export type EstadoDeGuardado = 'guardado' | 'pendiente' | 'guardando' | 'error'

const ESPERA_MS = 800
const REINTENTO_MS = 5000

export interface LineaEnviada {
  sku: string
  unidades: number
  comentario: string | null
}

const firmaDe = (ls: LineaEnviada[]) => JSON.stringify([...ls].sort((a, b) => a.sku.localeCompare(b.sku)))

export function useGuardadoPropuesta(token: string, lineas: LineaEnviada[], activo: boolean, versionInicial: number | null, alGuardar: (lineas: LineaDePropuesta[]) => void) {
  const [estado, setEstado] = useState<EstadoDeGuardado>('guardado')
  const [motivo, setMotivo] = useState<string | null>(null)
  const [conflicto, setConflicto] = useState(false)
  const version = useRef<number | null>(versionInicial)
  const ultimas = useRef(lineas)
  const enElServidor = useRef(firmaDe(lineas))
  const enVuelo = useRef<Promise<boolean> | null>(null)
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)
  const alGuardarRef = useRef(alGuardar)
  alGuardarRef.current = alGuardar

  const sincronizar = useCallback((): Promise<boolean> => {
    if (enVuelo.current) return enVuelo.current.then(() => sincronizar())
    const firma = firmaDe(ultimas.current)
    if (firma === enElServidor.current) {
      setEstado('guardado')
      return Promise.resolve(true)
    }
    setEstado('guardando')
    const p = (async () => {
      try {
        const res = await fetch(`/api/publico/envio/${token}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lineas: ultimas.current, version: version.current }),
        })
        const cuerpo = (await res.json().catch(() => null)) as { error?: string; version?: number | null; lineas?: LineaDePropuesta[]; conflicto?: boolean } | null
        if (!res.ok) {
          if (res.status === 409) setConflicto(true)
          setMotivo(cuerpo?.error ?? `No se ha podido guardar (código ${res.status}).`)
          setEstado('error')
          if (res.status >= 500 || res.status === 429) programar(REINTENTO_MS)
          return false
        }
        enElServidor.current = firma
        if (typeof cuerpo?.version === 'number') version.current = cuerpo.version
        if (cuerpo?.lineas) alGuardarRef.current(cuerpo.lineas)
        setMotivo(null)
        return true
      } catch {
        setMotivo('Sin conexión: tus cambios siguen aquí y se guardarán cuando vuelva.')
        setEstado('error')
        programar(REINTENTO_MS)
        return false
      }
    })().finally(() => {
      enVuelo.current = null
    })
    enVuelo.current = p
    return p.then((bien) => {
      if (!bien) return false
      if (firmaDe(ultimas.current) !== enElServidor.current) return sincronizar()
      setEstado('guardado')
      return true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  function programar(ms: number) {
    if (temporizador.current) clearTimeout(temporizador.current)
    temporizador.current = setTimeout(() => void sincronizar(), ms)
  }

  useEffect(() => {
    ultimas.current = lineas
    if (!activo || conflicto) return
    if (firmaDe(lineas) === enElServidor.current) return
    setEstado((e) => (e === 'guardando' ? e : 'pendiente'))
    programar(ESPERA_MS)
    return () => {
      if (temporizador.current) clearTimeout(temporizador.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineas, activo, conflicto])

  useEffect(() => {
    if (!activo) return
    const aviso = (e: BeforeUnloadEvent) => {
      if (firmaDe(ultimas.current) !== enElServidor.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', aviso)
    return () => window.removeEventListener('beforeunload', aviso)
  }, [activo])

  return { estado, motivo, conflicto, sincronizar, version: () => version.current }
}
