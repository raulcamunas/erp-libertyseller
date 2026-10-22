'use client'

import { useEffect, useRef } from 'react'

/**
 * QUE LA LLAMADA QUE ACABA DE ACABAR SALGA YA EN EL HISTORIAL DEL LEAD.
 *
 * La pasada de fondo lee Rinkel cada pocos minutos, y eso deja al comercial mirando un lead sin su llamada hasta que toca. Mientras
 * Cold Calling está abierta y a la vista se le pide al servidor una lectura RÁPIDA de la cuenta de Rinkel de quien mira (solo las
 * últimas dos horas, una petición a Rinkel) cada minuto. Si han llegado llamadas nuevas se avisa para que la ficha vuelva a
 * pedir las de su lead.
 *
 * Se para solo, y para siempre en esta pantalla abierta, cuando el servidor dice que no hay nada que leer: no hay clave de Rinkel
 * vinculada (409), no hay permiso (401/403) o hay un fallo que no se arregla insistiendo. Quien supervisa y no tiene Rinkel propio
 * nunca llega a molestar a nadie.
 */

const CADA_MS = 60_000
/** Una lectura no se repite antes de esto, vuelva la pestaña a la vista cuantas veces vuelva */
const MINIMO_ENTRE_LECTURAS_MS = 45_000

interface Respuesta {
  resumen?: { importadas?: unknown }
}

export function useSincronizarRinkel(activo: boolean, alLlegarLlamadas: () => void) {
  // El aviso se guarda en una referencia: si cambiara su identidad en cada pintado, el reloj se reiniciaría sin parar
  const aviso = useRef(alLlegarLlamadas)
  aviso.current = alLlegarLlamadas

  useEffect(() => {
    if (!activo) return
    let parado = false
    let enCurso = false
    let ultima = 0
    let importadas: number | null = null

    const leer = async () => {
      if (parado || enCurso || document.visibilityState !== 'visible') return
      if (Date.now() - ultima < MINIMO_ENTRE_LECTURAS_MS) return
      enCurso = true
      ultima = Date.now()
      try {
        const r = await fetch('/api/rendimiento/rinkel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accion: 'sincronizar', rapida: true }),
          cache: 'no-store',
        })
        if (r.status === 401 || r.status === 403 || r.status === 409 || r.status === 503) {
          parado = true
          return
        }
        if (!r.ok) return
        const cuerpo = (await r.json().catch(() => null)) as Respuesta | null
        const total = cuerpo?.resumen?.importadas
        if (typeof total === 'number') {
          if (importadas !== null && total > importadas) aviso.current()
          importadas = total
        }
      } catch {
        // Sin red o el servidor reiniciándose: se vuelve a intentar en el siguiente minuto
      } finally {
        enCurso = false
      }
    }

    void leer()
    const reloj = setInterval(() => void leer(), CADA_MS)
    const alVolver = () => {
      if (document.visibilityState === 'visible') void leer()
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      parado = true
      clearInterval(reloj)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [activo])
}
