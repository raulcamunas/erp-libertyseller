/**
 * EL CONTEO DEL AUDITOR DE STOCK, SIN RED NI BASE DE DATOS.
 *
 *   npx tsx lib/auditor-stock/clasificar.prueba.ts
 */
import { cantidadValida, clasificar, diferencias, type DelEspejo, type ItemVivo } from './clasificar'
import { agruparPorHora, claveHora, type FilaResumen } from './horas'

let fallos = 0
function ok(que: string, real: unknown, esperado: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado)
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK  ' : 'MAL '}  ${que}${bien ? '' : `  (${JSON.stringify(real)} != ${JSON.stringify(esperado)})`}`)
}

const viv = (sku: string, quantity: number | null, isFba = false, asin: string | null = `B0${sku}`): [string, ItemVivo] => [
  sku,
  { sku, asin, quantity, isFba },
]
const esp = (sku: string, fbaCantidad: number | null, asin: string | null = null): [string, DelEspejo] => [
  sku,
  { sku, asin, fbaCantidad },
]

console.log('\n=== TRES RESULTADOS, NO DOS: sin dato NO es cero ===')
{
  const r = clasificar(
    ['a', 'b', 'c'],
    new Map([viv('a', 5), viv('b', 0), viv('c', null)]),
    new Map()
  )
  ok('a=5 con stock', r.conStock, 1)
  ok('b=0 sin stock', r.sinStock, 1)
  ok('c=null SIN DATO, no sin stock', r.sinDato, 1)
  ok('y c no suma como agotado', r.sinStock, 1)
  ok('unidades', r.unidades, 5)
}

