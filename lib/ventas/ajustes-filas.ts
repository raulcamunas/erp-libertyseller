/**
 * VENTAS · AJUSTES QUE CAMBIAN LAS FILAS DEL RESUMEN ANTES DE SUMARLAS (página «Configuración»). PURO: se comprueba con ajustes-filas.prueba.ts.
 *
 *   · Tarifas mensuales: el almacenamiento al mes al que corresponde (Amazon cobra en noviembre el de octubre) y/o almacenamiento y suscripción
 *     repartidos entre los días de su mes (amortizar). Se quitan del día en que se cobraron y se ponen en filas sin SKU de los días que tocan.
 *   · COGS FIFO: el coste de lo vendido sale de los lotes de compra de cada SKU, el más antiguo primero.
 */
import type { FilaPanel } from './panel'

const DIA_MS = 86_400_000
const r2 = (n: number) => Math.round(n * 100) / 100
const sumar = (dia: string, n: number) => new Date(Date.parse(`${dia}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10)
const inicioMes = (dia: string, menos = 0) => {
  const d = new Date(`${dia}T00:00:00Z`)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - menos, 1)).toISOString().slice(0, 10)
}
const finMes = (dia: string) => {
  const d = new Date(`${dia}T00:00:00Z`)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
}

export interface OpcionesMensuales {
  almacenamiento: 'cobro' | 'corresponde'
  amortizar: boolean
}

/** Desde qué día hay que leer las tarifas mensuales para enseñar bien [desde, hasta]: el mes anterior al de `desde` y hasta 45 días después */
export function rangoDeMensuales(desde: string, hasta: string): { desde: string; hasta: string } {
  return { desde: inicioMes(desde, 1), hasta: sumar(finMes(hasta), 45) }
}

const vacia = (dia: string, mkt: string): FilaPanel => ({ dia, mkt, sku: '', asin: null, unidades: 0, pedidos: 0, ventas: 0, promo: 0, referral: 0, fba: 0, otras: 0, estimadas: 0, reembolsos: 0, reembolsado: 0, comisionReembolso: 0, ajustes: 0, publicidad: 0, ventasPpc: 0, unidadesPpc: 0, almacenamiento: 0, suscripcion: 0 })

/**
 * `filas`: las del periodo [desde, hasta]. `mensuales`: TODAS las filas con almacenamiento o suscripción de `rangoDeMensuales(desde, hasta)`.
 * Devuelve las filas con esas tarifas movidas (nuevas filas sin SKU en el mercado `mkt`). Sin opciones, las filas tal cual.
 */
export function moverTarifasMensuales(filas: readonly FilaPanel[], mensuales: ReadonlyArray<Pick<FilaPanel, 'dia' | 'almacenamiento' | 'suscripcion'>>, o: OpcionesMensuales, desde: string, hasta: string, mkt: string): FilaPanel[] {
  const moverAlm = o.almacenamiento === 'corresponde' || o.amortizar
  const moverSus = o.amortizar
  if (!moverAlm && !moverSus) return [...filas]
  // 1. Fuera del día en que se cobraron
  const salida = filas.map((f) => {
    const alm = moverAlm ? (f.almacenamiento ?? 0) : 0
    const sus = moverSus ? (f.suscripcion ?? 0) : 0
    if (!alm && !sus) return f
    return { ...f, otras: r2(f.otras - alm - sus), almacenamiento: r2((f.almacenamiento ?? 0) - alm), suscripcion: r2((f.suscripcion ?? 0) - sus) }
  })
  // 2. A los días que les tocan
  const nuevas = new Map<string, FilaPanel>()
  const poner = (dia: string, alm: number, sus: number) => {
    if (dia < desde || dia > hasta || (!alm && !sus)) return
    const f = nuevas.get(dia) ?? vacia(dia, mkt)
    f.otras += alm + sus
    f.almacenamiento = (f.almacenamiento ?? 0) + alm
    f.suscripcion = (f.suscripcion ?? 0) + sus
    nuevas.set(dia, f)
  }
  const repartir = (mes: string, importe: number, tipo: 'alm' | 'sus') => {
    const fin = finMes(mes)
    const dias = Number(fin.slice(8, 10))
    if (!o.amortizar) return poner(tipo === 'alm' ? fin : mes, tipo === 'alm' ? importe : 0, tipo === 'sus' ? importe : 0)
    for (let i = 0; i < dias; i++) {
      const d = sumar(mes, i)
      poner(d, tipo === 'alm' ? importe / dias : 0, tipo === 'sus' ? importe / dias : 0)
    }
  }
  for (const m of mensuales) {
    const alm = moverAlm ? (m.almacenamiento ?? 0) : 0
    const sus = moverSus ? (m.suscripcion ?? 0) : 0
    // El almacenamiento que se cobra un mes es del mes anterior
    if (alm) repartir(o.almacenamiento === 'corresponde' ? inicioMes(m.dia, 1) : inicioMes(m.dia), alm, 'alm')
    if (sus) repartir(inicioMes(m.dia), sus, 'sus')
  }
  for (const f of nuevas.values()) {
    f.otras = r2(f.otras)
    f.almacenamiento = r2(f.almacenamiento ?? 0)
    f.suscripcion = r2(f.suscripcion ?? 0)
    salida.push(f)
  }
  return salida
}

export interface LoteDeCoste {
  sku: string
  fecha: string
  unidades: number
  coste: number
}

/**
 * COGS FIFO. `ventas`: unidades vendidas por SKU y día (TODAS desde el primer lote, para saber qué queda de cada uno). Devuelve el coste medio por
 * unidad de cada SKU y día. Un lote solo sirve para ventas desde su fecha. Lo que se vende sin lote que lo cubra: `sobrevendidas` (el último
 * lote, cero o el COGS fijo de la ficha; sin COGS fijo, el último lote).
 */
export function costesFifo(lotes: readonly LoteDeCoste[], ventas: ReadonlyArray<{ sku: string; dia: string; unidades: number }>, sobrevendidas: 'ultimo' | 'cero' | 'fijo', fijos: Readonly<Record<string, number>>): Map<string, number> {
  const salida = new Map<string, number>()
  const porSku = new Map<string, Array<LoteDeCoste & { quedan: number }>>()
  for (const l of [...lotes].sort((a, b) => a.fecha.localeCompare(b.fecha))) {
    const x = porSku.get(l.sku) ?? []
    x.push({ ...l, quedan: l.unidades })
    porSku.set(l.sku, x)
  }
  const ventasPorSku = new Map<string, Map<string, number>>()
  for (const v of ventas) {
    if (!porSku.has(v.sku) || v.unidades <= 0) continue
    const m = ventasPorSku.get(v.sku) ?? new Map<string, number>()
    m.set(v.dia, (m.get(v.dia) ?? 0) + v.unidades)
    ventasPorSku.set(v.sku, m)
  }
  for (const [sku, dias] of ventasPorSku) {
    const ls = porSku.get(sku) ?? []
    let ultimo: number | null = null
    for (const [dia, unidades] of [...dias].sort((a, b) => a[0].localeCompare(b[0]))) {
      let faltan = unidades
      let coste = 0
      for (const l of ls) {
        if (faltan <= 0) break
        if (l.fecha > dia || l.quedan <= 0) continue
        const usar = Math.min(l.quedan, faltan)
        l.quedan -= usar
        faltan -= usar
        coste += usar * l.coste
        ultimo = l.coste
      }
      if (faltan > 0) {
        const delUltimo = ultimo ?? [...ls].reverse().find((l) => l.fecha <= dia)?.coste ?? ls[0]?.coste ?? 0
        const unitario = sobrevendidas === 'cero' ? 0 : sobrevendidas === 'fijo' ? (fijos[sku] ?? delUltimo) : delUltimo
        coste += faltan * unitario
      }
      salida.set(`${sku}|${dia}`, coste / unidades)
    }
  }
  return salida
}
