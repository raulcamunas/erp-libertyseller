import type { LineaDePanel, RemesaDePanel, SkuDePanel } from './datos'

/**
 * EL ANÁLISIS DE UNA REMESA: LO QUE PINTAN LAS PESTAÑAS.
 * PURA: no toca la base ni la red. Se comprueba con analisis.prueba.ts.
 *
 * Todo sale de lo que el panel ya trae —las líneas con sus ventas por día, el
 * reparto FIFO y los datos globales de cada SKU—, así que ninguna pestaña hace
 * llamadas propias.
 */

const DIA = 86_400_000
const aMs = (f: string) => Date.parse(`${f.slice(0, 10)}T00:00:00Z`)
const aFecha = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export const sumarDias = (f: string, n: number) => aFecha(aMs(f) + n * DIA)
export const diasEntre = (desde: string, hasta: string) => Math.round((aMs(hasta) - aMs(desde)) / DIA)

export interface DiaSerie {
  fecha: string
  vendidas: number
  acumuladas: number
  quedan: number
}

/**
 * Una serie diaria COMPLETA —sin huecos— desde `desde` hasta `hoy`.
 *
 * Un día sin ventas es un cero, no una ausencia: un hueco en una serie de ventas
 * es información. `base` es con lo que arranca el almacén (lo recibido); `quedan`
 * es esa base menos lo vendido hasta ese día.
 */
export function construirSerie(
  porDia: Record<string, number>,
  base: number,
  desde: string,
  hoy: string
): DiaSerie[] {
  const dias = diasEntre(desde, hoy)
  if (dias < 0) return []
  const out: DiaSerie[] = []
  let acum = 0
  for (let i = 0; i <= dias; i += 1) {
    const fecha = sumarDias(desde, i)
    const v = porDia[fecha] ?? 0
    acum += v
    out.push({ fecha, vendidas: v, acumuladas: acum, quedan: Math.max(0, base - acum) })
  }
  return out
}

type Remesa = Pick<RemesaDePanel, 'cuentaDesde' | 'ventasPorDia' | 'quedan' | 'lineas'>

/** La base de una remesa: lo que quedaba más lo que ya se ha consumido */
export function baseDeRemesa(r: Pick<RemesaDePanel, 'quedan' | 'lineas'>): number {
  return r.quedan + r.lineas.reduce((s, l) => s + l.consumidas, 0)
}

export function serieDeRemesa(r: Remesa, hoy: string): DiaSerie[] {
  const porDia = Object.fromEntries(r.ventasPorDia.map((v) => [v.fecha, v.vendidas]))
  return construirSerie(porDia, baseDeRemesa(r), r.cuentaDesde, hoy)
}

export function serieDeLinea(l: LineaDePanel, desde: string, hoy: string): DiaSerie[] {
  return construirSerie(l.porDia, l.quedan + l.consumidas, desde, hoy)
}

/** Cómo rota un producto, de más a menos urgente */
export type Clase = 'sin_stock' | 'rapida' | 'media' | 'lenta' | 'sin_ventas'

export const CLASE_TEXTO: Record<Clase, { texto: string; ayuda: string }> = {
  sin_stock: { texto: 'Agotado', ayuda: 'No queda nada de esta remesa' },
  rapida: { texto: 'Rápida', ayuda: 'Se agota en menos de 14 días al ritmo de la última semana' },
  media: { texto: 'Media', ayuda: 'Entre 14 y 45 días de stock' },
  lenta: { texto: 'Lenta', ayuda: 'Más de 45 días de stock al ritmo actual' },
  sin_ventas: { texto: 'Sin ventas', ayuda: 'No se ha vendido nada en los últimos 30 días' },
}

export interface FilaProducto {
  sku: string
  nombre: string | null
  variante: string | null
  asin: string | null
  enviadas: number
  recibidas: number | null
  vendidas: number
  devueltas: number
  quedan: number
  /** 0-100, sobre lo que se repartió */
  pct: number
  vendidas7: number
  vendidas30: number
  /** Unidades por día de los últimos 7 */
  udDia7: number
  /** Unidades por día desde que cuenta la remesa */
  udDiaRemesa: number
  /** Días de stock al ritmo de los últimos 7 días. null si no se vende */
  cobertura: number | null
  seAgotaEl: string | null
  stockReal: number | null
  descuadre: number | null
  agotadaEl: string | null
  clase: Clase
}

function sumaVentanaDias(porDia: Record<string, number>, desde: string, hoy: string): number {
  let s = 0
  for (const [f, n] of Object.entries(porDia)) if (f >= desde && f <= hoy) s += n
  return s
}

