/**
 * LA BASE DE DATOS CRUZADA CON EL PLAN: STOCK, RITMO Y PLAN DE CADA TALLA (spec remesas-pro §8, D5 y D43.4).
 *
 * PURO (sin React ni red): se prueba con `npx tsx components/remesas/catalogo/plan-por-talla.prueba.ts`.
 *
 * La base de datos dice QUÉ tallas hay (REF, color, talla y sus códigos); el plan de la última pasada dice
 * cuánto hay en FBA, a qué ritmo se vende y qué se propone mandar. Se cruzan por el SKU: `fbasku` de la base
 * es el `sku` de la línea del plan (sin espacios y sin distinguir mayúsculas). Una talla sin FBASKU no se
 * puede cruzar y sale sin cifras.
 *
 * API
 *   datosPorSku(lineas)                 Map<SKU normalizado, DatoTalla> con lo que trae cada línea del plan
 *   claveSku(sku)                       cómo se normaliza el SKU para cruzar
 *   datoDeFila(fila, datos)             el DatoTalla de una talla de la base (o null)
 *   textoPlan(dato, deAgencia)          { texto, tono, detalle }: «12 ud» o el motivo («Talla sin ventas en 180 días»)
 *   curvaDeModelo(filas, datos)         la curva de tallas de un modelo: vendido 90 d, en FBA, propuesto y cuota
 *   resumenDeModelo(filas, datos)       lo que se enseña en la tarjeta de la lista: en FBA y propuesto
 *   refsQueVendenFuera(lineas, filas)   las referencias que venden y no están en la base de datos (D5.5)
 *
 * El cliente externo recibe `PlanParaCliente` (sin cantidad, motivo, prioridad ni ventas): todo es opcional y
 * la pantalla enseña lo que haya.
 */

import type { Confianza, MotivoFuera, Prioridad } from '@/lib/fba/plan-tipos'
import type { FilaCatalogo } from '@/lib/fba/catalogo/tipos'
import { compararTalla } from '@/lib/fba/catalogo/normalizar'
import { MOTIVO_FUERA } from '../comun/estilo-plan'
import { fechaCorta } from '../formato'

/** Lo mínimo que se lee de una línea del plan: vale para `LineaPlan` (agencia) y para la de `PlanParaCliente` */
export interface LineaParaTalla {
  sku: string
  nombre?: string | null
  asin?: string | null
  fnsku?: string | null
  modelo?: string | null
  talla?: string | null
  vendibles: number
  deCamino?: number | null
  cantidad?: number | null
  fuera?: MotivoFuera | null
  prioridad?: Prioridad | null
  salirAntesDe?: string | null
  /** El previsto que usa la frase del plan */
  ritmoPrevisto?: number | null
  ritmo: {
    base: number | null
    previsto?: number | null
    confianza: Confianza
    explicacion: string
    origen?: 'sku' | 'modelo' | 'ultimo_periodo'
    ventas90?: number
    ventas180?: number
  }
}

export interface DatoTalla {
  sku: string
  vendibles: number
  deCamino: number | null
  /** ud/día: el previsto si lo hay (agencia), si no el base */
  ritmo: number | null
  confianza: Confianza
  /** 'modelo' = ritmo del modelo repartido por tallas (D5) */
  origenRitmo: 'sku' | 'modelo' | 'ultimo_periodo' | null
  explicacion: string
  ventas90: number | null
  /** null = el plan no lo dice (cliente externo) */
  cantidad: number | null
  fuera: MotivoFuera | null
  prioridad: Prioridad | null
  salirAntesDe: string | null
}

export const claveSku = (sku: string | null | undefined): string => (sku ?? '').replace(/\s+/g, '').toUpperCase()

const num = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) ? n : null)

