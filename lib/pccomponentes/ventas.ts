/**
 * LAS VENTAS DE ENTRAIS EN PCCOMPONENTES: LO QUE SE HA VENDIDO, LA COMISIÓN Y LO QUE SE HA GANADO. PURO (el servidor está en ventas-servidor.ts).
 *
 * Sale de los pedidos de PcComponentes (OR11). OJO, comprobado el 17 nov 2026: los pedidos vienen con `order_tax_mode = TAX_EXCLUDED`, así que su
 * `price` es SIN IVA (el IVA va aparte), mientras que el precio de las OFERTAS se publica CON IVA. Por línea:
 *
 *   venta (sin IVA)  = price + shipping_price
 *   comisión         = commission_fee (sin IVA; su IVA se deduce)
 *   coste            = coste del producto HOY (proveedor + canon + porte, de la tabla de precios de Entrais) × unidades. Es una aproximación: el coste del
 *                      día de la venta no se guarda.
 *   beneficio        = venta − comisión − coste
 *
 * DEVOLUCIONES: cada una trae lo devuelto al cliente y la comisión que PcComponentes devuelve. El producto vuelve, así que de esas unidades solo se pierde el
 * porte de ida: venta − devuelto, comisión − comisión devuelta, y coste = coste × unidades que se quedan + porte × unidades devueltas.
 *
 * No cuentan las líneas rechazadas, canceladas o que el cliente no llegó a pagar.
 */

export interface LineaVenta {
  pedido: string
  fecha: string
  estado: string
  sku: string
  titulo: string
  unidades: number
  /** Sin IVA, producto + envío, ya descontado lo devuelto */
  venta: number
  /** Ya descontada la comisión que PcComponentes devuelve en una devolución */
  comision: number
  /** % de la comisión sobre la venta sin IVA */
  comisionPct: number
  coste: number | null
  devuelto: number
  beneficio: number | null
  cuenta: boolean
}

export interface DiaVentas {
  dia: string
  pedidos: number
  unidades: number
  venta: number
  comision: number
  coste: number
  beneficio: number
}

export interface ResumenVentas {
  pedidos: number
  unidades: number
  venta: number
  comision: number
  coste: number
  devuelto: number
  beneficio: number
  /** Beneficio ÷ venta sin IVA */
  margen: number
  /** Líneas con pérdida */
  conPerdida: number
  sinCoste: number
  noCuentan: number
}

/** Estados que no son una venta (rechazada, cancelada, sin pagar…) */
const NO_CUENTAN = new Set(['REFUSED', 'CANCELED', 'CLOSED_CANCELED', 'WAITING_ACCEPTANCE', 'WAITING_DEBIT', 'WAITING_DEBIT_PAYMENT', 'STAGING'])

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0)) || 0
const r2 = (n: number) => Math.round(n * 100) / 100

export function lineasDePedidos(pedidos: Array<Record<string, unknown>>, costeDe: (sku: string) => { coste: number; porte: number } | null): LineaVenta[] {
  const out: LineaVenta[] = []
  for (const p of pedidos) {
    const lineas = Array.isArray(p.order_lines) ? (p.order_lines as Array<Record<string, unknown>>) : []
    for (const l of lineas) {
      const estado = String(l.order_line_state ?? p.order_state ?? '')
      const sku = String(l.offer_sku ?? '')
      const unidades = Math.max(1, Math.round(num(l.quantity)))
      const refunds = Array.isArray(l.refunds) ? (l.refunds as Array<Record<string, unknown>>) : []
      const devuelto = r2(refunds.reduce((s, r) => s + num(r.amount) + num(r.shipping_amount), 0))
      const comisionDevuelta = refunds.reduce((s, r) => s + num(r.commission_amount), 0)
      const udsDevueltas = Math.min(unidades, refunds.reduce((s, r) => s + Math.round(num(r.quantity)), 0))
      const venta = r2(num(l.price) + num(l.shipping_price) - devuelto)
      const comision = r2(num(l.commission_fee) - comisionDevuelta)
      const cu = costeDe(sku)
      const coste = cu === null ? null : r2(cu.coste * (unidades - udsDevueltas) + cu.porte * udsDevueltas)
      const cuenta = !NO_CUENTAN.has(estado)
      out.push({
        pedido: String(p.order_id ?? ''),
        fecha: String(p.created_date ?? l.created_date ?? ''),
        estado,
        sku,
        titulo: String(l.product_title ?? ''),
        unidades,
        venta,
        comision,
        comisionPct: venta > 0 ? comision / venta : 0,
        coste,
        devuelto,
        beneficio: coste === null ? null : r2(venta - comision - coste),
        cuenta,
      })
    }
  }
  return out.sort((a, b) => b.fecha.localeCompare(a.fecha))
}

export function resumir(lineas: readonly LineaVenta[]): { resumen: ResumenVentas; dias: DiaVentas[] } {
  const validas = lineas.filter((l) => l.cuenta)
  const pedidos = new Set(validas.map((l) => l.pedido))
  const suma = (f: (l: LineaVenta) => number) => r2(validas.reduce((s, l) => s + f(l), 0))
  const venta = suma((l) => l.venta)
  const beneficio = suma((l) => l.beneficio ?? 0)
  const porDia = new Map<string, DiaVentas & { _p: Set<string> }>()
  for (const l of validas) {
    const dia = l.fecha.slice(0, 10)
    const d = porDia.get(dia) ?? { dia, pedidos: 0, unidades: 0, venta: 0, comision: 0, coste: 0, beneficio: 0, _p: new Set<string>() }
    d._p.add(l.pedido)
    d.unidades += l.unidades
    d.venta = r2(d.venta + l.venta)
    d.comision = r2(d.comision + l.comision)
    d.coste = r2(d.coste + (l.coste ?? 0))
    d.beneficio = r2(d.beneficio + (l.beneficio ?? 0))
    porDia.set(dia, d)
  }
  return {
    resumen: {
      pedidos: pedidos.size,
      unidades: validas.reduce((s, l) => s + l.unidades, 0),
      venta,
      comision: suma((l) => l.comision),
      coste: suma((l) => l.coste ?? 0),
      devuelto: suma((l) => l.devuelto),
      beneficio,
      margen: venta > 0 ? beneficio / venta : 0,
      conPerdida: validas.filter((l) => l.beneficio !== null && l.beneficio < 0).length,
      sinCoste: validas.filter((l) => l.coste === null).length,
      noCuentan: lineas.length - validas.length,
    },
    dias: [...porDia.values()].map(({ _p, ...d }) => ({ ...d, pedidos: _p.size })).sort((a, b) => b.dia.localeCompare(a.dia)),
  }
}
