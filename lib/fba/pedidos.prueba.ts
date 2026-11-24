import { diaEnZona, diasQueSeReemplazan, parsearPedidos, siguienteTramo } from '@/lib/fba/pedidos'

let fallos = 0
const ok = (n: string, bien: boolean, d: unknown = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien ? '' : ` -> ${JSON.stringify(d)}`}`)
}
const MAD = 'Europe/Madrid'

console.log('\n=== El informe de pedidos: se junta por día, SKU y canal; nada del comprador ===')
{
  const cab = ['amazon-order-id', 'purchase-date', 'order-status', 'fulfillment-channel', 'product-name', 'sku', 'asin', 'item-status', 'quantity', 'ship-city', 'ship-postal-code'].join('\t')
  const fila = (id: string, fecha: string, estado: string, canal: string, sku: string, asin: string, cant: string, linea = 'Shipped') =>
    [id, fecha, estado, canal, 'Zapatilla', sku, asin, linea, cant, 'Madrid', '28001'].join('\t')
  const texto = [
    cab,
    fila('1', '2026-11-20T10:00:00+00:00', 'Shipped', 'Merchant', '633372-41', 'B0772VF96V', '1'),
    fila('2', '2026-11-20T18:00:00+00:00', 'Pending', 'Merchant', '633372-41', 'B0772VF96V', '2'),
    fila('3', '2026-11-20T23:30:00+00:00', 'Shipped', 'Merchant', '633372-41', 'B0772VF96V', '1'), // 00:30 del 21 en Madrid
    fila('4', '2026-11-20T11:00:00+00:00', 'Shipped', 'Amazon', 'FBA633372-41', 'B0772VF96V', '1'),
    fila('5', '2026-11-20T12:00:00+00:00', 'Cancelled', 'Merchant', '633372-41', 'B0772VF96V', '0'),
    fila('6', '2026-11-20T12:00:00+00:00', 'Shipped', 'Merchant', '633372-41', 'B0772VF96V', '1', 'Cancelled'),
    fila('7', 'no-es-fecha', 'Shipped', 'Merchant', '633372-41', 'B0772VF96V', '1'),
  ].join('\n')
  const r = parsearPedidos(texto, MAD)
  const fbm20 = r.ventas.find((v) => v.fecha === '2026-11-20' && v.canal === 'fbm')
  ok('FBM del 20: 1 enviado + 2 pendientes = 3 (los pendientes son ventas)', fbm20?.unidades === 3, r.ventas)
  ok('el de las 23:30 UTC es del 21 en Madrid', r.ventas.some((v) => v.fecha === '2026-11-21' && v.canal === 'fbm' && v.unidades === 1), r.ventas)
  ok('el de Amazon es FBA, con su SKU', r.ventas.some((v) => v.canal === 'fba' && v.sku === 'FBA633372-41' && v.unidades === 1), r.ventas)
  ok('pedido o línea cancelados no cuentan', r.canceladas === 2, r)
  ok('una fecha ilegible se descarta y se cuenta', r.descartadas === 1, r)
  ok('el ASIN viaja con la venta', fbm20?.asin === 'B0772VF96V')
  ok('no se guarda nada del comprador (solo fecha, sku, asin, canal, unidades)', r.ventas.every((v) => Object.keys(v).sort().join(',') === 'asin,canal,fecha,sku,unidades'), r.ventas[0])
  let lanza = false
  try { parsearPedidos('a\tb\n1\t2', MAD) } catch { lanza = true }
  ok('sin las columnas que hacen falta, lanza (no se guardan ceros)', lanza)
}

console.log('\n=== Qué tramo pedir ===')
{
  const ahora = new Date('2026-11-24T10:00:00Z')
  const t0 = siguienteTramo({ leidoDesde: null, leidoHasta: null, leidoAt: null }, ahora)!
  ok('la primera vez, 6 meses atrás, de 30 en 30 días', t0.desde.toISOString() === '2026-05-28T00:00:00.000Z' && t0.hasta.toISOString() === '2026-06-27T00:00:00.000Z', t0)
  const t1 = siguienteTramo({ leidoDesde: '2026-05-29', leidoHasta: '2026-06-26', leidoAt: '2026-11-24T09:55:00Z' }, ahora)!
  ok('después, desde lo leído menos 3 días', t1.desde.toISOString() === '2026-06-23T00:00:00.000Z', t1)
  ok('al día y leído hace 2 h: nada', siguienteTramo({ leidoDesde: '2026-05-29', leidoHasta: '2026-11-24', leidoAt: '2026-11-24T08:00:00Z' }, ahora) === null)
  const t2 = siguienteTramo({ leidoDesde: '2026-05-29', leidoHasta: '2026-11-24', leidoAt: '2026-11-24T02:00:00Z' }, ahora)!
  ok('al día pero leído hace 8 h: se relee desde 3 días antes hasta ahora', t2.desde.toISOString() === '2026-11-21T00:00:00.000Z' && t2.hasta.getTime() > Date.parse('2026-11-24T09:50:00Z'), t2)
  const r2 = diasQueSeReemplazan(t2.desde, t2.hasta, MAD, ahora)
  ok('se reemplazan del 22 al 24 (el 21 queda a medias en Madrid y no se toca)', r2?.desde === '2026-11-22' && r2?.hasta === '2026-11-24', r2)
  const r0 = diasQueSeReemplazan(t0.desde, t0.hasta, MAD, ahora)
  ok('un tramo de la carga inicial no toca su último día (queda a medias)', r0?.desde === '2026-05-29' && r0?.hasta === '2026-06-26', r0)
  const ny = diasQueSeReemplazan(new Date('2026-11-21T00:00:00Z'), new Date('2026-11-24T09:55:00Z'), 'America/New_York', ahora)
  ok('en EE. UU. las 00:00 UTC son la tarde del día anterior: del 21 al 24', ny?.desde === '2026-11-21' && ny?.hasta === '2026-11-24', ny)
  ok('diaEnZona', diaEnZona('2026-11-20T23:30:00Z', MAD) === '2026-11-21' && diaEnZona('2026-11-21T03:00:00Z', 'America/New_York') === '2026-11-20')
}

console.log(fallos === 0 ? '\nTODO OK\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
