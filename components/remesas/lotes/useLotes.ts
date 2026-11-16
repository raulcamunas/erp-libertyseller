'use client'

import type { LoteEnvio, ResumenLotes } from '@/lib/fba/plan-tipos'
import { useAgencia } from '../comun/useAgencia'

/**
 * EL FIFO POR LOTES DESDE LA PANTALLA (spec remesas-pro §5.3 y §9).
 *
 * API
 *   useLotes(clienteId | null) → { lotes, resumen, ritmo, cargando, error, estado, recargar }
 *     GET /api/fba/lotes?cliente=<id> con la memoria de 5 min de useAgencia (se vacía con invalidarRemesas).
 *   urlDeLotes(clienteId)
 *
 *   Lo puro (se prueba con useLotes.prueba.ts; sin `Date.now()`, con `hoy` inyectado):
 *   estadoDeLote(lote)                     'camino' | 'vivo' | 'agotado' | 'sin_empezar'
 *   filasDeCronograma(lotes, hoy, max?)    filas para el cronograma (rangos en días desde el primer envío) + dominio
 *   partesDelEmbudo(embudo)                vendidas · retiradas o mermas · quedan · no llegaron, con su % (suman 100)
 *   seriesDeCurvas(lotes, destacado, max?) la curva del destacado y las de los últimos 8 agotados, juntas por día
 *   textoDuracion(lote, hoy)               «Duró 38 días» · «Durará ~22 días más» · «De camino» · «Sin ritmo para estimar»
 *   loteDestacado(lotes)                   el vivo más reciente (o el más reciente)
 *   velocidadDe(resumen, remesaId)         «12 % más rápido que la mediana» o null
 */

export interface RespuestaLotes {
  lotes: LoteEnvio[]
  resumen: ResumenLotes
  ritmo?: { origen: 'plan' | 'inventario'; calculadoAt: string | null }
}

export function urlDeLotes(clienteId: string): string {
  return `/api/fba/lotes?cliente=${encodeURIComponent(clienteId)}`
}

export function useLotes(clienteId: string | null) {
  const r = useAgencia<RespuestaLotes>(clienteId ? urlDeLotes(clienteId) : null, { que: 'No se han podido calcular los lotes de los envíos' })
  return {
    lotes: r.datos?.lotes ?? [],
    resumen: r.datos?.resumen ?? null,
    ritmo: r.datos?.ritmo ?? null,
    hayDatos: r.datos !== null,
    cargando: r.cargando,
    error: r.error,
    estado: r.estado,
    recargar: r.recargar,
  }
}

/* ------------------------------------------------------------------ */
/* Puro                                                                */
/* ------------------------------------------------------------------ */

const DIA = 86_400_000
const ms = (f: string) => Date.parse(`${f.slice(0, 10)}T00:00:00Z`)
const diasEntre = (desde: string, hasta: string) => Math.round((ms(hasta) - ms(desde)) / DIA)
const sumarDias = (f: string, n: number) => new Date(ms(f) + Math.round(n) * DIA).toISOString().slice(0, 10)

export type EstadoLote = 'camino' | 'vivo' | 'agotado' | 'sin_empezar'

export function estadoDeLote(l: Pick<LoteEnvio, 'vivo' | 'duracionDias' | 'fechaLlegada' | 'embudo'>): EstadoLote {
  if (l.duracionDias !== null) return 'agotado'
  if (l.vivo) return 'vivo'
  if (!l.fechaLlegada && l.embudo.vendidas === 0) return 'camino'
  return 'sin_empezar'
}

/** Lo que se podía vender: vendidas + lo vendible que queda (la base de la curva, como lotes-envio.ts) */
function pctVendidoDe(l: Pick<LoteEnvio, 'embudo'>): number {
  const base = l.embudo.vendidas + l.embudo.quedanVendibles
  return base > 0 ? Math.round((l.embudo.vendidas / base) * 1000) / 10 : 0
}

export interface FilaCronograma {
  remesaId: string
  nombre: string
  referenciaEnvio: string | null
  estado: EstadoLote
  /** Días desde el origen del eje (el primer envío de los que se enseñan) */
  inicio: number
  /** Los cuatro tramos apilados, en días: hueco hasta el envío, tránsito, venta, prolongación estimada */
  hueco: number
  transito: number
  venta: number
  estimado: number
  /** % vendido de lo que se podía vender (0-100): da la opacidad del tramo de venta */
  pctVendido: number
  /** Marcas d50 y d80 en días desde el origen; null si no se han alcanzado */
  marca50: number | null
  marca80: number | null
  fechaEnvio: string | null
  fechaLlegada: string | null
  finVenta: string | null
  agotaraElEstimado: string | null
}

