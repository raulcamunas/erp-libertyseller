'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { diaCorto, diaDeMadrid, diaRelativo, horaDeMadrid } from '@/lib/correo/secuencias/fechas'
import type { TableroDeSecuencias } from '@/lib/correo/secuencias/servidor'
import type { DetalleDeSecuencia, GrupoDeColaCliente, ItemDeCola } from '@/lib/correo/secuencias/vistas'
import { enviarJson, pedir } from '../api'

/**
 * LOS DATOS DE LA PANTALLA DE SECUENCIAS — NAVEGADOR.
 *
 * Todo viene de las rutas de /api/correo/secuencias, que deciden qué ve cada persona. Aquí solo se piden, se refrescan solos mientras la pantalla se ve
 * (cada 20 s el tablero, cada 30 s la cola, cada 15 s el detalle abierto) y se dan a los componentes. Un refresco lento que llega tarde no pisa a uno
 * más reciente (`generacion`).
 */

/** Lo que el servidor añade al tablero de la DEMOSTRACIÓN: el día hábil de «hoy» en ella, cuántos se ha avanzado el reloj y hasta cuántos se puede */
export interface InfoDeLaDemo {
  dia: string
  dias: number
  maximo: number
}

export type Tablero = Extract<TableroDeSecuencias, { disponible: true }> & { demo?: InfoDeLaDemo }

/**
 * ¿LA PANTALLA ESTÁ ENSEÑANDO LA DEMOSTRACIÓN? `null` = lo de verdad; un número = la demostración con el reloj avanzado esos días hábiles. Lo pone PantallaDeSecuencias y lo leen los hooks de
 * abajo, que piden lo mismo a las mismas rutas con `?demo=1&dias=N` (gente inventada, nada de la base: lib/correo/secuencias/demo.ts). Así ningún componente tiene que enterarse.
 */
export const DemoContext = createContext<number | null>(null)
export const useDemo = (): number | null => useContext(DemoContext)

/** La dirección con lo de la demostración añadido, si toca */
export const conDemo = (url: string, demo: number | null): string => (demo === null ? url : `${url}${url.includes('?') ? '&' : '?'}demo=1&dias=${demo}`)

/* ------------------------------------------------------------------ */
/* El tiempo                                                           */
/* ------------------------------------------------------------------ */

/** Vuelve a pintar cada `cadaMs`: es lo que mueve la raya de «ahora» y las cuentas atrás */
export function useAhora(cadaMs = 15_000): number {
  const [ahora, setAhora] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), cadaMs)
    return () => clearInterval(t)
  }, [cadaMs])
  return ahora
}

/**
 * Ejecuta `cargar` ya y cada `cadaMs` mientras la pestaña se ve; al volver a ella, otra vez. Si cambia `clave` (el filtro con el que se pide) vuelve a
 * empezar: pide al momento en vez de esperar al siguiente latido con los datos del filtro anterior.
 */
export function usePulso(cargar: () => Promise<void>, cadaMs: number, activo = true, clave = ''): void {
  const guardada = useRef(cargar)
  guardada.current = cargar
  useEffect(() => {
    if (!activo) return
    let vivo = true
    const lanzar = () => {
      if (vivo && document.visibilityState === 'visible') void guardada.current()
    }
    lanzar()
    const reloj = setInterval(lanzar, cadaMs)
    document.addEventListener('visibilitychange', lanzar)
    return () => {
      vivo = false
      clearInterval(reloj)
      document.removeEventListener('visibilitychange', lanzar)
    }
  }, [cadaMs, activo, clave])
}

/** «hoy 10:42», «mañana 10:42», «mié 4 nov 10:42» */
export function cuando(ms: number, ahora: number): string {
  const dia = diaDeMadrid(ms)
  const rel = diaRelativo(dia, ahora)
  return `${rel === diaCorto(dia) ? diaCorto(dia) : rel} ${horaDeMadrid(ms)}`
}

