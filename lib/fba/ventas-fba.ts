import type { Moneda, VentasFba } from '@/lib/fba/plan-tipos'

/**
 * VENTAS FBA DE UN CLIENTE, A PARTIR DEL LIBRO MAYOR AGREGADO POR DÍA.
 * ===================================================================
 * PURO. Se comprueba con ventas-fba.prueba.ts. Spec remesas-pro §6.3 y §11 D36. El servidor
 * (`ventas-servidor.ts`, S5) lee el libro de la lectura elegida (`elegirLectura`) y llama aquí.
 *
 * Reglas:
 *  - Solo cuentan los `Shipments` (la venta; en el libro van en negativo, se toma el valor absoluto).
 *    `CustomerReturns` son las devoluciones y se cuentan aparte; ni las retiradas ni los ajustes son ventas.
 *  - El periodo acaba en `hasta` = el último día leído del libro si va atrasado (si no, `hoy`): así
 *    «30 días» son 30 días con libro y la comparación con el periodo anterior no sale falsamente a la baja.
 *  - El periodo anterior tiene los mismos días y acaba el día antes de `desde`. Solo se compara si el
 *    libro lo cubre entero (`anteriorCompleto`); el libro guarda ~540 días, así que con 365 casi nunca.
 *  - Con 365 días se da además el agregado por semana (lunes).
 *  - € = unidades × precio actual de Amazon de cada referencia. Si ninguna referencia vendida tiene
 *    precio, € es null (no 0): «sin precio» no es «no se vendió».
 *  - Salidas por almacén: el país es el del ALMACÉN de Amazon (columna Country del libro), no el del comprador.
 */

/** Forma de `fba_movimientos_diarios` (MovimientoDiario de libro-diario.ts), con el país opcional */
export interface MovimientoVenta {
  sku: string
  fecha: string
  tipo: string
  disposicion?: string | null
  cantidad: number
  /** País del almacén (columna Country). El agregado diario no lo trae; el servidor lo añade si lo lee */
  pais?: string | null
}

export type DiasVentas = VentasFba['dias']

export interface OpcionesVentas {
  moneda?: Moneda
  nombres?: Map<string, string | null>
  /** Último día leído del libro: si es anterior a `hoy`, el periodo acaba ahí */
  leidoHasta?: string | null
  /** Cuántas referencias salen en el top (20) */
  top?: number
}

export const TOP_REFERENCIAS = 20
const DIAS_CHISPA = 30

function aFecha(f: string): number {
  return Date.parse(`${f.slice(0, 10)}T00:00:00Z`)
}

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(aFecha(fecha))
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** Lunes de la semana (ISO) de una fecha */
export function lunesDe(fecha: string): string {
  const d = new Date(aFecha(fecha))
  const dow = (d.getUTCDay() + 6) % 7 // lunes = 0
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}

function redondear(n: number, decimales = 2): number {
  const f = 10 ** decimales
  return Math.round(n * f) / f
}

/** Agrega una serie diaria por semana (lunes). Sirve también para el periodo anterior en la pantalla */
export function porSemanaDe(serie: Array<{ fecha: string; unidades: number; euros: number | null }>): Array<{ semana: string; unidades: number; euros: number | null }> {
  const mapa = new Map<string, { semana: string; unidades: number; euros: number | null }>()
  for (const d of serie) {
    const s = lunesDe(d.fecha)
    const actual = mapa.get(s) ?? { semana: s, unidades: 0, euros: null }
    actual.unidades += d.unidades
    if (d.euros !== null) actual.euros = redondear((actual.euros ?? 0) + d.euros)
    mapa.set(s, actual)
  }
  return Array.from(mapa.values()).sort((a, b) => (a.semana < b.semana ? -1 : a.semana > b.semana ? 1 : 0))
}

function precioDe(precios: Map<string, number | null>, sku: string): number | null {
  const p = precios.get(sku)
  return typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : null
}

/** (actual − anterior) / anterior; null si no hay con qué comparar */
function variacion(actual: number | null, anterior: number | null): number | null {
  if (actual === null || anterior === null || anterior <= 0) return null
  return redondear((actual - anterior) / anterior, 4)
}

/**
 * Las ventas de un periodo.
 * @param movs        libro agregado por SKU, día, tipo y disposición (puede traer más días de los que hacen falta)
 * @param precios     precio actual de Amazon por SKU
 * @param hoy         YYYY-MM-DD (en España)
 * @param dias        7 | 30 | 90 | 365
 * @param leidoDesde  primer día que hay en el libro (para saber si el periodo anterior está completo)
 */