/**
 * EL CRONOGRAMA: una fila por envío (los `max` más recientes). Tramo de tránsito (envío → llegada), tramo de venta
 * (llegada → agotado, o → hoy si sigue vivo) y la prolongación estimada (hoy → agotará). Lo que va de camino es todo
 * tránsito hasta hoy. Un envío sin fecha de envío ni de llegada no se puede colocar y se queda fuera.
 */
export function filasDeCronograma(lotes: ReadonlyArray<LoteEnvio>, hoy: string, max = 20): { filas: FilaCronograma[]; origen: string | null; fin: number; hoy: number | null; total: number } {
  const colocables = lotes.filter((l) => l.fechaEnvio || l.fechaLlegada)
  const elegidos = colocables.slice(0, Math.max(0, max))
  if (elegidos.length === 0) return { filas: [], origen: null, fin: 0, hoy: null, total: colocables.length }
  const origen = elegidos.map((l) => (l.fechaEnvio ?? l.fechaLlegada) as string).sort()[0]
  let fin = Math.max(0, diasEntre(origen, hoy))

  const filas = elegidos.map((l): FilaCronograma => {
    const estado = estadoDeLote(l)
    const salida = (l.fechaEnvio ?? l.fechaLlegada) as string
    // La venta cuenta desde la llegada; si el libro no la ha visto pero ya vende, desde el envío (como cuentaDesde)
    const desdeVenta = l.fechaLlegada ?? (estado === 'camino' ? null : salida)
    const inicio = Math.max(0, diasEntre(origen, salida))
    const transito = estado === 'camino' ? Math.max(0, diasEntre(salida, hoy)) : desdeVenta ? Math.max(0, diasEntre(salida, desdeVenta)) : 0
    let venta = 0
    let finVenta: string | null = null
    if (desdeVenta && estado !== 'camino') {
      finVenta = l.duracionDias !== null ? sumarDias(desdeVenta, l.duracionDias) : hoy < desdeVenta ? desdeVenta : hoy
      venta = Math.max(0, diasEntre(desdeVenta, finVenta))
    }
    let estimado = 0
    if (finVenta && l.agotaraElEstimado && l.agotaraElEstimado > finVenta) estimado = diasEntre(finVenta, l.agotaraElEstimado)
    const base = desdeVenta ? inicio + transito : null
    const marca = (d: number | null) => (base !== null && d !== null && d <= venta ? base + d : null)
    const fila: FilaCronograma = {
      remesaId: l.remesaId,
      nombre: l.nombre,
      referenciaEnvio: l.referenciaEnvio,
      estado,
      inicio,
      hueco: inicio,
      transito,
      venta,
      estimado,
      pctVendido: pctVendidoDe(l),
      marca50: marca(l.hitos.d50),
      marca80: marca(l.hitos.d80),
      fechaEnvio: l.fechaEnvio,
      fechaLlegada: l.fechaLlegada,
      finVenta,
      agotaraElEstimado: l.agotaraElEstimado,
    }
    fin = Math.max(fin, inicio + transito + venta + estimado)
    return fila
  })
  return { filas, origen, fin, hoy: diasEntre(origen, hoy), total: colocables.length }
}

export type ClaveEmbudo = 'vendidas' | 'retiradas' | 'quedan' | 'noLlegaron'

export interface ParteEmbudo {
  clave: ClaveEmbudo
  texto: string
  valor: number
  /** 0-100; las cuatro suman 100 (resto mayor) */
  pct: number
}

