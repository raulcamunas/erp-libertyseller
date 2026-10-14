'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { construirIndice, type IndiceCatalogo } from '@/lib/fba/catalogo/indice'
import type { DatosFila, FilaCatalogo } from '@/lib/fba/catalogo/tipos'

/**
 * LA BASE DE DATOS DE REFERENCIAS, EN EL NAVEGADOR.
 *
 * Una sola copia por cliente, compartida por todo lo que la usa: la pantalla de la
 * base de datos, los desplegables de la propuesta que se está montando y el diálogo
 * para añadir una referencia. Cuando uno la cambia, los demás se enteran sin
 * recargar nada —se da de alta una talla desde el desplegable y está en la lista
 * del siguiente campo al instante—.
 *
 * Son unos cientos de filas (418 las de ShoesF), así que se traen enteras y se
 * filtra en el navegador. Si algún día fueran decenas de miles, esto es lo primero
 * que habría que cambiar.
 *
 * Es un almacén de módulo y no un contexto de React a propósito: la propuesta vive
 * en un diálogo y la base de datos en otra pantalla, y no comparten ningún padre.
 */

export interface EstadoCatalogo {
  /** null = todavía no ha llegado */
  filas: FilaCatalogo[] | null
  indice: IndiceCatalogo
  cargando: boolean
  error: string | null
  /** La migración 226 no está lanzada: la tabla no existe */
  sinMigrar: boolean
  puedeEditar: boolean
  puedeBorrar: boolean
  /** Cuándo llegó, para releerla si lleva rato */
  cargadoAt: number
}

const INDICE_VACIO = construirIndice([])
const INICIAL: EstadoCatalogo = {
  filas: null,
  indice: INDICE_VACIO,
  cargando: false,
  error: null,
  sinMigrar: false,
  puedeEditar: false,
  puedeBorrar: false,
  cargadoAt: 0,
}

const tiendas = new Map<string, EstadoCatalogo>()
const oyentes = new Set<() => void>()
const enCurso = new Map<string, Promise<void>>()

/** Pasado este tiempo, al montar algo que la usa se vuelve a pedir sin esperar a nadie */
const CADUCA_A_LOS_MS = 45_000

function fijar(clienteId: string, cambios: Partial<EstadoCatalogo>) {
  const previo = tiendas.get(clienteId) ?? INICIAL
  const siguiente = { ...previo, ...cambios }
  // El índice solo se rehace si cambiaron las filas
  if (cambios.filas !== undefined) siguiente.indice = construirIndice(cambios.filas ?? [])
  tiendas.set(clienteId, siguiente)
  oyentes.forEach((f) => f())
}

function suscribir(f: () => void) {
  oyentes.add(f)
  return () => {
    oyentes.delete(f)
  }
}

/** Pide la lista al servidor. Varias llamadas a la vez comparten la misma petición */
export function cargarCatalogo(clienteId: string, forzar = false): Promise<void> {
  const previo = tiendas.get(clienteId)
  if (!forzar && previo?.filas && Date.now() - previo.cargadoAt < CADUCA_A_LOS_MS) return Promise.resolve()

  const ya = enCurso.get(clienteId)
  if (ya) return ya

  fijar(clienteId, { cargando: true, error: null })
  const peticion = (async () => {
    try {
      const res = await fetch(`/api/fba/catalogo?cliente=${clienteId}`, { cache: 'no-store' })
      const p = (await res.json().catch(() => null)) as {
        filas?: FilaCatalogo[]
        sinMigrar?: boolean
        puedeEditar?: boolean
        puedeBorrar?: boolean
        error?: string
      } | null
      if (!res.ok || !p) {
        fijar(clienteId, { cargando: false, error: p?.error ?? 'No se ha podido leer la base de datos de referencias' })
        return
      }
      fijar(clienteId, {
        filas: p.filas ?? [],
        sinMigrar: !!p.sinMigrar,
        puedeEditar: !!p.puedeEditar,
        puedeBorrar: !!p.puedeBorrar,
        cargando: false,
        error: null,
        cargadoAt: Date.now(),
      })
    } catch {
      fijar(clienteId, { cargando: false, error: 'No se ha podido conectar para leer la base de datos de referencias' })
    } finally {
      enCurso.delete(clienteId)
    }
  })()
  enCurso.set(clienteId, peticion)
  return peticion
}

export function useCatalogo(clienteId: string, activo = true): EstadoCatalogo & { recargar: () => Promise<void> } {
  const estado = useSyncExternalStore(
    suscribir,
    () => tiendas.get(clienteId) ?? INICIAL,
    () => INICIAL
  )

  useEffect(() => {
    if (activo) void cargarCatalogo(clienteId)
  }, [clienteId, activo])

  const recargar = useCallback(() => cargarCatalogo(clienteId, true), [clienteId])
  return { ...estado, recargar }
}

/* ------------------------------------------------------------------ */
/* Escribir                                                            */
/* ------------------------------------------------------------------ */

export type Resultado = { ok: true } | { ok: false; error: string }

async function enviar(url: string, metodo: 'POST' | 'PATCH' | 'DELETE', cuerpo?: unknown): Promise<Resultado> {
  try {
    const res = await fetch(url, {
      method: metodo,
      headers: cuerpo === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    })
    const p = (await res.json().catch(() => null)) as { error?: string } | null
    if (!res.ok) return { ok: false, error: p?.error ?? 'No se ha podido guardar' }
    return { ok: true }
  } catch {
    return { ok: false, error: 'No se ha podido conectar con el servidor' }
  }
}

/** Da de alta tallas nuevas. Se vuelve a leer la lista: los ids los pone la base */
export async function anadirReferencias(clienteId: string, filas: Array<Partial<DatosFila>>): Promise<Resultado> {
  const r = await enviar('/api/fba/catalogo', 'POST', { clienteId, filas })
  if (r.ok) await cargarCatalogo(clienteId, true)
  return r
}

/**
 * Corrige filas. La pantalla ve el cambio AL INSTANTE y, si el servidor lo rechaza
 * (un FBASKU repetido, una talla que ya existe), vuelve a lo de antes: es lo que
 * hace posible editar una celda y seguir tecleando en la siguiente sin esperar.
 */
export async function corregirReferencias(clienteId: string, ids: string[], campos: Partial<DatosFila>): Promise<Resultado> {
  const previo = tiendas.get(clienteId)
  if (previo?.filas) {
    const set = new Set(ids)
    fijar(clienteId, { filas: previo.filas.map((f) => (set.has(f.id) ? { ...f, ...campos } : f)) })
  }
  const r = await enviar('/api/fba/catalogo', 'PATCH', { clienteId, ids, campos })
  if (!r.ok && previo?.filas) fijar(clienteId, { filas: previo.filas })
  return r
}

export async function quitarReferencias(clienteId: string, ids: string[]): Promise<Resultado> {
  const r = await enviar(`/api/fba/catalogo?cliente=${clienteId}&ids=${ids.join(',')}`, 'DELETE')
  if (r.ok) await cargarCatalogo(clienteId, true)
  return r
}