/** «en 5 min», «en 2 h», «en 3 días»; «ya» si ya ha pasado */
export function cuentaAtras(ms: number, ahora: number): string {
  const s = Math.round((ms - ahora) / 1000)
  if (s <= 30) return 'ya'
  if (s < 3600) return `en ${Math.max(1, Math.round(s / 60))} min`
  if (s < 86_400) return `en ${Math.round(s / 3600)} h`
  const d = Math.round(s / 86_400)
  return `en ${d} ${d === 1 ? 'día' : 'días'}`
}

/**
 * Qué correos acaban de salir desde la última vez que se miró (pasaron de «no enviado» a «enviado»): la pantalla les hace un destello durante unos
 * segundos. La primera vez que se ven no cuentan: solo lo que cambia mientras se está mirando.
 */
export function useRecien(vistos: ReadonlyArray<{ id: string; enviado: boolean }>): ReadonlySet<string> {
  const previos = useRef<Map<string, boolean> | null>(null)
  const [recien, setRecien] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    const ahora = new Map(vistos.map((v) => [v.id, v.enviado]))
    const antes = previos.current
    previos.current = ahora
    if (!antes) return
    const nuevos = vistos.filter((v) => v.enviado && antes.get(v.id) === false).map((v) => v.id)
    if (nuevos.length === 0) return
    setRecien(new Set(nuevos))
    const t = setTimeout(() => setRecien(new Set()), 4000)
    return () => clearTimeout(t)
  }, [vistos])
  return recien
}

/* ------------------------------------------------------------------ */
/* El tablero                                                          */
/* ------------------------------------------------------------------ */

export interface EstadoDelTablero {
  tablero: Tablero | null
  /** La migración 245 sin lanzar: el aviso que hay que enseñar */
  falta: string | null
  error: string | null
  cargando: boolean
  /** Lo que el reloj del servidor se adelanta al del navegador, para pintar «ahora» con el del servidor */
  desfase: number
}

export function useTablero(buzonId: string | null, activo: boolean): EstadoDelTablero & { recargar: () => Promise<void> } {
  const demo = useDemo()
  const [estado, setEstado] = useState<EstadoDelTablero>({ tablero: null, falta: null, error: null, cargando: true, desfase: 0 })
  const generacion = useRef(0)
  // Al entrar o salir de la demostración lo de antes ya no vale (otros buzones, otras secuencias): se empieza de cero
  const demoAnterior = useRef(demo === null ? 'real' : 'demo')
  useEffect(() => {
    const ahora = demo === null ? 'real' : 'demo'
    if (demoAnterior.current === ahora) return
    demoAnterior.current = ahora
    generacion.current++
    setEstado({ tablero: null, falta: null, error: null, cargando: true, desfase: 0 })
  }, [demo])
  const cargar = useCallback(async () => {
    const mia = ++generacion.current
    const r = await pedir<TableroDeSecuencias>(conDemo(`/api/correo/secuencias/tablero${buzonId ? `?buzonId=${buzonId}` : ''}`, demo))
    if (mia !== generacion.current) return
    if (!r.ok) return setEstado((e) => ({ ...e, error: r.mensaje, falta: r.estado === 503 ? r.mensaje : e.falta, cargando: false }))
    const d = r.datos
    if (!d.disponible) return setEstado({ tablero: null, falta: d.mensaje, error: null, cargando: false, desfase: 0 })
    setEstado({ tablero: d, falta: null, error: null, cargando: false, desfase: d.ahora - Date.now() })
  }, [buzonId, demo])
  usePulso(cargar, 20_000, activo, `${buzonId ?? ''}|${demo ?? 'real'}`)
  return { ...estado, recargar: cargar }
}

/* ------------------------------------------------------------------ */
/* La cola                                                             */
/* ------------------------------------------------------------------ */

const POR_PAGINA = 40

export interface FiltroDeCola {
  grupo: GrupoDeColaCliente
  buzonId: string | null
  q: string
}

