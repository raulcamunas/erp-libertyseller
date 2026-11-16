'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { fusionarPrimeraPagina, MIN_LARGO_DE_BUSQUEDA, type Cursor } from '@/lib/correo/bandeja'
import { esFaltaDe318 } from '@/lib/correo/preferencias'
import type { HiloDeLista, VistaDeCorreo } from '@/lib/correo/tipos'
import { pedir } from './api'

/**
 * LA LISTA DE CONVERSACIONES QUE SE VE (columna 2): un buzón suelto, «Mis correos» (la bandeja unificada) o «Asignados a mí».
 * ==========================================================================================================================
 * Solo PIDE y GUARDA: páginas, cursor, búsqueda (con su espera de 350 ms y el mínimo de 2 caracteres) y la anti-carrera (una respuesta lenta
 * que llega tarde no pisa a una más nueva). NO sincroniza buzones: eso lo hace useCorreo con el buzón abierto (spec 5: «sin sincronizar desde
 * la bandeja», quitado por carga). En «Mis correos» y «Asignados a mí», con `sondear`, cada 30 s vuelve a pedir SOLO la primera página y la
 * FUNDE por id con lo que ya hay (fusionarPrimeraPagina): lo ya cargado con el scroll se queda y las filas nuevas entran con su animación.
 * Al volver a la pestaña, una relectura.
 *
 *   · Un buzón:          GET /api/correo/hilos?buzon=&vista=&sinLeer=&q=&antes=          → { hilos, siguiente: string | null }
 *   · Mis correos / Asig: GET /api/correo/bandeja?carpeta=&vista=&sinLeer=&q=&antes=&antesId=&silenciados= → { hilos, siguiente: Cursor | null }
 *
 * Con búsqueda, la vista y «Sin leer» NO viajan: la lista los aplica sobre los resultados en el cliente (filtrarEnCliente), así cambiar de
 * filtro con una búsqueda puesta no vuelve a buscar. Sin búsqueda los aplica el servidor (si no, la paginación mentiría).
 *
 * Sin la migración 318 la bandeja contesta 503: `falta318` se pone a true y la pantalla cae a la vista por buzón.
 */

export type OrigenDeLista = { tipo: 'buzon'; buzonId: string } | { tipo: 'mios' } | { tipo: 'asignados' }

export interface FiltrosDeLista {
  vista: VistaDeCorreo
  soloNoLeidos: boolean
  /** La búsqueda YA aplicada (tras la espera). Con menos de 2 caracteres no cuenta */
  busqueda: string
  /** El chip «Ocultar silenciados» (solo en «Mis correos») */
  ocultarSilenciados: boolean
}

/** Cada cuánto se vuelve a pedir la primera página de «Mis correos» o «Asignados a mí» con «Auto» encendido */
export const SONDEO_DE_BANDEJA_MS = 30_000
/** La espera de la búsqueda antes de pedir */
export const ESPERA_DE_BUSQUEDA_MS = 350

/* ------------------------------------------------------------------ */
/* Puro (con prueba en integracion.prueba.ts)                          */
/* ------------------------------------------------------------------ */

/** ¿Cuenta la búsqueda? (2 caracteres o más, sin contar espacios de los lados) */
export const busquedaQueCuenta = (texto: string): string | null => {
  const q = texto.trim()
  return q.length >= MIN_LARGO_DE_BUSQUEDA ? q : null
}

/** La dirección que se pide para una página. `cursor` = la última fila de la página anterior (null = la primera) */
export function urlDeLista(origen: OrigenDeLista, f: FiltrosDeLista, cursor: Cursor | null): string {
  const q = busquedaQueCuenta(f.busqueda)
  const p = new URLSearchParams()
  if (origen.tipo === 'buzon') p.set('buzon', origen.buzonId)
  else p.set('carpeta', origen.tipo)
  // Con búsqueda, los filtros se aplican en el cliente sobre los resultados: no viajan (y la búsqueda no lleva cursor)
  p.set('vista', q ? 'todos' : f.vista)
  if (!q && f.soloNoLeidos) p.set('sinLeer', '1')
  if (q) p.set('q', q)
  if (origen.tipo === 'mios' && f.ocultarSilenciados) p.set('silenciados', '0')
  if (cursor && !q) {
    p.set('antes', cursor.antes)
    if (origen.tipo !== 'buzon' && cursor.antesId) p.set('antesId', cursor.antesId)
  }
  return `${origen.tipo === 'buzon' ? '/api/correo/hilos' : '/api/correo/bandeja'}?${p.toString()}`
}

