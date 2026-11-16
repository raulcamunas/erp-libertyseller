'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { leerRespuesta } from './errores'

/**
 * LO QUE LA PANTALLA PIDE A LAS RUTAS NUEVAS DE REMESAS, CON MEMORIA DE 5 MINUTOS (spec remesas-pro §11 D25).
 *
 * La página sigue sirviendo el panel del cliente (y sus 24 `router.refresh()`); el plan, las ventas, los lotes, el
 * resumen y los envíos propuestos se piden desde el navegador. Para no pedir lo mismo cada vez que se cambia de
 * pestaña, cada URL se guarda 5 minutos en memoria del proceso del navegador (no en localStorage: se va al recargar).
 *
 * API
 *   useAgencia<T>(url | null, { que? })
 *     → { datos: T | null, cargando, error, estado, actualizadoEn, recargar(opciones?) }
 *     · url null = no se pide nada (la sección no está abierta).
 *     · Con datos en memoria de menos de 5 min, salen al instante y no se pide nada.
 *     · Mientras se vuelve a pedir, se siguen enseñando los datos de antes (sin parpadeo).
 *     · recargar({ servidor: true }) añade `refrescar=1` (salta también la memoria de 3 min del servidor).
 *   invalidarRemesas(clienteId?)
 *     Vacía la memoria tras CUALQUIER escritura (PATCH, convertir, POST del plan, crear, aprobar o enviar una remesa):
 *     las entradas de ese cliente y las de todos (resumen, plan de todos, envíos sin cliente). Sin cliente, todo.
 *     Los `useAgencia` montados cuya entrada se ha borrado se vuelven a pedir solos. Se llama JUNTO al
 *     `router.refresh()` de siempre (que refresca el panel que sirve la página); nunca hace `router.push`.
 *   pedirAgencia<T>(url, { que?, forzar? })   la misma memoria fuera de React (para precargar)
 *   MEMORIA_MS, leerDeMemoria(url, ahora?), guardarEnMemoria(url, datos, ahora?), claveAfecta(url, clienteId)   (puro, con prueba)
 */

export const MEMORIA_MS = 5 * 60_000

interface Entrada {
  datos: unknown
  en: number
}

const memoria = new Map<string, Entrada>()
const enCurso = new Map<string, Promise<unknown>>()
const oyentes = new Set<() => void>()

export function leerDeMemoria<T>(url: string, ahora: number = Date.now()): { datos: T; en: number } | null {
  const e = memoria.get(url)
  if (!e) return null
  if (ahora - e.en > MEMORIA_MS) {
    memoria.delete(url)
    return null
  }
  return { datos: e.datos as T, en: e.en }
}

export function guardarEnMemoria(url: string, datos: unknown, ahora: number = Date.now()): void {
  memoria.set(url, { datos, en: ahora })
}

/** Los ids de cliente que lleva una URL (`cliente=`, `clienteId=`). Vacío = es de todos los clientes */
function clientesDeUrl(url: string): string[] {
  const q = url.includes('?') ? url.slice(url.indexOf('?') + 1) : ''
  const p = new URLSearchParams(q)
  return [p.get('cliente'), p.get('clienteId')].filter((x): x is string => !!x)
}

/** ¿Hay que olvidar esta URL tras escribir en `clienteId`? Las de ese cliente y las que no son de ninguno (globales) */
export function claveAfecta(url: string, clienteId: string | null | undefined): boolean {
  if (!clienteId) return true
  const de = clientesDeUrl(url)
  return de.length === 0 || de.includes(clienteId)
}

export function invalidarRemesas(clienteId?: string | null): void {
  for (const url of [...memoria.keys()]) if (claveAfecta(url, clienteId)) memoria.delete(url)
  for (const url of [...enCurso.keys()]) if (claveAfecta(url, clienteId)) enCurso.delete(url)
  for (const avisar of [...oyentes]) avisar()
}

class ErrorDeAgencia extends Error {
  constructor(mensaje: string, readonly estado: number) {
    super(mensaje)
  }
}

const conRefrescar = (url: string) => `${url}${url.includes('?') ? '&' : '?'}refrescar=1`