export function analizarProductos(
  r: Pick<RemesaDePanel, 'cuentaDesde' | 'lineas'>,
  globales: Map<string, SkuDePanel>,
  hoy: string
): FilaProducto[] {
  const diasRemesa = Math.max(1, diasEntre(r.cuentaDesde, hoy) + 1)

  return r.lineas.map((l) => {
    const desde7 = sumarDias(hoy, -6)
    const desde30 = sumarDias(hoy, -29)
    const v7 = sumaVentanaDias(l.porDia, desde7, hoy)
    const v30 = sumaVentanaDias(l.porDia, desde30, hoy)
    // Los días que de verdad cuentan: no más de los que lleva la remesa
    const dias7 = Math.max(1, Math.min(7, diasRemesa))
    const udDia7 = v7 / dias7
    const base = l.quedan + l.consumidas
    const cobertura = udDia7 > 0 ? l.quedan / udDia7 : null

    let clase: Clase
    if (l.quedan === 0) clase = 'sin_stock'
    else if (v30 <= 0) clase = 'sin_ventas'
    else if (cobertura !== null && cobertura < 14) clase = 'rapida'
    else if (cobertura !== null && cobertura < 45) clase = 'media'
    else if (cobertura === null) clase = 'sin_ventas'
    else clase = 'lenta'

    const g = globales.get(l.sku) ?? null
    return {
      sku: l.sku,
      nombre: l.nombre,
      variante: l.variante,
      asin: l.asin,
      enviadas: l.enviadas,
      recibidas: l.recibidas,
      vendidas: l.consumidas,
      devueltas: l.devueltas,
      quedan: l.quedan,
      pct: base > 0 ? Math.round((l.consumidas / base) * 1000) / 10 : 0,
      vendidas7: v7,
      vendidas30: v30,
      udDia7: Math.round(udDia7 * 100) / 100,
      udDiaRemesa: Math.round((l.consumidas / diasRemesa) * 100) / 100,
      cobertura: cobertura === null ? null : Math.round(cobertura * 10) / 10,
      seAgotaEl: cobertura === null ? null : sumarDias(hoy, Math.floor(cobertura)),
      stockReal: g?.stockReal ?? null,
      descuadre: g?.descuadre ?? null,
      agotadaEl: l.agotadaEl,
      clase,
    }
  })
}

export interface ResumenRitmo {
  udDia7: number
  udDia30: number
  udDiaRemesa: number
  /** Días de stock de TODA la remesa al ritmo de la última semana */
  cobertura: number | null
  seAgotaEl: string | null
  diasConVentas: number
  diasTotales: number
  /** Referencias que se agotan en menos de una semana */
  encaminoDeAgotarse: number
  sinVentas: number
  agotadas: number
}

export function resumenDeRitmo(r: Remesa, filas: FilaProducto[], hoy: string): ResumenRitmo {
  const serie = serieDeRemesa(r, hoy)
  const diasTotales = serie.length
  const ult = (n: number) => serie.slice(-n).reduce((s, d) => s + d.vendidas, 0) / Math.max(1, Math.min(n, diasTotales))
  const udDia7 = ult(7)
  const total = serie.length > 0 ? serie[serie.length - 1].acumuladas : 0
  const cobertura = udDia7 > 0 ? r.quedan / udDia7 : null
  return {
    udDia7: Math.round(udDia7 * 100) / 100,
    udDia30: Math.round(ult(30) * 100) / 100,
    udDiaRemesa: Math.round((total / Math.max(1, diasTotales)) * 100) / 100,
    cobertura: cobertura === null ? null : Math.round(cobertura * 10) / 10,
    seAgotaEl: cobertura === null ? null : sumarDias(hoy, Math.floor(cobertura)),
    diasConVentas: serie.filter((d) => d.vendidas > 0).length,
    diasTotales,
    encaminoDeAgotarse: filas.filter((f) => f.clase !== 'sin_stock' && f.cobertura !== null && f.cobertura < 7).length,
    sinVentas: filas.filter((f) => f.clase === 'sin_ventas').length,
    agotadas: filas.filter((f) => f.clase === 'sin_stock').length,
  }
}

export interface FilaMatriz {
  sku: string
  nombre: string | null
  variante: string | null
  valores: number[]
  total: number
}

/** Ventas de cada producto en cada uno de los días dados. Ordenadas de más a menos vendido */
export function matrizDeVentas(lineas: LineaDePanel[], dias: string[]): FilaMatriz[] {
  return lineas
    .map((l) => {
      const valores = dias.map((d) => l.porDia[d] ?? 0)
      return { sku: l.sku, nombre: l.nombre, variante: l.variante, valores, total: valores.reduce((s, n) => s + n, 0) }
    })
    .sort((a, b) => b.total - a.total || a.sku.localeCompare(b.sku))
}

export function ultimosDias(hoy: string, desde: string, n: number): string[] {
  const total = diasEntre(desde, hoy) + 1
  const cuantos = Math.max(0, Math.min(n, total))
  return Array.from({ length: cuantos }, (_, i) => sumarDias(hoy, -(cuantos - 1 - i)))
}