/** El cursor de la página siguiente, venga como venga: la lista de un buzón da una fecha; la bandeja, { antes, antesId } */
export function cursorDeRespuesta(siguiente: unknown): Cursor | null {
  if (typeof siguiente === 'string' && siguiente) return { antes: siguiente, antesId: '' }
  if (siguiente && typeof siguiente === 'object') {
    const s = siguiente as { antes?: unknown; antesId?: unknown }
    if (typeof s.antes === 'string' && s.antes) return { antes: s.antes, antesId: typeof s.antesId === 'string' ? s.antesId : '' }
  }
  return null
}

/** Una clave que cambia cuando cambia LO QUE SE PIDE (no cuando cambia un filtro que, con búsqueda, se aplica en el cliente) */
export function claveDeConsulta(origen: OrigenDeLista | null, f: FiltrosDeLista): string {
  if (!origen) return ''
  return urlDeLista(origen, f, null)
}

/** Añade una página al final sin repetir ninguna fila que ya estuviera */
export function anadirPagina(previos: readonly HiloDeLista[], pagina: readonly HiloDeLista[]): HiloDeLista[] {
  const ya = new Set(previos.map((h) => h.id))
  return [...previos, ...pagina.filter((h) => !ya.has(h.id))]
}

/* ------------------------------------------------------------------ */
/* El gancho                                                           */
/* ------------------------------------------------------------------ */

export interface OpcionesDeBandeja extends Omit<FiltrosDeLista, 'busqueda'> {
  /** null = no se lista nada (el resumen del equipo, conectar…) */
  origen: OrigenDeLista | null
  /** Lo escrito en el buscador, tal cual: aquí se espera 350 ms */
  busqueda: string
  /** Volver a pedir la primera página cada 30 s («Auto» encendido, Correo a la vista). Solo en «Mis correos» y «Asignados a mí» */
  sondear: boolean
  /** Subirlo vuelve a cargar la lista desde cero (p. ej. tras cambiar qué buzones entran en «Mis correos») */
  version?: number
}

export interface ApiDeBandeja {
  hilos: HiloDeLista[]
  cargando: boolean
  cargandoMas: boolean
  hayMas: boolean
  error: string | null
  /** Las filas que acaban de llegar por el sondeo (entran con la animación) */
  nuevos: ReadonlySet<string>
  /** La bandeja ha contestado que falta la migración 318 */
  falta318: boolean
  /** La búsqueda que se está aplicando ya (tras la espera) */
  busquedaAplicada: string
  cargarMas: () => void
  /** Vuelve a pedir la primera página y la funde con lo que hay (no borra lo cargado con el scroll) */
  refrescar: () => Promise<void>
  /** Cambia una fila en pantalla sin pedir nada (lo optimista: leído, estrella, silencio, encargada) */
  cambiarHilo: (id: string, cambio: Partial<HiloDeLista>) => void
}

const SIN_NUEVOS: ReadonlySet<string> = new Set()