/** Pide una URL de las rutas de Remesas con la memoria compartida. Lanza un Error con el texto para la pantalla */
export async function pedirAgencia<T>(url: string, opciones: { que?: string; forzar?: boolean; servidor?: boolean } = {}): Promise<T> {
  if (!opciones.forzar && !opciones.servidor) {
    const m = leerDeMemoria<T>(url)
    if (m) return m.datos
    const ya = enCurso.get(url)
    if (ya) return ya as Promise<T>
  }
  const promesa = (async () => {
    let res: Response
    try {
      res = await fetch(opciones.servidor ? conRefrescar(url) : url, { cache: 'no-store' })
    } catch {
      throw new ErrorDeAgencia('No hay conexión con el servidor: comprueba la red y vuelve a probar.', 0)
    }
    const r = await leerRespuesta<T>(res, opciones.que ?? 'No se han podido leer los datos')
    if (!r.ok) throw new ErrorDeAgencia(r.error, r.estado)
    guardarEnMemoria(url, r.datos)
    return r.datos
  })()
  enCurso.set(url, promesa)
  try {
    return await promesa
  } finally {
    if (enCurso.get(url) === promesa) enCurso.delete(url)
  }
}

export interface EstadoAgencia<T> {
  datos: T | null
  cargando: boolean
  error: string | null
  /** Código HTTP del último error (403, 409 por migración…); null si no hubo */
  estado: number | null
  /** Cuándo se trajeron los datos que se enseñan (ms) */
  actualizadoEn: number | null
  recargar: (opciones?: { servidor?: boolean }) => Promise<void>
}

export function useAgencia<T>(url: string | null, opciones: { que?: string } = {}): EstadoAgencia<T> {
  const inicial = url ? leerDeMemoria<T>(url) : null
  const [datos, setDatos] = useState<T | null>(inicial?.datos ?? null)
  const [actualizadoEn, setActualizadoEn] = useState<number | null>(inicial?.en ?? null)
  const [cargando, setCargando] = useState<boolean>(url !== null && inicial === null)
  const [error, setError] = useState<string | null>(null)
  const [estado, setEstado] = useState<number | null>(null)
  const urlActual = useRef(url)
  urlActual.current = url
  const que = opciones.que

  const traer = useCallback(
    async (forzar: boolean, servidor = false) => {
      const pedida = urlActual.current
      if (!pedida) return
      if (!forzar) {
        const m = leerDeMemoria<T>(pedida)
        if (m) {
          setDatos(m.datos)
          setActualizadoEn(m.en)
          setCargando(false)
          setError(null)
          setEstado(null)
          return
        }
      }
      setCargando(true)
      try {
        const d = await pedirAgencia<T>(pedida, { que, forzar, servidor })
        if (urlActual.current !== pedida) return
        setDatos(d)
        setActualizadoEn(leerDeMemoria(pedida)?.en ?? Date.now())
        setError(null)
        setEstado(null)
      } catch (e) {
        if (urlActual.current !== pedida) return
        setError(e instanceof Error ? e.message : 'No se han podido leer los datos')
        setEstado(e instanceof ErrorDeAgencia ? e.estado : null)
      } finally {
        if (urlActual.current === pedida) setCargando(false)
      }
    },
    [que]
  )

  // Cambia la URL: lo que haya en memoria al instante; si no, se pide (los datos de antes se quedan mientras tanto
  // solo si eran de la misma URL: los de otro cliente no se enseñan nunca como si fueran de este)
  useEffect(() => {
    if (!url) {
      setCargando(false)
      return
    }
    const m = leerDeMemoria<T>(url)
    if (!m) {
      setDatos(null)
      setActualizadoEn(null)
    }
    void traer(false)
  }, [url, traer])

  // Tras invalidarRemesas: si mi entrada ya no está, se vuelve a pedir
  useEffect(() => {
    const oyente = () => {
      const u = urlActual.current
      if (u && !memoria.has(u)) void traer(false)
    }
    oyentes.add(oyente)
    return () => {
      oyentes.delete(oyente)
    }
  }, [traer])

  const recargar = useCallback((o?: { servidor?: boolean }) => traer(true, o?.servidor === true), [traer])

  return { datos, cargando, error, estado, actualizadoEn, recargar }
}
