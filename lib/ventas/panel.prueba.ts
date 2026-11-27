import { ajustarPeriodo, periodosDe, rangoAComparar, rangoDePreajuste, totalizar, type FilaPanel } from './panel'
import { costePickPack } from './ajustes'
import { firmaSinFecha, leerDinero, parsearPedidosVentas, resumirDias } from './lectura'

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

console.log('=== ajustes de la cuenta (Configuración) ===')
{
  const fila = (dia: string, extra: Partial<FilaPanel> = {}): FilaPanel => ({ dia, mkt: 'A1RKKUPIHCS9HS', sku: 'X', asin: null, unidades: 1, pedidos: 1, ventas: 121, promo: 0, referral: -12.1, fba: -6.05, otras: 0, estimadas: 0, reembolsos: 0, reembolsado: 0, comisionReembolso: 0, ajustes: 0, publicidad: 10, ventasPpc: 0, unidadesPpc: 0, ...extra })
  const base = totalizar([fila('2026-11-10')], { pct: 21, porPais: false }, {})
  ok('sin ajustes, como siempre: IVA 21 y tarifas sin IVA', casi(base.iva, 21) && casi(base.tarifas, -15) && casi(base.publicidad, 10), JSON.stringify(base))
  const sinIva = totalizar([fila('2026-11-10')], { pct: 21, porPais: false, ivaVentas: false }, {})
  ok('«Considerar para IVA» apagado: sin IVA en las ventas', sinIva.iva === 0)
  const desde = totalizar([fila('2026-10-10'), fila('2026-11-10')], { pct: 21, porPais: false, ivaVentasDesde: '2026-11-01' }, {})
  ok('IVA desde el 1 de noviembre: solo la segunda', casi(desde.iva, 21))
  const tarifas = totalizar([fila('2026-11-10')], { pct: 21, porPais: false, tarifasConIva: false }, {})
  ok('tarifas sin IVA recuperable: se cuentan enteras', casi(tarifas.tarifas, -18.15))
  const pub = totalizar([fila('2026-11-10')], { pct: 21, porPais: false, ivaPublicidad: true }, {})
  ok('IVA local en publicidad: 10 → 12,10', casi(pub.publicidad, 12.1) && casi(pub.neto, base.neto - 2.1))
  const pp = totalizar([fila('2026-11-10', { pickpack: 3 })], { pct: 21, porPais: false }, {})
  ok('pick & pack se resta', casi(pp.pickpack, 3) && casi(pp.neto, base.neto - 3))
  const neto = totalizar([fila('2026-11-10')], { pct: 21, porPais: false, margenSobreNeto: true }, {})
  ok('margen sobre ventas netas (100 en vez de 121)', neto.margen != null && casi(neto.margen * 100, (base.neto / 100) * 100))
  ok('pick & pack: 2 pedidos de 3 uds., 1 € paquete, 0,50 € artículo', costePickPack({ pickPaquete: 1, pickArticulo: 0.5, pickPrimeros: null, pickPrecioPrimeros: null }, 2, 6) === 5)
  ok('pick & pack: el primer artículo a 0,80 y el resto a 0,50', costePickPack({ pickPaquete: 1, pickArticulo: 0.5, pickPrimeros: 1, pickPrecioPrimeros: 0.8 }, 2, 6) === 5.6)
}

console.log('=== baldosas a medida ===')
{
  const hoy = '2026-11-27'
  ok('último trimestre = jul–sep', JSON.stringify(rangoDePreajuste('ultimo_trimestre', hoy)) === '{"desde":"2026-07-01","hasta":"2026-09-30"}')
  ok('hace 2 meses = septiembre', rangoDePreajuste('hace2m', hoy).desde === '2026-09-01' && rangoDePreajuste('hace2m', hoy).hasta === '2026-09-30')
  ok('este año', rangoDePreajuste('este_anio', hoy).desde === '2026-01-01')
  const base = periodosDe('clasica', hoy, 0.5)[3]
  const a = ajustarPeriodo(base, { preajuste: 'este_trimestre' }, hoy)
  ok('el pronóstico cambiado a trimestre pierde la escala', a.desde === '2026-10-01' && a.hasta === hoy && !a.escala && a.ajustado === true && a.titulo === 'Este trimestre')
  const f = ajustarPeriodo(base, { desde: '2026-11-03', hasta: '2026-11-09' }, hoy)
  ok('rango propio', f.titulo === 'Rango propio' && f.desde === '2026-11-03')
  ok('sin ajuste, igual', ajustarPeriodo(base, undefined, hoy) === base)
}

console.log('=== las tarifas de servicio SIN fecha (almacenamiento, suscripción, retiradas) ===')
{
  const eur = (n: number) => ({ CurrencyAmount: n, CurrencyCode: 'EUR' })
  const eventos = {
    ServiceFeeEventList: [
      { FeeReason: 'FBA Storage Fee', FeeList: [{ FeeType: 'FBAStorageFee', FeeAmount: eur(-296.64) }] },
      { FeeList: [{ FeeType: 'Subscription', FeeAmount: eur(-39) }] },
      { AmazonOrderId: 'RET-1', SellerSKU: 'A', FeeList: [{ FeeType: 'FBARemovalFee', FeeAmount: eur(-1.2) }] },
      { AmazonOrderId: 'RET-1', SellerSKU: 'A', FeeList: [{ FeeType: 'FBARemovalFee', FeeAmount: eur(-1.2) }] },
    ],
  }
  const sin = leerDinero(eventos, 'A1RKKUPIHCS9HS', { EUR: 1 })
  ok('sin día del tramo se siguen descartando (historial)', sin.movimientos.length === 0)
  const d = leerDinero(eventos, 'A1RKKUPIHCS9HS', { EUR: 1 }, { diaSinFecha: '2026-11-10' })
  ok('con el día del tramo entran las cuatro', d.movimientos.length === 4 && d.movimientos.every((m) => m.dia === '2026-11-10' && m.tipo === 'tarifa_cuenta'), JSON.stringify(d.movimientos))
  ok('suman lo de Amazon', casi(d.movimientos.reduce((x, m) => x + m.importe, 0), -338.04))
  ok('dos retiradas iguales no se pisan', new Set(d.movimientos.map((m) => m.clave)).size === 4)
  const otra = leerDinero(eventos, 'A1RKKUPIHCS9HS', { EUR: 1 }, { diaSinFecha: '2026-11-11' })
  ok('releída otro día, misma firma (no se apunta dos veces)', otra.movimientos.every((m, i) => firmaSinFecha(m.clave) === firmaSinFecha(d.movimientos[i].clave)))
  ok('las claves con fecha no tienen firma', firmaSinFecha('o|AdjustmentEventList|2026-11-01|X|1|0') === null)
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
