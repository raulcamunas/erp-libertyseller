/**
 * EL CONTRASTE AMAZON ↔ TIENDA, CON FILAS INVENTADAS.
 *
 *   npx tsx lib/prestashop/contraste.prueba.ts
 */
import { cruzar, divergencias, normalizarEan, type FilaAmazon } from './cruce'
import { unirStock } from './stock'

let fallos = 0
function ok(que: string, real: unknown, esperado: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado)
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK  ' : 'MAL '}  ${que}${bien ? '' : `  (${JSON.stringify(real)} != ${JSON.stringify(esperado)})`}`)
}

console.log('\n=== UNIR EL STOCK POR TALLA ===')
{
  const { filas, duplicadosStock } = unirStock(
    [
      // Producto 10, con tallas: la fila «0» es la SUMA y no debe contarse aparte
      { id_product: '10', id_product_attribute: '0', quantity: '7' },
      { id_product: '10', id_product_attribute: '101', quantity: '3' },
      { id_product: '10', id_product_attribute: '102', quantity: '4' },
      // Producto 20, SIN tallas: su stock es la fila «0»
      { id_product: '20', id_product_attribute: '0', quantity: '5' },
    ],
    [
      { id: '101', id_product: '10', ean13: '8435668577885', reference: '082476-36' },
      { id: '102', id_product: '10', ean13: '8435668577892', reference: '082476-37' },
    ],
    [
      { id: '10', ean13: '', reference: 'MOD10' },
      { id: '20', ean13: '8445472944322', reference: '085616' },
    ]
  )
  ok('3 filas: dos tallas y un producto sin tallas', filas.length, 3)
  ok('la talla 101 tiene 3', filas.find((f) => f.idComb === '101')?.cantidad, 3)
  ok('la talla 102 tiene 4', filas.find((f) => f.idComb === '102')?.cantidad, 4)
  ok('la suma de las tallas es 7, no 14: la fila «0» no se cuenta además', filas.filter((f) => f.idProducto === '10').reduce((n, f) => n + (f.cantidad ?? 0), 0), 7)
  ok('el producto 10 NO aparece como producto sin tallas', filas.some((f) => f.idProducto === '10' && f.idComb === '0'), false)
  ok('el producto 20 sí, con su fila «0»', filas.find((f) => f.idProducto === '20')?.cantidad, 5)
  ok('sin duplicados', duplicadosStock, 0)
}

console.log('\n=== UNA CANTIDAD QUE FALTA ES null, NO CERO ===')
{
  const { filas } = unirStock(
    [{ id_product: '1', id_product_attribute: '11', quantity: '' }],
    [
      { id: '11', id_product: '1', ean13: '8435668577885', reference: 'A' },
      { id: '12', id_product: '1', ean13: '8435668577892', reference: 'B' },
    ],
    []
  )
  ok('cantidad vacía -> null', filas.find((f) => f.idComb === '11')?.cantidad, null)
  ok('talla sin ninguna fila de stock -> null', filas.find((f) => f.idComb === '12')?.cantidad, null)
}

console.log('\n=== STOCK DUPLICADO (varias tiendas): no se suma ===')
{
  const { filas, duplicadosStock } = unirStock(
    [
      { id_product: '1', id_product_attribute: '11', quantity: '5', id_shop: '1' },
      { id_product: '1', id_product_attribute: '11', quantity: '5', id_shop: '2' },
    ],
    [{ id: '11', id_product: '1', ean13: '8435668577885', reference: 'A' }],
    []
  )
  ok('se queda con 5, no con 10', filas[0].cantidad, 5)
  ok('y cuenta el duplicado', duplicadosStock, 1)
}

console.log('\n=== EAN Y REFERENCIA VACÍOS SE QUEDAN EN null ===')
{
  const { filas } = unirStock([], [{ id: '1', id_product: '1', ean13: '', reference: '   ' }], [])
  ok('ean vacío -> null', filas[0].ean, null)
  ok('referencia en blanco -> null', filas[0].referencia, null)
}

console.log('\n=== NORMALIZAR EAN ===')
ok('EAN-13', normalizarEan('8435668577885'), '8435668577885')
ok('UPC de 12 = EAN-13 con un cero delante', normalizarEan('012345678905'), normalizarEan('0012345678905'))
ok('con guiones', normalizarEan('843-566-857-7885'), '8435668577885')
ok('demasiado corto', normalizarEan('1234'), null)
ok('vacío', normalizarEan(''), null)
ok('null', normalizarEan(null), null)
ok('todo ceros', normalizarEan('0000000000000'), null)

