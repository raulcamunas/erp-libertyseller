'use client'

import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef } from 'react'
import { enviarLote, etiquetaDeControl, idDeSesion, SELECTOR_DE_CONTROL, SELECTOR_DE_TABLA, SELECTOR_SIN_REGISTRO } from '@/lib/actividad/cliente'
import type { TipoDeEvento } from '@/lib/actividad/ingesta'

/**
 * EL OJO DE FONDO: apunta cuándo está una persona en el ERP y qué hace, sin que se note. NO PINTA NADA.
 *
 * Solo se monta para los empleados (app/dashboard/layout.tsx). Manda a /api/actividad, cada medio minuto y al salir de la
 * pestaña: cuándo abre el ERP, qué pantallas pisa, qué botones pulsa (por su nombre, nunca por lo que contienen) y un
 * «sigo aquí» por minuto SOLO si ha tocado algo en los últimos dos minutos y la pestaña está a la vista. No lee lo que
 * escribe, ni contraseñas, ni mira nada fuera del ERP. Lo lee quien supervisa en /dashboard/actividad.
 *
 * LO QUE LO HACE LIGERO: todo son escuchas pasivas, un lote cada 30 s y un máximo de 200 eventos en cola. Si algo falla,
 * se calla: registrar nunca puede romper ni frenar lo que la persona está haciendo.
 */

const CADA_CUANTO_MANDAR_MS = 30_000
const CADA_CUANTO_LATIR_MS = 60_000
/** Sin tocar nada durante este tiempo, el «sigo aquí» deja de salir */
const SIN_TOCAR_NADA_MS = 120_000
const MAX_PENDIENTES = 200
const EVENTOS_POR_PETICION = 50
/** El mismo clic en el mismo sitio dentro de este margen es uno solo (un doble clic, un botón que rebota) */
const REPETIDO_MS = 1_500

interface Pendiente {
  t: TipoDeEvento
  ruta: string
  detalle: string | null
  ts: number
}

export function RegistroDeActividad() {
  const pathname = usePathname() ?? '/'
  const ruta = useRef(pathname)
  const pendientes = useRef<Pendiente[]>([])
  const sesion = useRef<string | null>(null)
  const ultimaInteraccion = useRef(0)

  const poner = useCallback((t: TipoDeEvento, detalle: string | null = null) => {
    if (pendientes.current.length >= MAX_PENDIENTES) pendientes.current.shift()
    pendientes.current.push({ t, ruta: ruta.current, detalle, ts: Date.now() })
  }, [])

  const vaciar = useCallback((alSalir = false) => {
    const id = sesion.current
    if (!id || pendientes.current.length === 0) return
    const lote = pendientes.current.splice(0, pendientes.current.length)
    const ahora = Date.now()
    for (let i = 0; i < lote.length; i += EVENTOS_POR_PETICION) {
      enviarLote(
        id,
        lote.slice(i, i + EVENTOS_POR_PETICION).map((e) => ({ t: e.t, ruta: e.ruta, detalle: e.detalle, hace: ahora - e.ts })),
        { alSalir }
      )
    }
  }, [])

  // Arranque: la pestaña se abre, y de ahí en adelante escuchar. Se monta una sola vez (el layout no se vuelve a montar al navegar)
  useEffect(() => {
    const { id, nueva } = idDeSesion()
    sesion.current = id
    ultimaInteraccion.current = Date.now()
    if (nueva) poner('sesion')

    const latir = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - ultimaInteraccion.current > SIN_TOCAR_NADA_MS) return
      poner('latido')
    }
    // Abrir o recargar una pantalla es haber hecho algo: ese primer minuto cuenta
    latir()

    const tocar = () => {
      ultimaInteraccion.current = Date.now()
    }
    let ultimoMovimiento = 0
    const mover = () => {
      const ahora = Date.now()
      if (ahora - ultimoMovimiento < 5_000) return
      ultimoMovimiento = ahora
      ultimaInteraccion.current = ahora
    }

    let ultimoClic = { etiqueta: '', ruta: '', ts: 0 }
    const alPulsar = (e: MouseEvent) => {
      try {
        ultimaInteraccion.current = Date.now()
        const objetivo = e.target as Element | null
        if (!objetivo || typeof objetivo.closest !== 'function') return
        if (objetivo.closest(SELECTOR_SIN_REGISTRO)) return
        const control = objetivo.closest(SELECTOR_DE_CONTROL) as HTMLElement | null
        if (!control) return
        const etiqueta = etiquetaDeControl({
          aria: control.getAttribute('aria-label'),
          title: control.getAttribute('title'),
          texto: control.innerText ?? control.textContent,
          dentroDeTabla: control.closest(SELECTOR_DE_TABLA) !== null,
        })
        if (!etiqueta) return
        const ahora = Date.now()
        if (ultimoClic.etiqueta === etiqueta && ultimoClic.ruta === ruta.current && ahora - ultimoClic.ts < REPETIDO_MS) return
        ultimoClic = { etiqueta, ruta: ruta.current, ts: ahora }
        poner('clic', etiqueta)
      } catch {
        // registrar nunca rompe nada
      }
    }

    const alCambiarVisibilidad = () => {
      if (document.visibilityState === 'hidden') {
        poner('oculta')
        vaciar(true)
      } else {
        ultimaInteraccion.current = Date.now()
        poner('visible')
        latir()
      }
    }
    const alIrse = () => vaciar(true)

    const opciones = { passive: true, capture: true } as const
    document.addEventListener('pointerdown', tocar, opciones)
    document.addEventListener('keydown', tocar, opciones)
    document.addEventListener('wheel', tocar, opciones)
    document.addEventListener('touchstart', tocar, opciones)
    document.addEventListener('pointermove', mover, opciones)
    document.addEventListener('click', alPulsar, true)
    document.addEventListener('visibilitychange', alCambiarVisibilidad)
    window.addEventListener('pagehide', alIrse)

    const reloj = window.setInterval(latir, CADA_CUANTO_LATIR_MS)
    const envio = window.setInterval(() => vaciar(false), CADA_CUANTO_MANDAR_MS)

    return () => {
      document.removeEventListener('pointerdown', tocar, opciones)
      document.removeEventListener('keydown', tocar, opciones)
      document.removeEventListener('wheel', tocar, opciones)
      document.removeEventListener('touchstart', tocar, opciones)
      document.removeEventListener('pointermove', mover, opciones)
      document.removeEventListener('click', alPulsar, true)
      document.removeEventListener('visibilitychange', alCambiarVisibilidad)
      window.removeEventListener('pagehide', alIrse)
      window.clearInterval(reloj)
      window.clearInterval(envio)
      vaciar(true)
    }
  }, [poner, vaciar])

  // La pantalla cambia (también la primera vez, justo después de «ha abierto el ERP»)
  useEffect(() => {
    ruta.current = pathname
    poner('pagina')
  }, [pathname, poner])

  return null
}
