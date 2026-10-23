'use client'

import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { enviarLote, etiquetaDeControl, idDeSesion, SELECTOR_DE_CONTROL, SELECTOR_DE_TABLA, SELECTOR_SIN_REGISTRO } from '@/lib/actividad/cliente'
import { estadoDeInactividad } from '@/lib/actividad/inactividad'
import type { TipoDeEvento } from '@/lib/actividad/ingesta'
import { createClient } from '@/lib/supabase/client'
import { AvisoDeInactividad } from './AvisoDeInactividad'

/**
 * EL OJO DE FONDO: apunta cuándo está una persona en el ERP y qué hace, sin que se note, y le cierra la sesión si se
 * queda parada. Solo pinta algo en el último caso, el aviso de un minuto antes.
 *
 * Solo se monta para los empleados (app/dashboard/layout.tsx). Manda a /api/actividad, cada medio minuto y al salir de la
 * pestaña: cuándo abre el ERP, qué pantallas pisa, qué botones pulsa (por su nombre, nunca por lo que contienen) y un
 * «sigo aquí» por minuto SOLO si ha tocado algo en los últimos dos minutos y la pestaña está a la vista. No lee lo que
 * escribe, ni contraseñas, ni mira nada fuera del ERP. Lo lee quien supervisa en /dashboard/actividad.
 *
 * EL CIERRE POR INACTIVIDAD (lib/actividad/inactividad.ts): si pasan `limiteMin` minutos sin tocar ratón ni teclado en
 * NINGUNA pestaña del ERP, se cierra la sesión y se vuelve al inicio de sesión. Un minuto antes sale un aviso. Se mira la
 * hora de verdad en cada comprobación, así que un portátil que durmió una hora lo cierra al despertar, y el primer toque
 * después de pasar el tiempo NO revive la sesión: la cierra. Un audio sonando (una grabación de Rinkel) cuenta como estar
 * presente.
 *
 * LO QUE LO HACE LIGERO: escuchas pasivas, un lote cada 30 s, un máximo de 200 eventos en cola y una comprobación por
 * segundo. Si algo falla, se calla: registrar nunca puede romper ni frenar lo que la persona está haciendo.
 */

const CADA_CUANTO_MANDAR_MS = 30_000
const CADA_CUANTO_LATIR_MS = 60_000
/** Sin tocar nada durante este tiempo, el «sigo aquí» deja de salir */
const SIN_TOCAR_NADA_MS = 120_000
const MAX_PENDIENTES = 200
const EVENTOS_POR_PETICION = 50
/** El mismo clic en el mismo sitio dentro de este margen es uno solo (un doble clic, un botón que rebota) */
const REPETIDO_MS = 1_500
/** El último toque se comparte entre las pestañas por localStorage: si trabaja en una, la otra no se cierra */
const CLAVE_ULTIMO_TOQUE = 'actividad:ultimo-toque'
/** Cuando una pestaña cierra la sesión, avisa a las demás por aquí */
const CLAVE_CIERRE = 'actividad:cierre'
const GUARDAR_TOQUE_CADA_MS = 5_000

interface Pendiente {
  t: TipoDeEvento
  ruta: string
  detalle: string | null
  ts: number
}

