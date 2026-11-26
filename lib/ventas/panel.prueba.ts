import { periodosDe, rangoAComparar, totalizar, type FilaPanel } from './panel'
import { leerDinero, parsearPedidosVentas, resumirDias } from './lectura'

let fallos = 0
const ok = (que: string, c: boolean, detalle = '') => {
  console.log(`  ${c ? 'OK   ' : 'FALLA'} ${que}${c ? '' : ` -> ${detalle}`}`)
  if (!c) fallos++
}
const casi = (a: number, b: number) => Math.abs(a - b) < 0.011

console.log('=== periodos ===')
{
  const p = periodosDe('clasica', '2026-11-26', 0.5)
  ok('cinco baldosas como Sellerboard', p.map((x) => x.id).join() === 'hoy,ayer,mes,pronostico,pasado')
  ok('el mes pasado es octubre entero', p[4].desde === '2026-10-01' && p[4].hasta === '2026-10-31')
  ok('el pronóstico escala 30 / 25,5 días', casi(p[3].escala as number, 30 / 25.5), String(p[3].escala))
  const anio = rangoAComparar(p[0], 'anio')
  ok('hoy se compara con el mismo día del año pasado', anio?.desde === '2025-11-26' && anio?.hasta === '2025-11-26')
  ok('el pronóstico, con el mes entero del año pasado', rangoAComparar(p[3], 'anio')?.hasta === '2025-11-30')
  ok('ayer con el periodo anterior es anteayer', rangoAComparar(p[1], 'anterior')?.desde === '2026-11-24')
  ok('el mes pasado con el anterior es septiembre entero', JSON.stringify(rangoAComparar(p[4], 'anterior')) === '{"desde":"2026-09-01","hasta":"2026-09-30"}')
  ok('este mes con el anterior: los mismos 26 días de octubre', JSON.stringify(rangoAComparar(p[2], 'anterior')) === '{"desde":"2026-10-01","hasta":"2026-10-26"}')
  const s = periodosDe('semanas', '2026-11-26', 0.5)
  ok('la semana empieza el lunes', s[0].desde === '2026-11-23' && s[1].desde === '2026-11-16' && s[1].hasta === '2026-11-22')
}

console.log('=== el beneficio (el ejemplo de Sellerboard: un jamón a 119,99 en Francia) ===')
{
  const f: FilaPanel = { dia: '2026-11-26', mkt: 'A13V1IB3VIYZZH', sku: 'MONTE 004 - FR', asin: 'B0', unidades: 1, pedidos: 1, ventas: 119.99, promo: 0, referral: -21.78, fba: 0, otras: 0, estimadas: -21.78, reembolsos: 0, reembolsado: 0, comisionReembolso: 0, ajustes: 0, publicidad: 0, ventasPpc: 0, unidadesPpc: 0 }
  const t = totalizar([f], 21, {})
  ok('la comisión que da Amazon con IVA (21,78) se descuenta sin él: 18,00, como Sellerboard', Math.abs(t.referral + 18) < 0.011, String(t.referral))
  ok('IVA 20,82 (el 21 % que va dentro del precio)', casi(t.iva, 20.82), String(t.iva))
  ok('ganancia neta 81,17, como Sellerboard', casi(t.neto, 81.17), String(t.neto))
  ok('margen 67,6 %', casi((t.margen as number) * 100, 67.65), String(t.margen))
  const conCoste = totalizar([f], 21, { 'MONTE 004 - FR': 40 })
  ok('con coste de 40 € la ganancia baja 40 y el ROI sale', casi(conCoste.neto, 41.17) && casi(conCoste.roi as number, 41.17 / 40))
  const reemb = totalizar([{ ...f, reembolsos: 1, reembolsado: 119.99, comisionReembolso: 17.424 }], 21, {})
  ok('un reembolso entero: el IVA se recupera y solo se pierde la comisión no devuelta', casi(reemb.iva, 0) && casi(reemb.neto, 119.99 - 18 - 119.99 + 14.4), String(reemb.neto))
}

