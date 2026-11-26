/**
 * VENTAS (EL «SELLERBOARD» PROPIO) · LO QUE SE LEE DE AMAZON, PURO. Se comprueba con lectura.prueba.ts.
 * =====================================================================================================
 * Tres fuentes, las tres solo de lectura y sin nada del comprador:
 *
 *   1. El informe de pedidos (GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL): cada línea con su SKU, unidades, precio, promoción y estado.
 *      De aquí salen las VENTAS y las UNIDADES, por el día del pedido (como Sellerboard), incluidos los pendientes; los cancelados no cuentan.
 *   2. Los movimientos de dinero (Finances API, listFinancialEvents): las comisiones y tarifas FBA REALES de cada pedido enviado, los reembolsos
 *      (por el día en que se reembolsan), las tarifas de la cuenta (almacenamiento, suscripción…) y los ajustes (reembolsos de Amazon por inventario).
 *      La publicidad que Amazon cobra aquí (ProductAdsPayment) NO se suma: sale del informe de Ads, por producto y día, y contaría dos veces.
 *   3. El informe de Amazon Ads por producto anunciado (spAdvertisedProduct, diario): el gasto por SKU y día y las ventas del mismo día.
 *
 * Todo se pasa a EUROS al leer, con el cambio del BCE (lib/divisas).
 */

import { diaEnZona, zonaDeMercado } from '@/lib/fba/pedidos'

export const INFORME_PEDIDOS_VENTAS = 'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL'

/** «Amazon.es» → su marketplace. El informe y los movimientos dicen el canal así */
export const MERCADO_DE_CANAL: Record<string, string> = {
  'amazon.es': 'A1RKKUPIHCS9HS',
  'amazon.fr': 'A13V1IB3VIYZZH',
  'amazon.de': 'A1PA6795UKMFR9',
  'amazon.it': 'APJ6JRA9NG5V4',
  'amazon.co.uk': 'A1F83G8C2ARO7P',
  'amazon.nl': 'A1805IZSGTT6HS',
  'amazon.se': 'A2NODRKZP88ZB9',
  'amazon.pl': 'A1C3SOZRARQ6R3',
  'amazon.com.be': 'AMEN7PMS3EDWL',
  'amazon.ie': 'A28R8C7NBKEWEA',
  'amazon.com.tr': 'A33AVAJ2PDY3EV',
  'amazon.com': 'ATVPDKIKX0DER',
  'amazon.ca': 'A2EUQ1WTGCTBG2',
  'amazon.com.mx': 'A1AM78C64UM0Y8',
}

/** El país de un perfil de Amazon Ads («ES», «UK») → su marketplace */
export const MERCADO_DE_PAIS: Record<string, string> = {
  ES: 'A1RKKUPIHCS9HS',
  FR: 'A13V1IB3VIYZZH',
  DE: 'A1PA6795UKMFR9',
  IT: 'APJ6JRA9NG5V4',
  UK: 'A1F83G8C2ARO7P',
  GB: 'A1F83G8C2ARO7P',
  NL: 'A1805IZSGTT6HS',
  SE: 'A2NODRKZP88ZB9',
  PL: 'A1C3SOZRARQ6R3',
  BE: 'AMEN7PMS3EDWL',
  IE: 'A28R8C7NBKEWEA',
  TR: 'A33AVAJ2PDY3EV',
  US: 'ATVPDKIKX0DER',
  CA: 'A2EUQ1WTGCTBG2',
  MX: 'A1AM78C64UM0Y8',
}

export const mercadoDeCanal = (canal: string | null | undefined): string | null => (canal ? (MERCADO_DE_CANAL[canal.trim().toLowerCase()] ?? null) : null)

/** Euros de un importe: `porEuro` es cuántas unidades de la moneda vale 1 € (BCE). Moneda desconocida = se deja tal cual (casi siempre EUR) */
export function aEuros(importe: number, moneda: string | null | undefined, porEuro: Record<string, number>): number {
  if (!moneda || moneda === 'EUR') return importe
  const r = porEuro[moneda]
  return r && r > 0 ? importe / r : importe
}

