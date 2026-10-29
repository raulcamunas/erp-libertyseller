'use client'

import { useEffect, useRef } from 'react'

/**
 * CUÁNDO SE VUELVE A LEER LO QUE SE MIRA: LOS MOMENTOS EN QUE UNA PANTALLA ABIERTA PUEDE HABERSE QUEDADO ATRÁS.
 * ===============================================================================================================
 * El tiempo real avisa de cada cambio, pero solo mientras el canal está vivo, y un navegador lo deja morir en silencio: la pestaña que lleva horas en segundo plano, el portátil
 * que se durmió, la red que se fue medio minuto. Lo que pasó entonces no se vuelve a avisar. Estos son los momentos en que vale la pena preguntar «¿sigo al día?» sin esperar a
 * que nadie recargue la página:
 *
 *   · la pestaña vuelve a verse, o la ventana recupera el foco, o el navegador la restaura de su caché de atrás/adelante (`pageshow` con `persisted`: sin eso también
 *     saltaría en la carga normal de la página, justo cuando acaba de leerse todo);
 *   · vuelve la red;
 *   · cada `cadaMs` mientras la pestaña está a la vista (la red de seguridad de todo lo anterior: el portátil que despierta sin que cambie nada de lo de arriba).
 *
 * Con la pestaña oculta no se lee por reloj: nadie la mira, y diez pestañas olvidadas no deben leer la base cada pocos segundos. Al volver a verla se lee al momento.
 *
 * `visibilitychange`, `focus` y `pageshow` suelen llegar juntos al volver a una pestaña; se juntan en una sola lectura por segundo. Lo que se llama es siempre la ÚLTIMA versión
 * de `releer`, sin volver a suscribir nada cuando cambia.
 */
export function useAlDia(releer: () => void, cadaMs: number): void {
  const reciente = useRef(releer)
  reciente.current = releer

  useEffect(() => {
    const aLaVista = () => document.visibilityState === 'visible'
    let ultimoAviso = 0

    const alVolver = () => {
      if (!aLaVista()) return
      const ahora = Date.now()
      if (ahora - ultimoAviso < 1_000) return
      ultimoAviso = ahora
      reciente.current()
    }
    const alMostrarse = (e: PageTransitionEvent) => {
      if (e.persisted) alVolver()
    }
    const alReloj = () => {
      if (aLaVista()) reciente.current()
    }

    document.addEventListener('visibilitychange', alVolver)
    window.addEventListener('focus', alVolver)
    window.addEventListener('pageshow', alMostrarse)
    window.addEventListener('online', alVolver)
    const id = window.setInterval(alReloj, cadaMs)
    return () => {
      document.removeEventListener('visibilitychange', alVolver)
      window.removeEventListener('focus', alVolver)
      window.removeEventListener('pageshow', alMostrarse)
      window.removeEventListener('online', alVolver)
      window.clearInterval(id)
    }
  }, [cadaMs])
}