console.log('\n=== UNA CANTIDAD ROTA NO SE REDONDEA A CERO NI SE ACEPTA ===')
for (const q of [-3, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
  const r = clasificar(['x'], new Map([viv('x', q)]), new Map())
  ok(`cantidad ${String(q)} -> sin dato`, [r.sinDato, r.sinStock, r.conStock, r.unidades], [1, 0, 0, 0])
}
ok('cantidadValida(0)', cantidadValida(0), true)
ok('cantidadValida(null)', cantidadValida(null), false)

console.log('\n=== LOS QUE AMAZON NO DEVUELVE SE CUENTAN APARTE, NO COMO AGOTADOS ===')
{
  const r = clasificar(['a', 'b', 'c', 'd'], new Map([viv('a', 1)]), new Map())
  ok('pedidos 4', r.pedidos, 4)
  ok('leidas 1', r.leidas, 1)
  ok('no vinieron 3', r.noVinieron, 3)
  ok('NO suman en sin stock', r.sinStock, 0)
  ok('y pedidos = leidas + no vinieron', r.pedidos === r.leidas + r.noVinieron, true)
}

console.log('\n=== FBA: LA CANTIDAD SALE DEL ESPEJO, Y VA MARCADA COMO FBA ===')
{
  const r = clasificar(
    ['f1', 'f2', 'f3', 'm1'],
    new Map([viv('f1', null, true), viv('f2', null, true), viv('f3', null, true), viv('m1', 7)]),
    new Map([esp('f1', 12), esp('f2', 0), esp('f3', null)])
  )
  ok('f1 FBA 12 con stock', r.detalle.find((d) => d[0] === 'f1'), ['f1', 'B0f1', 12, 'A'])
  ok('f2 FBA 0 sin stock', r.sinStock, 1)
  ok('f3 FBA nunca leida -> sin dato', r.sinDato, 1)
  ok('con stock FBM / FBA por separado', [r.conStockFbm, r.conStockFba], [1, 1])
  ok('m1 es del vendedor', r.detalle.find((d) => d[0] === 'm1')?.[3], 'M')
  ok('unidades = 12 + 7', r.unidades, 19)
}

console.log('\n=== EL ASIN: el de Amazon, y si no, el del espejo ===')
{
  const r = clasificar(
    ['a', 'b'],
    new Map([viv('a', 3, false, null), viv('b', 4, false, 'B0AAAA')]),
    new Map([esp('a', null, 'B0DELESPEJO')])
  )
  ok('sin ASIN en vivo -> el del espejo', r.detalle.find((d) => d[0] === 'a')?.[1], 'B0DELESPEJO')
  ok('con ASIN en vivo -> ese', r.detalle.find((d) => d[0] === 'b')?.[1], 'B0AAAA')
}

console.log('\n=== EL DETALLE VA DE MÁS A MENOS STOCK ===')
{
  const r = clasificar(['a', 'b', 'c'], new Map([viv('a', 2), viv('b', 30), viv('c', 2)]), new Map())
  ok('orden: 30, luego 2 y 2 por SKU', r.detalle.map((d) => d[0]), ['b', 'a', 'c'])
}

console.log('\n=== QUÉ SE MOVIÓ ENTRE DOS AUDITORÍAS ===')
{
  const anterior: [string, string | null, number, 'M'][] = [
    ['sigue', 'B0', 10, 'M'],
    ['se_agota', 'B0', 4, 'M'],
    ['baja_pero_sigue', 'B0', 9, 'M'],
    ['no_se_lee', 'B0', 6, 'M'],
    ['sin_dato_ahora', 'B0', 8, 'M'],
  ]
  const ahora = new Map<string, number | null>([
    ['sigue', 10],
    ['se_agota', 0],
    ['baja_pero_sigue', 3],
    ['nuevo', 5],
    ['sin_dato_ahora', null],
    // 'no_se_lee' no aparece: esta vez Amazon no lo ha devuelto
  ])
  const c = diferencias(anterior, ahora)
  ok('sale: solo el que se ha LEÍDO y tiene cero', c.salen, [['se_agota', 4]])
  ok('entra: el que pasa de cero a tener', c.entran, [['nuevo', 5]])
  ok('baja de 9 a 3 NO es una salida', c.salen.some((s) => s[0] === 'baja_pero_sigue'), false)
  ok('el que no se ha leído NO se cuenta como salida', c.salen.some((s) => s[0] === 'no_se_lee'), false)
  ok('el que viene sin dato NO se cuenta como salida', c.salen.some((s) => s[0] === 'sin_dato_ahora'), false)
}
{
  const c = diferencias([], new Map([['a', 3], ['b', 0]]))
  ok('sin auditoría anterior, todo con stock «entra»', c.entran, [['a', 3]])
}

console.log('\n=== LA HORA SE MIDE EN MADRID, NO EN UTC ===')
{
  // 30 de junio: Madrid es UTC+2. 12:30 UTC son las 14:30 en Madrid
  ok('verano: 12:30 UTC -> hora 14', claveHora('2026-06-30T12:30:00Z'), '2026-06-30 14')
  // 15 de enero: Madrid es UTC+1. 12:30 UTC son las 13:30
  ok('invierno: 12:30 UTC -> hora 13', claveHora('2026-01-15T12:30:00Z'), '2026-01-15 13')
  // Cruce de medianoche: 22:30 UTC en verano ya es el día siguiente en Madrid
  ok('cruza la medianoche', claveHora('2026-06-30T22:30:00Z'), '2026-07-01 00')
}

console.log('\n=== AGRUPAR POR HORAS ===')
{
  const f = (id: string, iso: string, con: number, estado: FilaResumen['estado'] = 'completa'): FilaResumen => ({
    id, creada_at: iso, estado, con_stock: con, sin_stock: 0, sin_dato: 0, unidades: 0, entran: null, salen: null,
  })
  const grupos = agruparPorHora([
    f('1', '2026-10-09T12:00:00Z', 100),
    f('2', '2026-10-09T12:15:00Z', 98),
    f('3', '2026-10-09T12:30:00Z', 40, 'parcial'),
    f('4', '2026-10-09T12:45:00Z', 95),
    f('5', '2026-10-09T13:00:00Z', 90),
  ])
  ok('dos horas', grupos.length, 2)
  ok('la más reciente primero', grupos[0].clave, '2026-10-09 15')
  const hora14 = grupos[1]
  ok('4 auditorías en la hora de las 14:00', hora14.filas.length, 4)
  ok('la más reciente primero dentro de la hora', hora14.filas[0].id, '4')
  ok('la «última» es la última COMPLETA', hora14.ultima?.id, '4')
  ok('delta = 95 - 100, y la parcial NO cuenta', hora14.delta, -5)
  ok('1 problema (la parcial)', hora14.problemas, 1)
  ok('una hora con una sola completa no tiene delta', grupos[0].delta, null)
  ok('rango', hora14.rango, '14:00–14:59')
}

console.log(fallos === 0 ? '\n  TODO CORRECTO\n' : `\n  ${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