console.log('\n=== CRUZAR: POR EAN, Y SI NO POR REFERENCIA ===')
{
  const tienda = unirStock(
    [
      { id_product: '1', id_product_attribute: '11', quantity: '3' },
      { id_product: '1', id_product_attribute: '12', quantity: '0' },
      { id_product: '2', id_product_attribute: '21', quantity: '8' },
    ],
    [
      { id: '11', id_product: '1', ean13: '8435668577885', reference: '082476-36' },
      { id: '12', id_product: '1', ean13: '8435668577892', reference: '082476-37' },
      // Sin EAN en la tienda: solo se puede cruzar por referencia
      { id: '21', id_product: '2', ean13: '', reference: '085616-42' },
    ],
    []
  ).filas

  const amazon: FilaAmazon[] = [
    { sku: '082476-36', asin: 'B0A', ean: '8435668577885', cantidad: 3 },
    { sku: '082476-37', asin: 'B0B', ean: '8435668577892', cantidad: 2 },
    { sku: '085616-42', asin: 'B0C', ean: '8445472944322', cantidad: 8 },
    { sku: '999999-40', asin: 'B0D', ean: '8400000000000', cantidad: 1 },
  ]
  const { cruzados, sinCruce } = cruzar(amazon, tienda)
  ok('3 cruzados y 1 sin cruce', [cruzados.length, sinCruce.length], [3, 1])
  ok('el primero, por EAN', cruzados.find((c) => c.sku === '082476-36')?.via, 'ean')
  ok('el de la tienda sin EAN, por REFERENCIA', cruzados.find((c) => c.sku === '085616-42')?.via, 'referencia')
  ok('el que no existe en la tienda, sin cruce', sinCruce[0].sku, '999999-40')
}

console.log('\n=== UN EMPAREJAMIENTO DUDOSO NO SE COMPARA ===')
{
  const tienda = unirStock(
    [
      { id_product: '1', id_product_attribute: '11', quantity: '3' },
      { id_product: '2', id_product_attribute: '21', quantity: '0' },
    ],
    [
      // El MISMO EAN en dos tallas distintas de la tienda
      { id: '11', id_product: '1', ean13: '8435668577885', reference: 'X' },
      { id: '21', id_product: '2', ean13: '8435668577885', reference: 'Y' },
    ],
    []
  ).filas
  const { cruzados } = cruzar([{ sku: 'S', asin: null, ean: '8435668577885', cantidad: 5 }], tienda)
  ok('se cruza pero queda marcado como ambiguo', [cruzados.length, cruzados[0].ambiguo, cruzados[0].tienda], [1, true, null])
  const d = divergencias(cruzados)
  ok('y NO entra en ninguna divergencia', [d.sobreventa.length, d.ventaPerdida.length, d.distinta.length, d.ambiguos], [0, 0, 0, 1])
}

console.log('\n=== LAS DIVERGENCIAS ===')
{
  const c = (sku: string, amazon: number, tienda: number | null) => ({
    sku, asin: null, via: 'ean' as const, amazon, tienda, ambiguo: false,
  })
  const d = divergencias([
    c('sobreventa-1', 5, 0),
    c('sobreventa-2', 2, 0),
    c('perdida-1', 0, 9),
    c('distinta-1', 4, 6),
    c('distinta-2', 10, 1),
    c('igual-1', 3, 3),
    c('igual-2', 0, 0),
    c('sin-dato', 4, null),
    c('negativa', 2, -3),
  ])
  ok('sobreventa: Amazon tiene y la tienda no (incluye la negativa), de más a menos y por SKU en empate', d.sobreventa.map((x) => x.sku), ['sobreventa-1', 'negativa', 'sobreventa-2'])
  ok('venta perdida', d.ventaPerdida.map((x) => x.sku), ['perdida-1'])
  ok('cantidad distinta, la mayor diferencia primero', d.distinta.map((x) => x.sku), ['distinta-2', 'distinta-1'])
  ok('iguales (incluye 0 y 0)', d.iguales, 2)
  ok('sin dato en la tienda NO es sobreventa', d.sinDatoTienda, 1)
  ok('el negativo cuenta como 0, no como -3', d.sobreventa.find((x) => x.sku === 'negativa')?.tienda, 0)
}

console.log(fallos === 0 ? '\n  TODO CORRECTO\n' : `\n  ${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