export function datosPorSku(lineas: ReadonlyArray<LineaParaTalla>): Map<string, DatoTalla> {
  const m = new Map<string, DatoTalla>()
  for (const l of lineas) {
    const k = claveSku(l.sku)
    if (!k) continue
    m.set(k, {
      sku: l.sku,
      vendibles: num(l.vendibles) ?? 0,
      deCamino: num(l.deCamino),
      ritmo: num(l.ritmoPrevisto) ?? num(l.ritmo?.previsto) ?? num(l.ritmo?.base),
      confianza: l.ritmo?.confianza ?? 'sin_datos',
      origenRitmo: l.ritmo?.origen ?? null,
      explicacion: l.ritmo?.explicacion ?? '',
      ventas90: num(l.ritmo?.ventas90),
      cantidad: num(l.cantidad),
      fuera: l.fuera ?? null,
      prioridad: l.prioridad ?? null,
      salirAntesDe: l.salirAntesDe ?? null,
    })
  }
  return m
}

export function datoDeFila(fila: Pick<FilaCatalogo, 'fbasku'>, datos: ReadonlyMap<string, DatoTalla>): DatoTalla | null {
  if (!fila.fbasku) return null
  return datos.get(claveSku(fila.fbasku)) ?? null
}

export type TonoPlan = 'propone' | 'fuera' | 'nada'

/**
 * Lo que dice la columna «Plan» de una talla.
 * - Con cantidad > 0: «12 ud» (tono propone) y, si la hay, la fecha de salida en el detalle.
 * - Con motivo: el texto corto del motivo («Talla sin ventas en 180 días»).
 * - Sin nada (cliente externo, o la talla no está en la pasada): «—».
 */
export function textoPlan(d: DatoTalla | null, deAgencia: boolean): { texto: string; tono: TonoPlan; detalle: string | null } {
  if (!d || !deAgencia) return { texto: '—', tono: 'nada', detalle: d ? null : 'Esta talla no sale en la última pasada del plan' }
  if (d.cantidad !== null && d.cantidad > 0 && !d.fuera) {
    return { texto: `${d.cantidad} ud`, tono: 'propone', detalle: d.salirAntesDe ? `Tiene que salir antes del ${fechaCorta(d.salirAntesDe)}` : null }
  }
  if (d.fuera) return { texto: MOTIVO_FUERA[d.fuera] ?? d.fuera, tono: 'fuera', detalle: null }
  return { texto: 'Nada', tono: 'nada', detalle: 'El plan no propone mandar nada de esta talla' }
}

/* ------------------------------------------------------------------ */
/* La curva de tallas de un modelo (D43.4)                              */
/* ------------------------------------------------------------------ */

export interface PuntoCurva {
  talla: string
  sku: string | null
  continuidad: boolean
  /** Unidades vendidas en 90 días (null si el plan no lo trae) */
  vendido90: number | null
  enFba: number | null
  deCamino: number | null
  /** Lo que propone el plan (0 si nada; null si no se sabe) */
  propuesto: number | null
  ritmo: number | null
  confianza: Confianza | null
  origenRitmo: DatoTalla['origenRitmo']
  /** Parte del ritmo del modelo que se lleva esta talla (0..1); null si el modelo no tiene ritmo */
  cuota: number | null
  fuera: MotivoFuera | null
}

export interface CurvaModelo {
  puntos: PuntoCurva[]
  /** Suma del ritmo de sus tallas (ud/día). null si ninguna tiene ritmo */
  ritmoModelo: number | null
  vendido90: number | null
  enFba: number
  propuesto: number | null
  /** Tallas cuyo ritmo es el del modelo repartido (D5) */
  tallasRepartidas: number
  /** Tallas con datos del plan */
  conDatos: number
  hayVentas: boolean
  hayPropuesta: boolean
}