console.log('=== el informe de pedidos ===')
{
  const cab = ['amazon-order-id', 'purchase-date', 'order-status', 'fulfillment-channel', 'sales-channel', 'sku', 'asin', 'item-status', 'quantity', 'currency', 'item-price', 'shipping-price', 'item-promotion-discount'].join('\t')
  const filas = [
    ['403-1', '2026-11-26T13:43:00+00:00', 'Pending', 'Merchant', 'Amazon.fr', 'MONTE 004 - FR', 'B0FMZWK26K', 'Unshipped', '1', 'EUR', '119.99', '', ''],
    ['403-2', '2026-11-26T12:00:00+00:00', 'Cancelled', 'Merchant', 'Amazon.fr', 'MONTE 004 - FR', 'B0FMZWK26K', 'Cancelled', '1', 'EUR', '119.99', '', ''],
    ['403-3', '2026-11-25T23:30:00+00:00', 'Shipped', 'Merchant', 'Amazon.co.uk', 'UK1', 'B0X', 'Shipped', '2', 'GBP', '85', '5', '10'],
    ['403-4', '2026-11-26T10:00:00+00:00', 'Pending', 'Merchant', 'Amazon.es', 'ES1', 'B0Y', 'Unshipped', '1', '', '', '', ''],
  ].map((f) => f.join('\t'))
  const r = parsearPedidosVentas([cab, ...filas].join('\n'), 'A1RKKUPIHCS9HS', { EUR: 1, GBP: 0.85 })
  ok('los cancelados no cuentan', r.canceladas === 1 && r.lineas.length === 3)
  const uk = r.lineas.find((l) => l.sku === 'UK1')
  ok('libras a euros con envío y la promoción aparte', uk != null && casi(uk.ventas as number, 90 / 0.85) && casi(uk.promo, 10 / 0.85), JSON.stringify(uk))
  ok('el día es el de Londres para el Reino Unido', uk?.dia === '2026-11-25')
  ok('un pendiente sin precio llega sin precio (se estima al resumir)', r.lineas.find((l) => l.sku === 'ES1')?.ventas === null)
}

console.log('=== los movimientos de dinero ===')
{
  const eur = (n: number) => ({ CurrencyAmount: n, CurrencyCode: 'EUR' })
  const d = leerDinero(
    {
      ShipmentEventList: [{ AmazonOrderId: '403-1', PostedDate: '2026-11-26T15:00:00Z', MarketplaceName: 'Amazon.fr', ShipmentItemList: [{ SellerSKU: 'MONTE 004 - FR', QuantityShipped: 1, ItemChargeList: [{ ChargeType: 'Principal', ChargeAmount: eur(99.17) }, { ChargeType: 'Tax', ChargeAmount: eur(20.82) }], ItemFeeList: [{ FeeType: 'Commission', FeeAmount: eur(-18) }, { FeeType: 'ShippingHB', FeeAmount: eur(-0.55) }] }] }],
      RefundEventList: [{ AmazonOrderId: '403-9', PostedDate: '2026-11-26T09:00:00Z', MarketplaceName: 'Amazon.es', ShipmentItemAdjustmentList: [{ SellerSKU: 'X', QuantityShipped: 1, ItemChargeAdjustmentList: [{ ChargeType: 'Principal', ChargeAmount: eur(-50) }], ItemFeeAdjustmentList: [{ FeeType: 'Commission', FeeAmount: eur(7.5) }, { FeeType: 'RefundCommission', FeeAmount: eur(-1.5) }] }] }],
      ProductAdsPaymentEventList: [{ postedDate: '2026-11-26T09:00:00Z', transactionValue: eur(-300) }],
      ServiceFeeEventList: [{ FeeList: [{ FeeType: 'Subscription', FeeAmount: eur(-47.19) }], PostedDate: '2026-11-20T00:00:00Z' }],
    },
    'A1RKKUPIHCS9HS',
    { EUR: 1 },
  )
  const t = d.tarifas[0]
  ok('lo cobrado es precio + IVA', casi(t.cobrado, 119.99), JSON.stringify(t))
  ok('comisión y envío retenido por separado', casi(t.referral, -18) && casi(t.otras, -0.55))
  const r = d.movimientos.find((m) => m.tipo === 'reembolso')
  ok('el reembolso: 50 devueltos y 6 € de comisiones que vuelven', r != null && casi(r.importe, 50) && casi(r.extra, 6), JSON.stringify(r))
  ok('la publicidad que cobra Amazon NO se suma (va por el informe de Ads)', !d.movimientos.some((m) => Math.abs(m.importe) === 300))
  ok('la suscripción es una tarifa de la cuenta', d.movimientos.some((m) => m.tipo === 'tarifa_cuenta' && casi(m.importe, -47.19) && m.sku === ''))
}

console.log('=== el resumen del día ===')
{
  const filas = resumirDias(
    [
      { pedido: 'a', sku: 'S', marketplace_id: 'M', dia: '2026-11-20', asin: 'B', unidades: 1, ventas: 100, promo: 0, tarifa_referral: -15, tarifa_fba: -5, otras_tarifas: 0, tarifas_reales: true },
      { pedido: 'b', sku: 'S', marketplace_id: 'M', dia: '2026-11-26', asin: 'B', unidades: 2, ventas: null, promo: 0, tarifa_referral: null, tarifa_fba: null, otras_tarifas: null, tarifas_reales: false },
    ],
    [],
  )
  const hoy = filas.find((f) => f.dia === '2026-11-26')
  ok('un pendiente sin precio toma el precio medio del SKU', hoy != null && casi(hoy.ventas, 200), JSON.stringify(hoy))
  ok('y estima comisión y tarifa FBA con lo que Amazon le cobró antes', hoy != null && casi(hoy.tarifa_referral, -30) && casi(hoy.tarifa_fba, -10) && casi(hoy.tarifas_estimadas, -40))
}

console.log(fallos ? `\n${fallos} FALLOS` : '\nTODO BIEN')
if (fallos) process.exit(1)