export function useCola(filtro: FiltroDeCola, activo: boolean) {
  const demo = useDemo()
  const [items, setItems] = useState<ItemDeCola[]>([])
  const [total, setTotal] = useState(0)
  const [paginas, setPaginas] = useState(1)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const generacion = useRef(0)
  const paginasRef = useRef(1)
  paginasRef.current = paginas

  // Al entrar o salir de la demostración la lista de antes no vale para nada: se vacía
  const demoAnterior = useRef(demo === null ? 'real' : 'demo')
  useEffect(() => {
    const ahora = demo === null ? 'real' : 'demo'
    if (demoAnterior.current === ahora) return
    demoAnterior.current = ahora
    setItems([])
    setTotal(0)
    setCargando(true)
  }, [demo])

  const clave = `${filtro.grupo}|${filtro.buzonId ?? ''}|${filtro.q}|${demo ?? 'real'}`
  const claveAnterior = useRef(clave)
  useEffect(() => {
    if (claveAnterior.current !== clave) {
      claveAnterior.current = clave
      paginasRef.current = 1
      setPaginas(1)
      setCargando(true)
    }
  }, [clave])

  const cargar = useCallback(async () => {
    const mia = ++generacion.current
    const juntos: ItemDeCola[] = []
    let totalVisto = 0
    for (let p = 0; p < paginasRef.current; p++) {
      const params = new URLSearchParams({ grupo: filtro.grupo, pagina: String(p), limite: String(POR_PAGINA) })
      if (filtro.buzonId) params.set('buzonId', filtro.buzonId)
      if (filtro.q.trim().length >= 2) params.set('q', filtro.q.trim())
      const r = await pedir<{ items: ItemDeCola[]; total: number }>(conDemo(`/api/correo/secuencias/cola?${params}`, demo))
      if (mia !== generacion.current) return
      if (!r.ok) {
        setError(r.mensaje)
        setCargando(false)
        return
      }
      juntos.push(...r.datos.items)
      totalVisto = r.datos.total
      if (r.datos.items.length < POR_PAGINA) break
    }
    setItems(juntos)
    setTotal(totalVisto)
    setError(null)
    setCargando(false)
  }, [filtro.grupo, filtro.buzonId, filtro.q, demo])

  usePulso(cargar, 30_000, activo, clave)
  // Pedir otra página trae la cola entera de nuevo con una página más (solo cuando cambia el número de páginas, no el filtro)
  useEffect(() => {
    if (paginas > 1) void cargar()
  }, [paginas]) // eslint-disable-line react-hooks/exhaustive-deps

  return { items, total, cargando, error, hayMas: items.length < total, masPaginas: () => setPaginas((p) => p + 1), recargar: cargar }
}

/* ------------------------------------------------------------------ */
/* El detalle y las acciones                                           */
/* ------------------------------------------------------------------ */

export function useDetalle(id: string | null) {
  const demo = useDemo()
  const [detalle, setDetalle] = useState<DetalleDeSecuencia | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const generacion = useRef(0)

  const cargar = useCallback(async () => {
    if (!id) return
    const mia = ++generacion.current
    const r = await pedir<DetalleDeSecuencia>(conDemo(`/api/correo/secuencias/${id}`, demo))
    if (mia !== generacion.current) return
    setCargando(false)
    if (!r.ok) return setError(r.mensaje)
    setError(null)
    setDetalle(r.datos)
  }, [id, demo])

  useEffect(() => {
    setDetalle(null)
    setError(null)
    setCargando(Boolean(id))
  }, [id])
  usePulso(cargar, 15_000, Boolean(id), `${id ?? ''}|${demo ?? 'real'}`)
  return { detalle, error, cargando, recargar: cargar }
}

export type CuerpoDeAccion =
  | { accion: 'pausar' | 'reanudar' | 'cancelar' }
  | { accion: 'saltar' | 'reintentar' | 'adelantar'; pasoId: string }
  | { accion: 'editar'; pasoId: string; asunto?: string; texto?: string }

export async function accionar(id: string, cuerpo: CuerpoDeAccion, demo: number | null = null): Promise<{ ok: true; mensaje: string } | { ok: false; mensaje: string }> {
  const r = await enviarJson<{ mensaje?: string }>(conDemo(`/api/correo/secuencias/${id}`, demo), 'POST', cuerpo)
  return r.ok ? { ok: true, mensaje: r.datos.mensaje ?? 'Hecho.' } : { ok: false, mensaje: r.mensaje }
}
