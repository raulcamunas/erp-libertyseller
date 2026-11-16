'use client'

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { filasACsv } from '@/lib/fba/catalogo/exportar'
import { construirIndice, type IndiceCatalogo } from '@/lib/fba/catalogo/indice'
import type { DatosFila, FilaCatalogo } from '@/lib/fba/catalogo/tipos'
import type { LineaPlan, PlanParaCliente } from '@/lib/fba/plan-tipos'
import { bajarBlob } from '../comun/descargar'
import { esPlanDeAgencia, usePlan } from '../comun/usePlan'
import { datosPorSku, refsQueVendenFuera, type DatoTalla, type LineaParaTalla, type RefFuera } from './plan-por-talla'

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
 *
 * API
 *   useCatalogo(clienteId, activo?)        → EstadoCatalogo + recargar()
 *   cargarCatalogo(clienteId, forzar?)     pide la lista (las peticiones a la vez se comparten)
 *   anadirReferencias / corregirReferencias / quitarReferencias   escriben (corregir es optimista y revierte)
 *   exportarCatalogo(filas, cliente, hoy)  baja el CSV con el formato de la hoja (se puede volver a importar)
 *   usePlanDeLaBase(clienteId, activo)     las líneas de la ÚLTIMA pasada del plan cruzadas por SKU (spec §8, D43.4)
 *   useEsEstrecho(px?)                     true por debajo de `lg` (1024 px): tarjetas apiladas en vez de tablas
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

/* ------------------------------------------------------------------ */
/* Exportar                                                            */
/* ------------------------------------------------------------------ */

/** Descarga la base de datos en el formato de la hoja: se puede pegar de vuelta o volver a importar */
export function exportarCatalogo(filas: FilaCatalogo[], clienteNombre: string, hoy: string): void {
  const csv = '\ufeff' + filasACsv(filas)
  const nombre = clienteNombre.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  bajarBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `base-de-datos-${nombre || 'cliente'}-${hoy}.csv`)
}

/* ------------------------------------------------------------------ */
/* El plan, cruzado con la base                                        */
/* ------------------------------------------------------------------ */

export interface PlanDeLaBase {
  /** Por SKU normalizado (claveSku) */
  datos: Map<string, DatoTalla>
  /** La agencia ve la cantidad y el motivo; el cliente externo, solo stock y ritmo */
  deAgencia: boolean
  /** Hay pasada (o plan para el cliente) con líneas */
  hayPlan: boolean
  calculadoAt: string | null
  /** De la calidad del plan (D5.5); null si no se sabe (cliente externo o sin plan) */
  refsFueraDeCatalogo: number | null
  /** Las líneas que venden y no están en la base, para enseñar la lista */
  fueraDeLaBase: RefFuera[]
  cargando: boolean
  error: string | null
  /** false = falta lanzar la migración 316 (sin pasadas guardadas) */
  migracion316: boolean | null
}

/**
 * Las cifras de la última pasada del plan para las tallas de la base de datos: stock en FBA, ritmo (con su
 * confianza) y lo que propone (o por qué no). Pide TODAS las líneas (`?todas=1`): la base de datos tiene
 * cientos de tallas y casi ninguna rompe en 60 días. El GET nunca calcula si ya hay pasada (D28).
 */
export function usePlanDeLaBase(clienteId: string, filas: FilaCatalogo[] | null, activo = true): PlanDeLaBase {
  const r = usePlan(activo ? clienteId : null, { todas: true })
  const lineas = useMemo(() => ((r.plan?.lineas ?? []) as unknown as LineaParaTalla[]), [r.plan])
  const datos = useMemo(() => datosPorSku(lineas), [lineas])
  const fueraDeLaBase = useMemo(() => (r.deAgencia && filas && filas.length > 0 ? refsQueVendenFuera(lineas, filas) : []), [r.deAgencia, lineas, filas])
  const plan = r.plan
  const deAgencia = esPlanDeAgencia(plan)
  const calculadoAt = r.pasada?.calculadoAt ?? (plan ? (deAgencia ? plan.calidad.calculadoAt : (plan as PlanParaCliente).calculadoAt) : null)
  const refsFuera = deAgencia ? plan.calidad.refsFueraDeCatalogo : null
  return {
    datos,
    deAgencia: r.deAgencia,
    hayPlan: lineas.length > 0,
    calculadoAt,
    refsFueraDeCatalogo: typeof refsFuera === 'number' ? refsFuera : null,
    fueraDeLaBase,
    cargando: r.cargando,
    error: r.error,
    migracion316: r.migracion316,
  }
}

/** Para comprobar que la forma de LineaPlan sigue valiendo como LineaParaTalla (si cambia el contrato, falla aquí) */
type Afirmar<T extends true> = T
export type _LineaPlanCompatible = Afirmar<LineaPlan extends LineaParaTalla ? true : false>

/* ------------------------------------------------------------------ */
/* Móvil                                                               */
/* ------------------------------------------------------------------ */

/**
 * true por debajo de `px` (1024 por defecto, el `lg` de Tailwind). Lo usan las piezas que en el móvil
 * cambian de forma —la tabla de tallas y el editor de desplegables pasan a tarjetas apiladas— y que no
 * pueden pintar las dos versiones a la vez (registran casillas para el foco). En el servidor y en el
 * primer pintado del navegador vale false (escritorio): así no salta la hidratación.
 */
export function useEsEstrecho(px = 1024): boolean {
  const [estrecho, setEstrecho] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia(`(max-width: ${px - 0.02}px)`)
    const cambiar = () => setEstrecho(mq.matches)
    cambiar()
    mq.addEventListener?.('change', cambiar)
    return () => mq.removeEventListener?.('change', cambiar)
  }, [px])
  return estrecho
}