/** El embudo al 100 %: lo que se mandó, repartido entre vendido, retirado o perdido, lo que queda y lo que no llegó */
export function partesDelEmbudo(e: LoteEnvio['embudo']): ParteEmbudo[] {
  const crudo: Array<[ClaveEmbudo, string, number]> = [
    ['vendidas', 'Vendidas', Math.max(0, e.vendidas)],
    ['retiradas', 'Retiradas o mermas', Math.max(0, e.retiradasYMermas)],
    ['quedan', 'Quedan', Math.max(0, e.quedanVendibles) + Math.max(0, e.noVendibles)],
    ['noLlegaron', 'No llegaron', Math.max(0, e.noLlegaron)],
  ]
  const total = crudo.reduce((s, [, , v]) => s + v, 0)
  if (total <= 0) return crudo.map(([clave, texto, valor]) => ({ clave, texto, valor, pct: 0 }))
  // Resto mayor: se redondea hacia abajo y lo que falta hasta 100 va a los de mayor decimal
  const exactos = crudo.map(([, , v]) => (v / total) * 100)
  const bajos = exactos.map((x) => Math.floor(x))
  let falta = 100 - bajos.reduce((s, n) => s + n, 0)
  const orden = exactos.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1])
  for (const [, i] of orden) {
    if (falta <= 0) break
    if (crudo[i][2] <= 0) continue
    bajos[i]++
    falta--
  }
  return crudo.map(([clave, texto, valor], i) => ({ clave, texto, valor, pct: bajos[i] }))
}

export interface SerieCurva {
  remesaId: string
  nombre: string
  destacada: boolean
}

/**
 * LAS CURVAS DE CONSUMO: % vendido frente a días desde la llegada. La del destacado y las de los últimos `max` envíos
 * agotados (sin el destacado), juntas por día para un LineChart: [{ dia, [remesaId]: pct }]. Responde a «¿este envío se
 * vende más rápido o más lento que los anteriores?».
 */
export function seriesDeCurvas(lotes: ReadonlyArray<LoteEnvio>, destacado: string | null, max = 8): { datos: Array<Record<string, number>>; series: SerieCurva[] } {
  const elDestacado = destacado ? lotes.find((l) => l.remesaId === destacado && l.curva.length > 0) ?? null : null
  const agotados = lotes
    .filter((l) => l.duracionDias !== null && l.curva.length > 0 && l.remesaId !== destacado)
    .slice()
    .sort((a, b) => (b.fechaLlegada ?? b.fechaEnvio ?? '').localeCompare(a.fechaLlegada ?? a.fechaEnvio ?? ''))
    .slice(0, Math.max(0, max))
  const todos = [...agotados, ...(elDestacado ? [elDestacado] : [])]
  const porDia = new Map<number, Record<string, number>>()
  for (const l of todos) {
    for (const p of l.curva) {
      const fila = porDia.get(p.dia) ?? { dia: p.dia }
      fila[l.remesaId] = p.pctVendido
      porDia.set(p.dia, fila)
    }
  }
  const datos = [...porDia.values()].sort((a, b) => a.dia - b.dia)
  const series: SerieCurva[] = todos.map((l) => ({ remesaId: l.remesaId, nombre: l.nombre, destacada: l.remesaId === elDestacado?.remesaId }))
  return { datos, series }
}

export function textoDuracion(l: Pick<LoteEnvio, 'duracionDias' | 'agotaraElEstimado' | 'vivo' | 'fechaLlegada' | 'embudo'>, hoy: string): string {
  const estado = estadoDeLote(l)
  if (estado === 'agotado') return `Duró ${l.duracionDias} día${l.duracionDias === 1 ? '' : 's'}`
  if (estado === 'camino') return 'De camino'
  if (l.agotaraElEstimado) {
    const quedan = Math.max(0, diasEntre(hoy, l.agotaraElEstimado))
    return quedan === 0 ? 'Se agota estos días' : `Durará ~${quedan} día${quedan === 1 ? '' : 's'} más`
  }
  return estado === 'vivo' ? 'Sin ritmo para estimar' : 'Sin ventas todavía'
}

/** El lote que se enseña de entrada: el vivo más reciente; si no hay, el más reciente */
export function loteDestacado(lotes: ReadonlyArray<LoteEnvio>): LoteEnvio | null {
  return lotes.find((l) => l.vivo) ?? lotes[0] ?? null
}

/** «12 % más rápido que la mediana», «8 % más lento…», «Como la mediana»; null sin comparación */
export function velocidadDe(resumen: Pick<ResumenLotes, 'velocidadComparada'> | null, remesaId: string): string | null {
  const v = resumen?.velocidadComparada.find((x) => x.remesaId === remesaId)
  if (!v) return null
  if (Math.abs(v.pct) < 3) return 'Como la mediana de los envíos'
  return `${Math.abs(v.pct)} % más ${v.pct > 0 ? 'rápido' : 'lento'} que la mediana`
}