export function RegistroDeActividad({ limiteMin }: { limiteMin: number }) {
  const pathname = usePathname() ?? '/'
  const ruta = useRef(pathname)
  const pendientes = useRef<Pendiente[]>([])
  const sesion = useRef<string | null>(null)
  const ultimaInteraccion = useRef(0)
  const cerrando = useRef(false)
  const avisoVisible = useRef(false)
  const [aviso, setAviso] = useState<number | null>(null)

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
    if (nueva) poner('sesion')

    /* ---- El último toque, compartido entre pestañas ---- */
    let ultimoGuardado = 0
    const guardarToque = (t: number, forzar = false) => {
      if (!forzar && t - ultimoGuardado < GUARDAR_TOQUE_CADA_MS) return
      ultimoGuardado = t
      try {
        window.localStorage.setItem(CLAVE_ULTIMO_TOQUE, String(t))
      } catch {
        // sin almacenamiento: vale con el de esta pestaña
      }
    }
    const ultimoToque = () => {
      let compartido = 0
      try {
        compartido = Number(window.localStorage.getItem(CLAVE_ULTIMO_TOQUE)) || 0
      } catch {
        // idem
      }
      return Math.max(ultimaInteraccion.current, compartido)
    }
    // Abrir o recargar el ERP es haber hecho algo: ahí empieza la cuenta
    ultimaInteraccion.current = Date.now()
    guardarToque(ultimaInteraccion.current, true)

    /* ---- El cierre por inactividad ---- */
    const cerrar = async () => {
      if (cerrando.current) return
      cerrando.current = true
      avisoVisible.current = false
      setAviso(null)
      vaciar(true)
      try {
        window.localStorage.setItem(CLAVE_CIERRE, String(Date.now()))
      } catch {
        // idem
      }
      try {
        await createClient().auth.signOut({ scope: 'local' })
      } catch {
        // la ruta de abajo también la cierra
      }
      window.location.assign('/auth/inactividad')
    }
    const hayAudioSonando = () => {
      try {
        return Array.from(document.querySelectorAll('audio, video')).some((m) => !(m as HTMLMediaElement).paused && !(m as HTMLMediaElement).ended)
      } catch {
        return false
      }
    }
    const revisar = () => {
      if (cerrando.current) return
      // Una grabación sonando es alguien escuchando: no se le cierra a mitad
      if (hayAudioSonando()) {
        const ahora = Date.now()
        ultimaInteraccion.current = ahora
        guardarToque(ahora)
      }
      const estado = estadoDeInactividad(Date.now(), ultimoToque(), limiteMin)
      if (estado.fase === 'cerrar') {
        void cerrar()
      } else if (estado.fase === 'aviso') {
        avisoVisible.current = true
        setAviso(estado.segundos)
      } else if (avisoVisible.current) {
        avisoVisible.current = false
        setAviso(null)
      }
    }

    const latir = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - ultimaInteraccion.current > SIN_TOCAR_NADA_MS) return
      poner('latido')
    }
    // El primer minuto cuenta (abrir una pantalla es haber hecho algo)
    latir()

    const tocar = () => {
      const ahora = Date.now()
      // Si ya había pasado el tiempo (el ordenador dormía, se fue a comer), este toque NO revive la sesión: se cierra
      if (estadoDeInactividad(ahora, ultimoToque(), limiteMin).fase === 'cerrar') {
        void cerrar()
        return
      }
      ultimaInteraccion.current = ahora
      guardarToque(ahora)
      if (avisoVisible.current) {
        avisoVisible.current = false
        setAviso(null)
      }
    }
    let ultimoMovimiento = 0
    const mover = () => {
      const ahora = Date.now()
      if (ahora - ultimoMovimiento < 5_000) return
      ultimoMovimiento = ahora
      tocar()
    }

    let ultimoClic = { etiqueta: '', ruta: '', ts: 0 }
    const alPulsar = (e: MouseEvent) => {
      try {
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
        // Volver a la pestaña NO cuenta como actividad (se pudo estar fuera una hora): primero se mira si toca cerrar
        revisar()
        if (!cerrando.current) {
          poner('visible')
          latir()
        }
      }
    }
    const alIrse = () => vaciar(true)
    const alCambiarAlmacen = (e: StorageEvent) => {
      // Otra pestaña ha cerrado la sesión: esta se va con ella
      if (e.key === CLAVE_CIERRE && e.newValue && !cerrando.current) {
        cerrando.current = true
        window.location.assign('/auth/inactividad')
      }
    }

    const opciones = { passive: true, capture: true } as const
    document.addEventListener('pointerdown', tocar, opciones)
    document.addEventListener('keydown', tocar, opciones)
    document.addEventListener('wheel', tocar, opciones)
    document.addEventListener('touchstart', tocar, opciones)
    document.addEventListener('pointermove', mover, opciones)
    document.addEventListener('click', alPulsar, true)
    document.addEventListener('visibilitychange', alCambiarVisibilidad)
    window.addEventListener('pagehide', alIrse)
    window.addEventListener('storage', alCambiarAlmacen)

    const reloj = window.setInterval(latir, CADA_CUANTO_LATIR_MS)
    const envio = window.setInterval(() => vaciar(false), CADA_CUANTO_MANDAR_MS)
    const comprobacion = window.setInterval(revisar, 1_000)

    return () => {
      document.removeEventListener('pointerdown', tocar, opciones)
      document.removeEventListener('keydown', tocar, opciones)
      document.removeEventListener('wheel', tocar, opciones)
      document.removeEventListener('touchstart', tocar, opciones)
      document.removeEventListener('pointermove', mover, opciones)
      document.removeEventListener('click', alPulsar, true)
      document.removeEventListener('visibilitychange', alCambiarVisibilidad)
      window.removeEventListener('pagehide', alIrse)
      window.removeEventListener('storage', alCambiarAlmacen)
      window.clearInterval(reloj)
      window.clearInterval(envio)
      window.clearInterval(comprobacion)
      vaciar(true)
    }
  }, [poner, vaciar, limiteMin])

  // La pantalla cambia (también la primera vez, justo después de «ha abierto el ERP»)
  useEffect(() => {
    ruta.current = pathname
    poner('pagina')
  }, [pathname, poner])

  return aviso !== null ? <AvisoDeInactividad segundos={aviso} minutos={Math.max(1, Math.round(limiteMin - aviso / 60))} /> : null
}
