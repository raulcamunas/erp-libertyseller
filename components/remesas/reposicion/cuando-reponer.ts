/**
 * CUÁNDO REPONER: la lógica del panel «Reponer». PURO (se prueba con cuando-reponer.prueba.ts).
 *
 * Cada referencia cae en un TRAMO con la misma regla que las alertas (lib/fba/alertas.ts), para que el panel y los avisos nunca se contradigan:
 *   · ya      → el plan propone enviar y es «tarde» o «urgente» (o no cabe en el envío por capacidad y es tarde/urgente)
 *   · pronto  → el plan propone enviar «esta semana», «próximas 2 semanas» o «este mes»
 *   · no      → tiene stock de sobra, aún no toca, o se propone «más adelante»
 *   · aparte  → fuera del plan sin rotura que vigilar (sin ventas, descatalogada, agotada hace tiempo…)
 */
import type { LineaPlan, PlazoEtapas } from '@/lib/fba/plan-tipos'
import { FUERA_SIN_ROTURA } from '@/lib/fba/rotura-linea'

export type Tramo = 'ya' | 'pronto' | 'no' | 'aparte'

type Linea = Pick<
  LineaPlan,
  | 'sku' | 'nombre' | 'modelo' | 'talla' | 'prioridad' | 'fuera' | 'cantidad' | 'cajas' | 'avisos' | 'fechaRotura' | 'fechaPrimerHueco' | 'salirAntesDe' | 'decidirAntesDe'
  | 'coberturaDias' | 'coberturaConLoQueViene' | 'vendibles' | 'deCamino' | 'comprometido' | 'eurosEnRiesgo' | 'eurosSiVaTarde'
>

export function tramoDeLinea(l: Pick<Linea, 'prioridad' | 'fuera' | 'cantidad' | 'avisos'>): Tramo {
  const tardeOUrgente = l.prioridad === 'tarde' || l.prioridad === 'urgente'
  if (l.fuera === null && l.cantidad > 0) {
    if (tardeOUrgente) return 'ya'
    if (l.prioridad === 'esta_semana' || l.prioridad === 'proximas_2' || l.prioridad === 'este_mes') return 'pronto'
    return 'no'
  }
  // No cabe en el envío por capacidad, pero hace falta ya: sigue siendo «ya» (con «no cabe»)
  if (l.cantidad === 0 && l.avisos.includes('recortada_capacidad') && tardeOUrgente) return 'ya'
  if (l.fuera && FUERA_SIN_ROTURA.includes(l.fuera) && l.fuera !== 'exceso') return 'aparte'
  if (l.fuera === 'parado' || l.fuera === 'antiguo') return 'aparte'
  return 'no'
}

export interface Semaforo {
  ya: { referencias: number; agotadas: number; unidades: number; euros: number }
  pronto: { referencias: number; unidades: number; primeraDecision: string | null }
  no: { referencias: number; exceso: number }
  aparte: number
  /** La primera rotura que todavía se puede evitar (fecha > hoy) entre lo que se propone */
  proximaRoturaEvitable: string | null
}

export function semaforo(lineas: readonly Linea[], hoy: string): Semaforo {
  const s: Semaforo = { ya: { referencias: 0, agotadas: 0, unidades: 0, euros: 0 }, pronto: { referencias: 0, unidades: 0, primeraDecision: null }, no: { referencias: 0, exceso: 0 }, aparte: 0, proximaRoturaEvitable: null }
  for (const l of lineas) {
    const t = tramoDeLinea(l)
    if (t === 'ya') {
      s.ya.referencias++
      if (l.vendibles <= 0) s.ya.agotadas++
      s.ya.unidades += l.cantidad
      s.ya.euros += l.eurosEnRiesgo ?? 0
    } else if (t === 'pronto') {
      s.pronto.referencias++
      s.pronto.unidades += l.cantidad
      if (l.decidirAntesDe && (!s.pronto.primeraDecision || l.decidirAntesDe < s.pronto.primeraDecision)) s.pronto.primeraDecision = l.decidirAntesDe
    } else if (t === 'no') {
      s.no.referencias++
      if (l.fuera === 'exceso') s.no.exceso++
    } else s.aparte++
    if ((t === 'ya' || t === 'pronto') && l.fechaRotura && l.fechaRotura > hoy && (!s.proximaRoturaEvitable || l.fechaRotura < s.proximaRoturaEvitable)) s.proximaRoturaEvitable = l.fechaRotura
  }
  s.ya.euros = Math.round(s.ya.euros)
  return s
}