export function ventasFba(
  movs: MovimientoVenta[],
  precios: Map<string, number | null>,
  hoy: string,
  dias: DiasVentas,
  leidoDesde: string | null,
  opciones: OpcionesVentas = {},
): VentasFba {
  const moneda = opciones.moneda ?? 'EUR'
  const nombres = opciones.nombres ?? new Map<string, string | null>()
  const nTop = opciones.top ?? TOP_REFERENCIAS

  // A6.3: el periodo acaba en el último día COMPLETO: el día de hoy va a medias aunque ya esté leído
  const hasta = opciones.leidoHasta ? ultimoDiaCompleto(opciones.leidoHasta.slice(0, 10), hoy) : hoy
  const desde = sumarDias(hasta, -(dias - 1))
  const antHasta = sumarDias(desde, -1)
  const antDesde = sumarDias(desde, -dias)
  const desdeChispa = sumarDias(hasta, -(DIAS_CHISPA - 1))

  // Unidades por día (actual y anterior), por SKU y por país; devoluciones del periodo
  const diaActual = new Map<string, Map<string, number>>() // fecha → sku → ud
  const diaAnterior = new Map<string, Map<string, number>>()
  const porSku = new Map<string, number>()
  const chispa = new Map<string, Map<string, number>>() // sku → fecha → ud
  const porPais = new Map<string, number>()
  let devoluciones = 0
  let hayPais = false

  const sumar = (m: Map<string, Map<string, number>>, k1: string, k2: string, n: number) => {
    let interior = m.get(k1)
    if (!interior) { interior = new Map(); m.set(k1, interior) }
    interior.set(k2, (interior.get(k2) ?? 0) + n)
  }

  for (const m of movs) {
    const f = m.fecha.slice(0, 10)
    const n = Math.abs(Number(m.cantidad) || 0)
    if (n === 0) continue
    if (m.tipo === 'CustomerReturns') {
      if (f >= desde && f <= hasta) devoluciones += n
      continue
    }
    if (m.tipo !== 'Shipments') continue

    if (f >= desde && f <= hasta) {
      sumar(diaActual, f, m.sku, n)
      porSku.set(m.sku, (porSku.get(m.sku) ?? 0) + n)
      if (m.pais !== undefined) {
        hayPais = true
        const pais = (m.pais ?? '').trim().toUpperCase() || 'Sin país'
        porPais.set(pais, (porPais.get(pais) ?? 0) + n)
      }
    } else if (f >= antDesde && f <= antHasta) {
      sumar(diaAnterior, f, m.sku, n)
    }
    if (f >= desdeChispa && f <= hasta) sumar(chispa, m.sku, f, n)
  }

  // ¿Hay algún precio para lo vendido? Si no, € es null en todo (no 0)
  const skusVendidos = new Set<string>([...Array.from(porSku.keys())])
  for (const d of Array.from(diaAnterior.values())) for (const s of Array.from(d.keys())) skusVendidos.add(s)
  const hayPrecio = Array.from(skusVendidos).some((s) => precioDe(precios, s) !== null)

  const serie = (inicio: string, n: number, mapa: Map<string, Map<string, number>>) => {
    const out: Array<{ fecha: string; unidades: number; euros: number | null }> = []
    for (let i = 0; i < n; i++) {
      const fecha = sumarDias(inicio, i)
      const delDia = mapa.get(fecha)
      let unidades = 0
      let euros = 0
      if (delDia) {
        for (const [sku, ud] of Array.from(delDia.entries())) {
          unidades += ud
          const p = precioDe(precios, sku)
          if (p !== null) euros += ud * p
        }
      }
      out.push({ fecha, unidades, euros: hayPrecio ? redondear(euros) : null })
    }
    return out
  }

  const porDia = serie(desde, dias, diaActual)
  const anterior = serie(antDesde, dias, diaAnterior)
  const anteriorCompleto = leidoDesde !== null && leidoDesde.slice(0, 10) <= antDesde

  const total = (s: typeof porDia) => ({
    unidades: s.reduce((a, d) => a + d.unidades, 0),
    euros: hayPrecio ? redondear(s.reduce((a, d) => a + (d.euros ?? 0), 0)) : null,
  })
  const tAct = total(porDia)
  const tAnt = total(anterior)

  const top = Array.from(porSku.entries())
    .map(([sku, unidades]) => {
      const p = precioDe(precios, sku)
      const delSku = chispa.get(sku)
      const serie30: number[] = []
      for (let i = 0; i < DIAS_CHISPA; i++) serie30.push(delSku?.get(sumarDias(desdeChispa, i)) ?? 0)
      return {
        sku,
        nombre: nombres.get(sku) ?? null,
        unidades,
        euros: p !== null ? redondear(unidades * p) : null,
        serie30,
        udDia: redondear(unidades / dias),
      }
    })
    .sort((a, b) => b.unidades - a.unidades || (b.euros ?? -1) - (a.euros ?? -1) || (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0))
    .slice(0, nTop)

  const salidasPorAlmacen = hayPais
    ? Array.from(porPais.entries())
        .map(([pais, unidades]) => ({ pais, unidades }))
        .sort((a, b) => b.unidades - a.unidades || (a.pais < b.pais ? -1 : 1))
    : []

  return {
    dias,
    desde,
    hasta,
    moneda,
    porDia,
    porSemana: dias === 365 ? porSemanaDe(porDia) : null,
    anterior,
    anteriorCompleto,
    totales: {
      unidades: tAct.unidades,
      euros: tAct.euros,
      udDia: redondear(tAct.unidades / dias),
      devoluciones,
      variacionUnidades: anteriorCompleto ? variacion(tAct.unidades, tAnt.unidades) : null,
      variacionEuros: anteriorCompleto ? variacion(tAct.euros, tAnt.euros) : null,
    },
    top,
    salidasPorAlmacen,
  }
}

/** PURO. El último día con las ventas completas: el día leído, pero nunca hoy (va a medias). Sin lectura, ayer */
export function ultimoDiaCompleto(leidoHasta: string | null, hoy: string): string {
  const ayer = sumarDias(hoy, -1)
  return leidoHasta && leidoHasta < ayer ? leidoHasta : ayer
}
