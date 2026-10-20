'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CajaEnEdicion } from '@/lib/fba/encaje-resumen'

/**
 * EL GUARDADO AUTOMÁTICO DE LAS CAJAS.
 *
 * El cliente no pulsa «guardar»: cada cambio se manda solo, medio segundo después de que deje de
 * tocar. Es lo que permite cerrar la pestaña a mitad y seguir mañana, y que lo que ve la agencia sea
 * siempre lo último.
 *
 * ============ UNA PETICIÓN A LA VEZ ============
 *
 * guardarCajas() del servidor borra el conjunto entero y lo reescribe. Dos peticiones en vuelo a la vez
 * podrían intercalarse —borra una, borra la otra, escribe la una, escribe la otra— y chocar con el
 * índice único (remesa, número de caja). Así que NUNCA hay dos: si el cliente sigue tocando mientras
 * una viaja, se espera a que acabe y se manda lo último de una vez, no cada paso intermedio.
 *
 * ============ UN FALLO NO SE PIERDE ============
 *
 * Si no hay conexión, lo que hay en pantalla sigue ahí y se reintenta cada pocos segundos; la página
 * dice que no está guardado. Si el servidor RECHAZA los datos (un 4xx con su motivo) no se reintenta en
 * bucle: se enseña el motivo y se vuelve a probar con el siguiente cambio.
 */

export type EstadoDeGuardado = 'guardado' | 'pendiente' | 'guardando' | 'error'

const ESPERA_TRAS_TOCAR_MS = 700
const ESPERA_TRAS_FALLO_MS = 5000

export function useAutoguardado(token: string, cajas: CajaEnEdicion[], activo: boolean) {
  const [estado, setEstado] = useState<EstadoDeGuardado>('guardado')
  const [motivo, setMotivo] = useState<string | null>(null)
  const [guardadoAt, setGuardadoAt] = useState<number | null>(null)

  const ultimas = useRef(cajas)
  // La firma de lo último que SABEMOS que está en el servidor: al abrir, lo que trajo la página
  const enElServidor = useRef(JSON.stringify(cajas))
  const enVuelo = useRef<Promise<boolean> | null>(null)
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  const sincronizar = useCallback((): Promise<boolean> => {
    // Si ya hay una viajando, se espera a que acabe y se vuelve a mirar si falta algo
    if (enVuelo.current) return enVuelo.current.then(() => sincronizar())
    const firma = JSON.stringify(ultimas.current)
    if (firma === enElServidor.current) {
      setEstado('guardado')
      return Promise.resolve(true)
    }

    setEstado('guardando')
    const peticion = (async (): Promise<boolean> => {
      try {
        const res = await fetch(`/api/publico/encajar/${token}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cajas: ultimas.current }),
        })
        const cuerpo = (await res.json().catch(() => null)) as { error?: string; guardadoAt?: string } | null
        if (!res.ok) {
          setMotivo(cuerpo?.error ?? `No se ha podido guardar (código ${res.status}).`)
          setEstado('error')
          // Un rechazo con motivo (4xx) no se reintenta solo: lo que mandamos no va a ser distinto. Un corte sí
          if (res.status >= 500 || res.status === 429) programar(ESPERA_TRAS_FALLO_MS)
          return false
        }
        enElServidor.current = firma
        setMotivo(null)
        setGuardadoAt(Date.now())
        return true
      } catch {
        setMotivo('Sin conexión: lo que has hecho sigue aquí y se guardará cuando vuelva.')
        setEstado('error')
        programar(ESPERA_TRAS_FALLO_MS)
        return false
      }
    })().finally(() => {
      enVuelo.current = null
    })
    enVuelo.current = peticion

    return peticion.then((bien) => {
      if (!bien) return false
      // Mientras viajaba pudo cambiar algo: otra vuelta con lo último
      if (JSON.stringify(ultimas.current) !== enElServidor.current) return sincronizar()
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
    ultimas.current = cajas
    if (!activo) return
    if (JSON.stringify(cajas) === enElServidor.current) return
    setEstado((e) => (e === 'guardando' ? e : 'pendiente'))
    programar(ESPERA_TRAS_TOCAR_MS)
    return () => {
      if (temporizador.current) clearTimeout(temporizador.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cajas, activo])

  // Si se cierra la pestaña con algo sin guardar, el navegador avisa
  useEffect(() => {
    if (!activo) return
    const aviso = (e: BeforeUnloadEvent) => {
      if (JSON.stringify(ultimas.current) !== enElServidor.current) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', aviso)
    return () => window.removeEventListener('beforeunload', aviso)
  }, [activo])

  return { estado, motivo, guardadoAt, sincronizar }
}