export interface FilaDeReposicion {
  clave: string
  /** SKU, o el modelo si agrupa tallas */
  titulo: string
  subtitulo: string | null
  tallas: Array<{ talla: string; tramo: Tramo }>
  tramo: Tramo
  /** Días de stock con lo que hay en Amazon / con lo que viene (camino + comprometido) */
  diasAmazon: number | null
  diasConLoQueViene: number | null
  /** Días hasta el primer hueco si se queda sin stock antes de que llegue lo que viene */
  huecoDias: number | null
  vendibles: number
  deCamino: number
  comprometido: number
  fechaRotura: string | null
  salirAntesDe: string | null
  decidirAntesDe: string | null
  cantidad: number
  cajas: number | null
  noCabe: boolean
  eurosSiVaTarde: number | null
  /** Los SKU de la fila (para abrir la ficha o el envío) */
  skus: string[]
}

const PESO: Record<Tramo, number> = { ya: 0, pronto: 1, no: 2, aparte: 3 }
const dias = (desde: string, hasta: string) => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000)

/** Una fila por referencia, o por MODELO cuando las tallas comparten modelo (ShoesF: 47 filas → 20). La barra es la de la talla que antes se agota */
export function filasDeReposicion(lineas: readonly Linea[], hoy: string, tramos: ReadonlySet<Tramo> = new Set(['ya', 'pronto'])): FilaDeReposicion[] {
  const grupos = new Map<string, Linea[]>()
  for (const l of lineas) {
    const k = l.modelo ? `m:${l.modelo}` : `s:${l.sku}`
    grupos.set(k, [...(grupos.get(k) ?? []), l])
  }
  const filas: FilaDeReposicion[] = []
  for (const [clave, ls] of grupos) {
    const conTramo = ls.map((l) => ({ l, t: tramoDeLinea(l) }))
    const tramo = conTramo.reduce<Tramo>((m, x) => (PESO[x.t] < PESO[m] ? x.t : m), 'aparte')
    if (!tramos.has(tramo)) continue
    // La que manda: la del peor tramo que antes se queda sin stock
    const peor = conTramo.filter((x) => x.t === tramo).sort((a, b) => (a.l.fechaRotura ?? '9999').localeCompare(b.l.fechaRotura ?? '9999'))[0].l
    const modelo = ls.length > 1 || !!peor.modelo
    const minFecha = (xs: Array<string | null>) => xs.filter((x): x is string => !!x).sort()[0] ?? null
    const delTramo = conTramo.filter((x) => x.t === 'ya' || x.t === 'pronto').map((x) => x.l)
    filas.push({
      clave,
      titulo: modelo && peor.modelo ? peor.modelo : peor.sku,
      subtitulo: modelo && peor.modelo ? (ls.length > 1 ? `${ls.length} tallas` : peor.sku) : peor.nombre,
      tallas: ls.length > 1 ? conTramo.filter((x) => x.l.talla).map((x) => ({ talla: x.l.talla as string, tramo: x.t })) : [],
      tramo,
      diasAmazon: peor.coberturaDias,
      diasConLoQueViene: peor.coberturaConLoQueViene ?? peor.coberturaDias,
      huecoDias: peor.fechaPrimerHueco && (!peor.fechaRotura || peor.fechaPrimerHueco < peor.fechaRotura) ? Math.max(0, dias(hoy, peor.fechaPrimerHueco)) : null,
      vendibles: ls.reduce((s, l) => s + l.vendibles, 0),
      deCamino: ls.reduce((s, l) => s + l.deCamino, 0),
      comprometido: ls.reduce((s, l) => s + l.comprometido, 0),
      fechaRotura: peor.fechaRotura,
      salirAntesDe: minFecha(delTramo.map((l) => l.salirAntesDe)) ?? peor.salirAntesDe,
      decidirAntesDe: minFecha(delTramo.map((l) => l.decidirAntesDe)) ?? peor.decidirAntesDe,
      cantidad: delTramo.reduce((s, l) => s + l.cantidad, 0),
      cajas: delTramo.some((l) => l.cajas != null) ? delTramo.reduce((s, l) => s + (l.cajas ?? 0), 0) : null,
      noCabe: delTramo.some((l) => l.cantidad === 0 && l.avisos.includes('recortada_capacidad')),
      eurosSiVaTarde: peor.vendibles <= 0 ? peor.eurosSiVaTarde : null,
      skus: ls.map((l) => l.sku),
    })
  }
  return filas.sort((a, b) => PESO[a.tramo] - PESO[b.tramo] || (a.salirAntesDe ?? '9999').localeCompare(b.salirAntesDe ?? '9999') || (a.fechaRotura ?? '9999').localeCompare(b.fechaRotura ?? '9999'))
}

/** La escala del gráfico en días: lo bastante para ver el plazo (L) y el margen (M); con barco (L > 60), L + M + 30 */
export function escalaCobertura(plazo: Pick<PlazoEtapas, 'hastaLaVenta' | 'margen'>): number {
  const L = plazo.hastaLaVenta
  const M = plazo.margen
  if (L > 60) return L + M + 30
  return Math.max(60, Math.min(120, (L + M) * 2))
}