export function curvaDeModelo(filas: ReadonlyArray<FilaCatalogo>, datos: ReadonlyMap<string, DatoTalla>): CurvaModelo {
  const ordenadas = [...filas].sort((a, b) => compararTalla(a.talla, b.talla))
  const base = ordenadas.map((f) => ({ f, d: datoDeFila(f, datos) }))
  const sumaRitmo = base.reduce((s, x) => s + (x.d?.ritmo ?? 0), 0)
  const conRitmo = base.some((x) => x.d?.ritmo !== null && x.d?.ritmo !== undefined)

  const puntos: PuntoCurva[] = base.map(({ f, d }) => ({
    talla: f.talla,
    sku: f.fbasku,
    continuidad: f.continuidad,
    vendido90: d?.ventas90 ?? null,
    enFba: d ? d.vendibles : null,
    deCamino: d?.deCamino ?? null,
    propuesto: d ? (d.cantidad === null ? null : d.fuera ? 0 : Math.max(0, d.cantidad)) : null,
    ritmo: d?.ritmo ?? null,
    confianza: d?.confianza ?? null,
    origenRitmo: d?.origenRitmo ?? null,
    cuota: conRitmo && sumaRitmo > 0 ? (d?.ritmo ?? 0) / sumaRitmo : null,
    fuera: d?.fuera ?? null,
  }))

  const suma = (k: 'vendido90' | 'propuesto'): number | null => (puntos.some((p) => p[k] !== null) ? puntos.reduce((s, p) => s + (p[k] ?? 0), 0) : null)
  const vendido90 = suma('vendido90')
  const propuesto = suma('propuesto')
  return {
    puntos,
    ritmoModelo: conRitmo ? redondear(sumaRitmo, 3) : null,
    vendido90,
    enFba: puntos.reduce((s, p) => s + (p.enFba ?? 0), 0),
    propuesto,
    tallasRepartidas: puntos.filter((p) => p.origenRitmo === 'modelo').length,
    conDatos: base.filter((x) => x.d).length,
    hayVentas: (vendido90 ?? 0) > 0,
    hayPropuesta: (propuesto ?? 0) > 0,
  }
}

/** Para la tarjeta de un modelo en la lista: en FBA y lo propuesto (null si no hay datos del plan) */
export function resumenDeModelo(filas: ReadonlyArray<FilaCatalogo>, datos: ReadonlyMap<string, DatoTalla>): { enFba: number; propuesto: number | null } | null {
  let alguno = false
  let enFba = 0
  let propuesto: number | null = null
  for (const f of filas) {
    const d = datoDeFila(f, datos)
    if (!d) continue
    alguno = true
    enFba += d.vendibles
    if (d.cantidad !== null) propuesto = (propuesto ?? 0) + (d.fuera ? 0 : Math.max(0, d.cantidad))
  }
  return alguno ? { enFba, propuesto } : null
}

/* ------------------------------------------------------------------ */
/* Lo que vende y no está en la base de datos (D5.5)                    */
/* ------------------------------------------------------------------ */

export interface RefFuera {
  sku: string
  nombre: string | null
  asin: string | null
  fnsku: string | null
  modelo: string | null
  talla: string | null
  ventas90: number | null
  vendibles: number
  ritmo: number | null
}

/**
 * Las líneas del plan que VENDEN (ventas90 > 0, o ritmo > 0 si no hay ventas) y cuyo SKU no es el FBASKU de
 * ninguna talla de la base de datos. Ordenadas por lo que venden. Es la lista detrás del aviso
 * «N referencias que venden no están en la base de datos» (`calidad.refsFueraDeCatalogo`).
 */
export function refsQueVendenFuera(lineas: ReadonlyArray<LineaParaTalla>, filas: ReadonlyArray<Pick<FilaCatalogo, 'fbasku'>>): RefFuera[] {
  const enBase = new Set(filas.map((f) => claveSku(f.fbasku)).filter(Boolean))
  const fuera: RefFuera[] = []
  for (const l of lineas) {
    const k = claveSku(l.sku)
    if (!k || enBase.has(k)) continue
    const v90 = num(l.ritmo?.ventas90)
    const r = num(l.ritmo?.previsto) ?? num(l.ritmo?.base)
    const vende = v90 !== null ? v90 > 0 : (r ?? 0) > 0
    if (!vende) continue
    fuera.push({ sku: l.sku, nombre: l.nombre ?? null, asin: l.asin ?? null, fnsku: l.fnsku ?? null, modelo: l.modelo ?? null, talla: l.talla ?? null, ventas90: v90, vendibles: num(l.vendibles) ?? 0, ritmo: r })
  }
  return fuera.sort((a, b) => (b.ventas90 ?? 0) - (a.ventas90 ?? 0) || (b.ritmo ?? 0) - (a.ritmo ?? 0) || a.sku.localeCompare(b.sku))
}

function redondear(n: number, d: number): number {
  const f = 10 ** d
  return Math.round(n * f) / f
}