export function useBandeja({ origen, vista, soloNoLeidos, busqueda, ocultarSilenciados, sondear, version = 0 }: OpcionesDeBandeja): ApiDeBandeja {
  const [busquedaAplicada, setBusquedaAplicada] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setBusquedaAplicada(busqueda), ESPERA_DE_BUSQUEDA_MS)
    return () => clearTimeout(t)
  }, [busqueda])
  // Al borrar la búsqueda (o cambiar de carpeta, que la vacía), sin esperar
  useEffect(() => {
    if (busqueda === '') setBusquedaAplicada('')
  }, [busqueda])

  const filtros: FiltrosDeLista = { vista, soloNoLeidos, busqueda: busquedaAplicada, ocultarSilenciados }
  const clave = `${claveDeConsulta(origen, filtros)}#${version}`

  const [hilos, setHilos] = useState<HiloDeLista[]>([])
  const [siguiente, setSiguiente] = useState<Cursor | null>(null)
  const [cargando, setCargando] = useState(false)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nuevos, setNuevos] = useState<ReadonlySet<string>>(SIN_NUEVOS)
  const [falta318, setFalta318] = useState(false)

  // Lo último que se ha pedido: una respuesta lenta que llega tarde no pisa a una más reciente
  const generacion = useRef(0)
  const estado = useRef({ hilos, siguiente, origen, filtros, clave })
  estado.current = { hilos, siguiente, origen, filtros, clave }

  // Lo que cambia la consulta: se empieza de cero
  useEffect(() => {
    const g = ++generacion.current
    setHilos([])
    setSiguiente(null)
    setNuevos(SIN_NUEVOS)
    setError(null)
    setCargandoMas(false)
    const { origen: o, filtros: f } = estado.current
    if (!o) {
      setCargando(false)
      return
    }
    setCargando(true)
    // Cada vez que se vuelve a la bandeja se pregunta de nuevo: si la 318 vuelve a faltar, falta318 pasa otra vez a true y la pantalla se entera
    if (o.tipo !== 'buzon') setFalta318(false)
    void pedir<{ hilos: HiloDeLista[]; siguiente: unknown }>(urlDeLista(o, f, null)).then((r) => {
      if (g !== generacion.current) return
      setCargando(false)
      if (!r.ok) {
        if (o.tipo !== 'buzon' && esFaltaDe318(r)) setFalta318(true)
        setError(r.mensaje)
        return
      }
      if (o.tipo !== 'buzon') setFalta318(false)
      setHilos(r.datos.hilos ?? [])
      setSiguiente(cursorDeRespuesta(r.datos.siguiente))
    })
  }, [clave])

  const cargarMas = useCallback(() => {
    const { origen: o, filtros: f, siguiente: s, clave: c } = estado.current
    if (!o || !s || busquedaQueCuenta(f.busqueda)) return
    const g = ++generacion.current
    setCargandoMas(true)
    void pedir<{ hilos: HiloDeLista[]; siguiente: unknown }>(urlDeLista(o, f, s)).then((r) => {
      if (g !== generacion.current || estado.current.clave !== c) return
      setCargandoMas(false)
      if (!r.ok) {
        setError(r.mensaje)
        return
      }
      setHilos((previos) => anadirPagina(previos, r.datos.hilos ?? []))
      setSiguiente(cursorDeRespuesta(r.datos.siguiente))
    })
  }, [])

  const refrescar = useCallback(async () => {
    const { origen: o, filtros: f, clave: c } = estado.current
    if (!o) return
    const g = ++generacion.current
    const r = await pedir<{ hilos: HiloDeLista[]; siguiente: unknown }>(urlDeLista(o, f, null))
    // Si mientras tanto se ha pedido otra cosa (otra carpeta, una página más), esta lectura ya no vale
    if (g !== generacion.current || estado.current.clave !== c) return
    setCargando(false)
    setCargandoMas(false)
    if (!r.ok) {
      if (o.tipo !== 'buzon' && esFaltaDe318(r)) setFalta318(true)
      return
    }
    // Con búsqueda no hay páginas: se sustituye
    if (busquedaQueCuenta(f.busqueda)) {
      setHilos(r.datos.hilos ?? [])
      setSiguiente(null)
      return
    }
    const fundido = fusionarPrimeraPagina(
      { hilos: estado.current.hilos, siguiente: estado.current.siguiente },
      { hilos: r.datos.hilos ?? [], siguiente: cursorDeRespuesta(r.datos.siguiente) },
    )
    setError(null)
    setHilos(fundido.hilos)
    setSiguiente(fundido.siguiente)
    if (fundido.nuevas.length > 0) setNuevos(new Set(fundido.nuevas))
  }, [])

  const cambiarHilo = useCallback((id: string, cambio: Partial<HiloDeLista>) => {
    setHilos((previos) => {
      let cambiado = false
      const nuevos = previos.map((h) => {
        if (h.id !== id) return h
        cambiado = true
        return { ...h, ...cambio }
      })
      return cambiado ? nuevos : previos
    })
  }, [])

  // El sondeo de «Mis correos» y «Asignados a mí» (un buzón suelto se refresca tras sincronizarlo, desde useCorreo)
  const sondeable = sondear && !!origen && origen.tipo !== 'buzon'
  useEffect(() => {
    if (!sondeable) return
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void refrescar()
    }, SONDEO_DE_BANDEJA_MS)
    const alVolver = () => {
      if (document.visibilityState === 'visible') void refrescar()
    }
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [sondeable, refrescar])

  // Las filas «nuevas» solo se animan una vez
  useEffect(() => {
    if (nuevos.size === 0) return
    const t = setTimeout(() => setNuevos(SIN_NUEVOS), 1600)
    return () => clearTimeout(t)
  }, [nuevos])

  return { hilos, cargando, cargandoMas, hayMas: siguiente !== null, error, nuevos, falta318, busquedaAplicada, cargarMas, refrescar, cambiarHilo }
}