const r2 = (n: number) => Math.round(n * 100) / 100

/* ------------------------------------------------------------------ */
/* 1 · El informe de pedidos                                           */
/* ------------------------------------------------------------------ */

export interface LineaPedido {
  pedido: string
  sku: string
  marketplace_id: string
  fecha: string
  dia: string
  asin: string | null
  estado: string
  canal: 'fba' | 'fbm'
  unidades: number
  /** Euros, con IVA. null = Amazon todavía no da el precio (pedido pendiente) */
  ventas: number | null
  /** Euros, en positivo: lo que se descuenta por promociones */
  promo: number
  /** Euros: lo que pagó el comprador por el envío (está dentro de `ventas`) */
  envio: number
}

export interface PedidosLeidosVentas {
  lineas: LineaPedido[]
  canceladas: number
  descartadas: number
  /** Las de canales que no son de Amazon («Non-Amazon»): no son ventas de la cuenta */
  otrosCanales: number
}

const partir = (l: string) => l.replace(/\r$/, '').split('\t')
const num = (s: string | undefined): number | null => {
  const t = (s ?? '').trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export function parsearPedidosVentas(texto: string, mercadoPorDefecto: string, porEuro: Record<string, number>): PedidosLeidosVentas {
  const salida: PedidosLeidosVentas = { lineas: [], canceladas: 0, descartadas: 0, otrosCanales: 0 }
  const lineas = texto.split('\n').filter((l) => l.trim().length > 0)
  if (lineas.length < 2) return salida
  const cab = partir(lineas[0]).map((c) => c.trim().toLowerCase())
  const col = (n: string) => cab.indexOf(n)
  const i = {
    pedido: col('amazon-order-id'),
    fecha: col('purchase-date'),
    estado: col('order-status'),
    canal: col('fulfillment-channel'),
    venta: col('sales-channel'),
    sku: col('sku'),
    asin: col('asin'),
    estadoLinea: col('item-status'),
    cantidad: col('quantity'),
    moneda: col('currency'),
    precio: col('item-price'),
    envio: col('shipping-price'),
    regalo: col('gift-wrap-price'),
    promo: col('item-promotion-discount'),
    promoEnvio: col('ship-promotion-discount'),
  }
  if (i.pedido < 0 || i.fecha < 0 || i.sku < 0 || i.cantidad < 0) {
    throw new Error(`El informe de pedidos no trae las columnas esperadas (amazon-order-id, purchase-date, sku, quantity). Ha devuelto: ${cab.slice(0, 30).join(', ')}`)
  }
  const juntas = new Map<string, LineaPedido>()
  for (const l of lineas.slice(1)) {
    const c = partir(l)
    const val = (k: number) => (k >= 0 ? (c[k] ?? '').trim() : '')
    const estado = val(i.estado).toLowerCase()
    if (estado === 'cancelled' || val(i.estadoLinea).toLowerCase() === 'cancelled') {
      salida.canceladas++
      continue
    }
    const canalVenta = val(i.venta)
    if (canalVenta && /non-amazon/i.test(canalVenta)) {
      salida.otrosCanales++
      continue
    }
    const mercado = mercadoDeCanal(canalVenta) ?? mercadoPorDefecto
    const pedido = val(i.pedido)
    const sku = val(i.sku)
    const fecha = val(i.fecha)
    const unidades = num(val(i.cantidad))
    const dia = fecha ? diaEnZona(fecha, zonaDeMercado(mercado)) : null
    if (!pedido || !sku || !dia || unidades == null || unidades < 0 || unidades > 10_000) {
      salida.descartadas++
      continue
    }
    const moneda = val(i.moneda) || null
    const precio = num(val(i.precio))
    // Lo que paga el comprador por la línea: precio + envío + envoltorio (Sellerboard lo cuenta como venta)
    const cobrado = precio == null ? null : precio + (num(val(i.envio)) ?? 0) + (num(val(i.regalo)) ?? 0)
    const promo = Math.abs(num(val(i.promo)) ?? 0) + Math.abs(num(val(i.promoEnvio)) ?? 0)
    const canalTxt = val(i.canal).toLowerCase()
    const k = `${pedido}|${sku}`
    const previa = juntas.get(k)
    const ventas = cobrado == null ? null : r2(aEuros(cobrado, moneda, porEuro))
    const envio = r2(aEuros(num(val(i.envio)) ?? 0, moneda, porEuro))
    if (previa) {
      previa.unidades += unidades
      previa.envio = r2(previa.envio + envio)
      previa.ventas = previa.ventas == null || ventas == null ? (previa.ventas ?? ventas) : r2(previa.ventas + ventas)
      previa.promo = r2(previa.promo + aEuros(promo, moneda, porEuro))
      continue
    }
    juntas.set(k, {
      pedido,
      sku,
      marketplace_id: mercado,
      fecha: new Date(fecha).toISOString(),
      dia,
      asin: val(i.asin) || null,
      estado: estado || 'pending',
      canal: canalTxt === 'merchant' || canalTxt === 'mfn' ? 'fbm' : 'fba',
      unidades,
      ventas,
      promo: r2(aEuros(promo, moneda, porEuro)),
      envio,
    })
  }
  salida.lineas = [...juntas.values()].filter((l) => l.unidades > 0)
  return salida
}

/* ------------------------------------------------------------------ */
/* 2 · Los movimientos de dinero                                       */
/* ------------------------------------------------------------------ */

type Importe = { CurrencyAmount?: number; CurrencyCode?: string } | undefined

export interface TarifasDePedido {
  pedido: string
  sku: string
  marketplace_id: string
  dia: string
  referral: number
  fba: number
  otras: number
  /** Lo que pagó el comprador por la línea según Amazon (precio + IVA + envío…): sustituye a lo del informe de pedidos */
  cobrado: number
  /** Promociones, en positivo */
  promo: number
  /** Unidades enviadas (QuantityShipped): con ellas el historial se rehace solo con el dinero si el informe de pedidos no trae nada */
  unidades: number
}

export interface Movimiento {
  clave: string
  dia: string
  marketplace_id: string
  sku: string
  tipo: 'reembolso' | 'tarifa_cuenta' | 'ajuste' | 'tarifa_pedido' | 'publicidad'
  unidades: number
  importe: number
  extra: number
  extra_unidades: number
}

export interface DineroLeido {
  tarifas: TarifasDePedido[]
  movimientos: Movimiento[]
}

const REFERRAL = new Set(['Commission', 'VariableClosingFee', 'FixedClosingFee', 'DigitalServicesFee', 'DigitalServicesFeeFBA'])
const FBA = /^FBA/i
/** Las listas de movimientos que NO se suman: la publicidad (va por el informe de Ads) y lo que no es del negocio (préstamos, recobro de deudas, retenciones) */
const NO_SE_SUMAN = new Set(['ProductAdsPaymentEventList', 'LoanServicingEventList', 'DebtRecoveryEventList', 'TaxWithholdingEventList', 'PayWithAmazonEventList', 'ChargeRefundEventList'])

function eur(m: Importe, porEuro: Record<string, number>): number {
  if (!m || typeof m.CurrencyAmount !== 'number') return 0
  return aEuros(m.CurrencyAmount, m.CurrencyCode, porEuro)
}

/** Suma todos los importes {CurrencyAmount} que cuelgan de un objeto (para los movimientos de forma variable) */
function sumaProfunda(v: unknown, porEuro: Record<string, number>): number {
  if (Array.isArray(v)) return v.reduce((s, x) => s + sumaProfunda(x, porEuro), 0)
  if (!v || typeof v !== 'object') return 0
  const o = v as Record<string, unknown>
  if (typeof o.CurrencyAmount === 'number') return eur(o as Importe, porEuro)
  return Object.values(o).reduce<number>((s, x) => s + sumaProfunda(x, porEuro), 0)
}

/**
 * Lee UNA página de movimientos (payload.FinancialEvents). `zona` decide el día de los que no son de un mercado concreto. El resultado se puede volver a
 * leer sin duplicar: los movimientos llevan una `clave` estable y las tarifas se identifican por pedido + SKU.
 */
export function leerDinero(eventos: Record<string, unknown>, mercadoPorDefecto: string, porEuro: Record<string, number>, opciones: { publicidadFacturada?: boolean } = {}): DineroLeido {
  const salida: DineroLeido = { tarifas: [], movimientos: [] }
  const diaDe = (fecha: unknown, mercado: string) => (typeof fecha === 'string' ? diaEnZona(fecha, zonaDeMercado(mercado)) : null)

  for (const [lista, filas] of Object.entries(eventos)) {
    if (!Array.isArray(filas) || filas.length === 0) continue
    // El historial (más allá de lo que guarda Amazon Ads) toma la publicidad de las FACTURAS que Amazon cobra: por día de factura y sin producto
    if (lista === 'ProductAdsPaymentEventList' && opciones.publicidadFacturada) {
      for (const ev of filas as Array<Record<string, unknown>>) {
        const fecha = (ev.postedDate ?? ev.PostedDate) as string | undefined
        const dia = fecha ? diaDe(fecha, mercadoPorDefecto) : null
        const importe = -eur(ev.transactionValue as Importe, porEuro)
        if (!dia || !importe) continue
        salida.movimientos.push({ clave: `a|${String(ev.invoiceId ?? '')}|${String(fecha)}|${r2(importe)}`, dia, marketplace_id: mercadoPorDefecto, sku: '', tipo: 'publicidad', unidades: 0, importe: r2(importe), extra: 0, extra_unidades: 0 })
      }
      continue
    }
    if (NO_SE_SUMAN.has(lista)) continue

    if (lista === 'ShipmentEventList') {
      for (const ev of filas as Array<Record<string, unknown>>) {
        const pedido = String(ev.AmazonOrderId ?? '')
        const mercado = mercadoDeCanal(ev.MarketplaceName as string) ?? mercadoPorDefecto
        const dia = diaDe(ev.PostedDate, mercado)
        if (!pedido || !dia) continue
        for (const it of (ev.ShipmentItemList as Array<Record<string, unknown>>) ?? []) {
          const sku = String(it.SellerSKU ?? '')
          if (!sku) continue
          let referral = 0
          let fba = 0
          let otras = 0
          const unidades = Number(it.QuantityShipped ?? 0) || 0
          // Lo cobrado: todos los cargos (Principal, Tax, ShippingCharge, ShippingTax, GiftWrap…). La retención de IVA de Amazon (ItemTaxWithheldList) no
          // entra: es IVA, y el IVA ya se descuenta aparte
          const cobrado = ((it.ItemChargeList as Array<{ ChargeAmount?: Importe }>) ?? []).reduce((s2, x) => s2 + eur(x.ChargeAmount, porEuro), 0)
          const promo = -((it.PromotionList as Array<{ PromotionAmount?: Importe }>) ?? []).reduce((s2, x) => s2 + eur(x.PromotionAmount, porEuro), 0)
          for (const f of (it.ItemFeeList as Array<{ FeeType?: string; FeeAmount?: Importe }>) ?? []) {
            const v = eur(f.FeeAmount, porEuro)
            if (REFERRAL.has(f.FeeType ?? '')) referral += v
            else if (FBA.test(f.FeeType ?? '')) fba += v
            else otras += v
          }
          const previa = salida.tarifas.find((t) => t.pedido === pedido && t.sku === sku)
          if (previa) {
            previa.referral = r2(previa.referral + referral)
            previa.fba = r2(previa.fba + fba)
            previa.otras = r2(previa.otras + otras)
            previa.cobrado = r2(previa.cobrado + cobrado)
            previa.promo = r2(previa.promo + promo)
            previa.unidades += unidades
          } else salida.tarifas.push({ pedido, sku, marketplace_id: mercado, dia, referral: r2(referral), fba: r2(fba), otras: r2(otras), cobrado: r2(cobrado), promo: r2(promo), unidades })
        }
      }
      continue
    }

    if (lista === 'RefundEventList' || lista === 'GuaranteeClaimEventList' || lista === 'ChargebackEventList') {
      for (const ev of filas as Array<Record<string, unknown>>) {
        const pedido = String(ev.AmazonOrderId ?? '')
        const mercado = mercadoDeCanal(ev.MarketplaceName as string) ?? mercadoPorDefecto
        const dia = diaDe(ev.PostedDate, mercado)
        if (!dia) continue
        for (const it of (ev.ShipmentItemAdjustmentList as Array<Record<string, unknown>>) ?? []) {
          const sku = String(it.SellerSKU ?? '')
          const devuelto = -((it.ItemChargeAdjustmentList as Array<{ ChargeAmount?: Importe }>) ?? []).reduce((s, x) => s + eur(x.ChargeAmount, porEuro), 0)
          const promo = ((it.PromotionAdjustmentList as Array<{ PromotionAmount?: Importe }>) ?? []).reduce((s, x) => s + eur(x.PromotionAmount, porEuro), 0)
          const comisiones = ((it.ItemFeeAdjustmentList as Array<{ FeeAmount?: Importe }>) ?? []).reduce((s, x) => s + eur(x.FeeAmount, porEuro), 0)
          const unidades = Number(it.QuantityShipped ?? 1) || 1
          salida.movimientos.push({
            clave: `r|${pedido}|${sku}|${String(ev.PostedDate)}|${r2(devuelto)}`,
            dia,
            marketplace_id: mercado,
            sku,
            tipo: 'reembolso',
            unidades,
            // Lo devuelto al comprador neto de la promoción que también se le quita (en positivo)
            importe: r2(devuelto - promo),
            extra: r2(comisiones),
            extra_unidades: 0,
          })
        }
      }
      continue
    }

    // El resto: tarifas de la cuenta (almacenamiento, suscripción, cupones, ofertas, retiradas…) y ajustes (Amazon reembolsa inventario perdido o dañado)
    filas.forEach((ev, n) => {
      const o = ev as Record<string, unknown>
      const mercado = mercadoDeCanal((o.MarketplaceName ?? o.StoreName) as string) ?? mercadoPorDefecto
      const fecha = o.PostedDate ?? o.TransactionPostedDate ?? o.postedDate
      const dia = diaDe(fecha, mercado)
      if (!dia) return
      const importe = r2(sumaProfunda(o, porEuro))
      if (importe === 0) return
      const items = (o.AdjustmentItemList as Array<{ SellerSKU?: string; Quantity?: string }> | undefined) ?? []
      const sku = items.length === 1 ? (items[0].SellerSKU ?? '') : ''
      salida.movimientos.push({
        clave: `o|${lista}|${String(fecha)}|${String(o.AdjustmentType ?? o.FeeReason ?? o.SellerDealId ?? o.CouponId ?? '')}|${importe}|${n}`,
        dia,
        marketplace_id: mercado,
        sku,
        tipo: importe > 0 ? 'ajuste' : 'tarifa_cuenta',
        unidades: items.length === 1 ? Math.abs(Number(items[0].Quantity ?? 0)) || 0 : 0,
        importe,
        extra: 0,
        extra_unidades: 0,
      })
    })
  }
  return salida
}

/* ------------------------------------------------------------------ */
/* 3 · La publicidad por producto (Amazon Ads)                         */
/* ------------------------------------------------------------------ */

export function movimientosDePublicidad(filas: Array<Record<string, unknown>>, mercado: string, moneda: string | null, porEuro: Record<string, number>): Movimiento[] {
  const juntas = new Map<string, Movimiento>()
  for (const f of filas) {
    const dia = String(f.date ?? '').slice(0, 10)
    const sku = String(f.advertisedSku ?? '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !sku) continue
    const k = `p|${mercado}|${sku}|${dia}`
    const x = juntas.get(k) ?? { clave: k, dia, marketplace_id: mercado, sku, tipo: 'publicidad' as const, unidades: 0, importe: 0, extra: 0, extra_unidades: 0 }
    x.importe = r2(x.importe + aEuros(Number(f.cost ?? 0) || 0, moneda, porEuro))
    x.extra = r2(x.extra + aEuros(Number(f.sales1d ?? 0) || 0, moneda, porEuro))
    x.extra_unidades += Number(f.unitsSoldClicks1d ?? 0) || 0
    juntas.set(k, x)
  }
  return [...juntas.values()].filter((m) => m.importe !== 0 || m.extra !== 0)
}

/* ------------------------------------------------------------------ */
/* El resumen de cada día                                              */
/* ------------------------------------------------------------------ */

export interface LineaGuardada {
  pedido: string
  sku: string
  marketplace_id: string
  dia: string
  asin: string | null
  unidades: number
  ventas: number | null
  promo: number
  tarifa_referral: number | null
  tarifa_fba: number | null
  otras_tarifas: number | null
  tarifas_reales: boolean
  /** Pedido FBM (lo envía el vendedor) y lo cobrado por el envío: para el coste de envío (migración 349) */
  fbm?: boolean
  envio?: number | null
}

export interface FilaDia {
  marketplace_id: string
  sku: string
  dia: string
  asin: string | null
  unidades: number
  pedidos: number
  ventas: number
  promo: number
  tarifa_referral: number
  tarifa_fba: number
  otras_tarifas: number
  tarifas_estimadas: number
  reembolsos: number
  reembolsado: number
  comision_reembolso: number
  ajustes: number
  publicidad: number
  ventas_ppc: number
  unidades_ppc: number
  /** De los pedidos FBM: unidades, pedidos y lo cobrado por el envío (migración 349) */
  unidades_fbm: number
  pedidos_fbm: number
  envio_cobrado: number
}

/** Comisión de venta por defecto cuando un SKU todavía no tiene ninguna real: el 15 % de casi todas las categorías, CON el 21 % de IVA dentro, como
 *  vienen las reales (el panel les quita el IVA al sumar: lib/ventas/panel.ts) */
export const REFERRAL_POR_DEFECTO = 0.15 * 1.21

/**
 * Junta las líneas de pedido y los movimientos en una fila por país × SKU × día. Las líneas sin precio toman el precio medio de ese SKU; las que aún no
 * tienen sus tarifas reales las estiman con lo que Amazon ha cobrado a ese SKU (proporción de comisión y tarifa FBA por unidad) o, si nunca, un 15 %.
 */
export function resumirDias(lineas: readonly LineaGuardada[], movimientos: readonly Movimiento[]): FilaDia[] {
  // Lo aprendido de cada SKU con tarifas reales
  const aprendido = new Map<string, { ventas: number; referral: number; fba: number; otras: number; unidades: number }>()
  const precio = new Map<string, { ventas: number; unidades: number }>()
  for (const l of lineas) {
    const k = `${l.marketplace_id}|${l.sku}`
    if (l.ventas != null && l.unidades > 0) {
      const p = precio.get(k) ?? { ventas: 0, unidades: 0 }
      p.ventas += l.ventas
      p.unidades += l.unidades
      precio.set(k, p)
    }
    if (l.tarifas_reales && l.ventas != null && l.ventas > 0) {
      const a = aprendido.get(k) ?? { ventas: 0, referral: 0, fba: 0, otras: 0, unidades: 0 }
      a.ventas += l.ventas
      a.referral += l.tarifa_referral ?? 0
      a.fba += l.tarifa_fba ?? 0
      a.otras += l.otras_tarifas ?? 0
      a.unidades += l.unidades
      aprendido.set(k, a)
    }
  }

  const filas = new Map<string, FilaDia & { _pedidos: Set<string>; _fbm: Set<string> }>()
  const fila = (mercado: string, sku: string, dia: string, asin: string | null) => {
    const k = `${dia}|${mercado}|${sku}`
    let f = filas.get(k)
    if (!f) {
      f = { marketplace_id: mercado, sku, dia, asin, unidades: 0, pedidos: 0, ventas: 0, promo: 0, tarifa_referral: 0, tarifa_fba: 0, otras_tarifas: 0, tarifas_estimadas: 0, reembolsos: 0, reembolsado: 0, comision_reembolso: 0, ajustes: 0, publicidad: 0, ventas_ppc: 0, unidades_ppc: 0, unidades_fbm: 0, pedidos_fbm: 0, envio_cobrado: 0, _pedidos: new Set(), _fbm: new Set() }
      filas.set(k, f)
    }
    if (!f.asin && asin) f.asin = asin
    return f
  }

  for (const l of lineas) {
    const k = `${l.marketplace_id}|${l.sku}`
    const p = precio.get(k)
    const ventas = l.ventas ?? (p && p.unidades > 0 ? (p.ventas / p.unidades) * l.unidades : 0)
    const f = fila(l.marketplace_id, l.sku, l.dia, l.asin)
    f.unidades += l.unidades
    f._pedidos.add(l.pedido)
    if (l.fbm) {
      f.unidades_fbm += l.unidades
      f._fbm.add(l.pedido)
      f.envio_cobrado += l.envio ?? 0
    }
    f.ventas += ventas
    f.promo += l.promo
    if (l.tarifas_reales) {
      f.tarifa_referral += l.tarifa_referral ?? 0
      f.tarifa_fba += l.tarifa_fba ?? 0
      f.otras_tarifas += l.otras_tarifas ?? 0
    } else {
      const a = aprendido.get(k)
      const referral = a && a.ventas > 0 ? (a.referral / a.ventas) * ventas : -REFERRAL_POR_DEFECTO * ventas
      const fba = a && a.unidades > 0 ? (a.fba / a.unidades) * l.unidades : 0
      // Las demás por unidad (en FBM, el envío que Amazon retiene: ShippingHB)
      const otras = a && a.unidades > 0 ? (a.otras / a.unidades) * l.unidades : 0
      f.tarifa_referral += referral
      f.tarifa_fba += fba
      f.otras_tarifas += otras
      f.tarifas_estimadas += referral + fba + otras
    }
  }

  for (const m of movimientos) {
    if (m.tipo === 'publicidad') {
      const f = fila(m.marketplace_id, m.sku, m.dia, null)
      f.publicidad += m.importe
      f.ventas_ppc += m.extra
      f.unidades_ppc += m.extra_unidades
    } else if (m.tipo === 'reembolso') {
      const f = fila(m.marketplace_id, m.sku, m.dia, null)
      f.reembolsos += m.unidades
      f.reembolsado += m.importe
      f.comision_reembolso += m.extra
    } else if (m.tipo === 'tarifa_pedido') {
      // Tarifas reales de un pedido que ya no está entre las líneas guardadas: cuentan el día en que se cobran
      const f = fila(m.marketplace_id, m.sku, m.dia, null)
      f.otras_tarifas += m.importe
    } else {
      const f = fila(m.marketplace_id, m.sku, m.dia, null)
      if (m.tipo === 'ajuste') f.ajustes += m.importe
      else f.otras_tarifas += m.importe
    }
  }

  return [...filas.values()].map(({ _pedidos, _fbm, ...f }) => ({
    ...f,
    pedidos: _pedidos.size,
    pedidos_fbm: _fbm.size,
    envio_cobrado: r2(f.envio_cobrado),
    ventas: r2(f.ventas),
    promo: r2(f.promo),
    tarifa_referral: r2(f.tarifa_referral),
    tarifa_fba: r2(f.tarifa_fba),
    otras_tarifas: r2(f.otras_tarifas),
    tarifas_estimadas: r2(f.tarifas_estimadas),
    reembolsado: r2(f.reembolsado),
    comision_reembolso: r2(f.comision_reembolso),
    ajustes: r2(f.ajustes),
    publicidad: r2(f.publicidad),
    ventas_ppc: r2(f.ventas_ppc),
  }))
}

/* ------------------------------------------------------------------ */
/* Devoluciones de FBA (los motivos de los reembolsos)                 */
/* ------------------------------------------------------------------ */

export const INFORME_DEVOLUCIONES = 'GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA'

export interface Devolucion {
  pedido: string
  sku: string
  fecha: string
  lpn: string
  unidades: number
  motivo: string | null
  comentario: string | null
  estado: string | null
  disposicion: string | null
}

/** PURA. El informe de devoluciones de FBA (TSV con cabecera): una fila por devolución, sin nada del comprador más que su comentario */
export function parsearDevoluciones(texto: string): Devolucion[] {
  const filas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  if (filas.length < 2) return []
  const cab = filas[0].split('\t').map((h) => h.trim().toLowerCase())
  const i = (n: string) => cab.indexOf(n)
  const c = { fecha: i('return-date'), pedido: i('order-id'), sku: i('sku'), cantidad: i('quantity'), disp: i('detailed-disposition'), motivo: i('reason'), estado: i('status'), lpn: i('license-plate-number'), coment: i('customer-comments') }
  if (c.pedido < 0 || c.sku < 0 || c.fecha < 0) return []
  const val = (cols: string[], k: number) => (k >= 0 ? (cols[k] ?? '').trim() : '')
  const salida: Devolucion[] = []
  for (const l of filas.slice(1)) {
    const cols = l.split('\t')
    const pedido = val(cols, c.pedido)
    const sku = val(cols, c.sku)
    const t = Date.parse(val(cols, c.fecha))
    if (!pedido || !sku || !Number.isFinite(t)) continue
    salida.push({
      pedido,
      sku,
      fecha: new Date(t).toISOString(),
      lpn: val(cols, c.lpn),
      unidades: Math.max(1, Number(val(cols, c.cantidad)) || 1),
      motivo: val(cols, c.motivo) || null,
      comentario: val(cols, c.coment) || null,
      estado: val(cols, c.estado) || null,
      disposicion: val(cols, c.disp) || null,
    })
  }
  return salida
}

/** El motivo de Amazon (código) en español */
const MOTIVOS: Record<string, string> = {
  UNWANTED_ITEM: 'Ya no lo quiere',
  ORDERED_WRONG_ITEM: 'Pidió el artículo equivocado',
  DEFECTIVE: 'Defectuoso',
  QUALITY_UNACCEPTABLE: 'Calidad inaceptable',
  DAMAGED_BY_CARRIER: 'Llegó dañado (transporte)',
  DAMAGED_BY_FC: 'Llegó dañado (almacén de Amazon)',
  NOT_AS_DESCRIBED: 'No es como se describe',
  MISSING_PARTS: 'Faltan piezas o accesorios',
  FOUND_BETTER_PRICE: 'Encontró mejor precio',
  NO_REASON_GIVEN: 'Sin motivo',
  UNAUTHORIZED_PURCHASE: 'Compra no autorizada',
  NOT_COMPATIBLE: 'No es compatible',
  PART_NOT_COMPATIBLE: 'No es compatible',
  MISSED_ESTIMATED_DELIVERY: 'Llegó tarde',
  EXTRA_ITEM: 'Recibió un artículo de más',
  SWITCHEROO: 'Devolvió otro artículo',
  DID_NOT_LIKE_FABRIC: 'No le gustó el material',
  APPAREL_TOO_SMALL: 'Demasiado pequeño',
  APPAREL_TOO_LARGE: 'Demasiado grande',
  APPAREL_STYLE: 'No le gustó el estilo',
  EXCESSIVE_INSTALLATION: 'Montaje demasiado complicado',
  UNDELIVERABLE_REFUSED: 'No se pudo entregar (rechazado)',
  UNDELIVERABLE_UNKNOWN: 'No se pudo entregar',
  UNDELIVERABLE_INSUFFICIENT_ADDRESS: 'No se pudo entregar (dirección)',
  UNDELIVERABLE_FAILED_DELIVERY_ATTEMPTS: 'No se pudo entregar (ausente)',
  UNDELIVERABLE_CARRIER_MISS_SORTED: 'No se pudo entregar (transportista)',
  MISORDERED: 'Pidió el artículo equivocado',
  NEVER_ARRIVED: 'No le llegó',
  WRONG_ITEM: 'Le llegó otro artículo',
}
export function motivoEnEspanol(codigo: string | null | undefined): string {
  if (!codigo) return 'Sin motivo'
  const k = codigo.trim().toUpperCase().replace(/^CR-/, '')
  if (MOTIVOS[k]) return MOTIVOS[k]
  const t = k.replace(/_/g, ' ').toLowerCase()
  return t.charAt(0).toUpperCase() + t.slice(1)
}
