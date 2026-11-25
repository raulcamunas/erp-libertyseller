/**
 * PRUEBAS DE LO QUE IMPIDE VENDER (lib/cumplimiento/bloqueos.ts), con mensajes reales de las cuentas.
 *   npx tsx lib/cumplimiento/bloqueos.prueba.ts
 */
import { bloqueoDe, resumirBloqueos } from './bloqueos'
import type { Incidencia } from './tipos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const ahora = new Date('2026-11-25T12:00:00Z')
const inc = (x: Partial<Incidencia>): Incidencia => ({ codigo: '0', gravedad: 'error', mensaje: '', atributos: [], categorias: [], acciones: [], exencion: null, tema: 'otros' as Incidencia['tema'], desde: '2026-11-01T00:00:00Z', ...x })
const fila = (sku: string, incidencias: Incidencia[], conStock = true) => ({ sku, asin: 'B0X', titulo: 't', marketplace_id: 'A1RKKUPIHCS9HS', con_stock: conStock, suprimido: true, incidencias, es_padre: false })

const precio = fila('P', [inc({ codigo: '18155', mensaje: 'El precio de venta está por debajo del umbral de precio mínimo.', acciones: ['LISTING_SUPPRESSED'], tema: 'precio' as Incidencia['tema'] })])
const doc = fila('D', [inc({ codigo: '100390', mensaje: 'Para vender este producto en el sitio web de Amazon, debes facilitar documentación relativa a la cuestión de política.', acciones: ['CATALOG_ITEM_REMOVED'], tema: 'normativa' as Incidencia['tema'] })])
const marca = fila('M', [inc({ codigo: '18146', mensaje: 'Uso indebido de marcas comerciales', acciones: ['CATALOG_ITEM_REMOVED'], tema: 'marca' as Incidencia['tema'] })])
const ean = fila('E', [inc({ codigo: '8572', mensaje: 'El ID de producto (ASIN, UPC, EAN, ISBN o JAN) que has proporcionado no coincide con los registros de nuestra marca.', acciones: ['LISTING_SUPPRESSED'], tema: 'identificadores' as Incidencia['tema'] })])
const aviso = fila('A', [inc({ codigo: '18448', gravedad: 'aviso', mensaje: 'A tu envío le faltan algunos atributos clave', tema: 'ficha' as Incidencia['tema'] })])
const futura = new Date(ahora.getTime() + 20 * 86_400_000).toISOString()
const riesgo = fila('R', [inc({ codigo: '100527', gravedad: 'aviso', mensaje: 'Para vender este producto en las tiendas de Amazon ubicadas en la UE, debes proporcionar información del fabricante.', exencion: { estado: 'EXEMPT', caduca: futura }, tema: 'normativa' as Incidencia['tema'] })])
const pasada = fila('V', [inc({ codigo: '100527', gravedad: 'aviso', mensaje: 'Para vender este producto en las tiendas de Amazon ubicadas en la UE, debes proporcionar información del fabricante antes del 2025-01-12T00:00:00.000Z', tema: 'normativa' as Incidencia['tema'] })])

ok('precio → grupo precio y bloquea', bloqueoDe(precio, ahora)?.grupo === 'precio' && bloqueoDe(precio, ahora)?.bloquea === true, JSON.stringify(bloqueoDe(precio, ahora)))
ok('documentación → seguridad', bloqueoDe(doc, ahora)?.grupo === 'seguridad', bloqueoDe(doc, ahora)?.grupo)
ok('marca → política', bloqueoDe(marca, ahora)?.grupo === 'politica', bloqueoDe(marca, ahora)?.grupo)
ok('código de barras → ficha (al final)', bloqueoDe(ean, ahora)?.grupo === 'ficha', bloqueoDe(ean, ahora)?.grupo)
ok('un aviso sin plazo no entra', bloqueoDe(aviso, ahora) === null)
ok('normativa con plazo en 20 días: en riesgo', bloqueoDe(riesgo, ahora)?.bloquea === false && bloqueoDe(riesgo, ahora)?.grupo === 'seguridad', JSON.stringify(bloqueoDe(riesgo, ahora)))
ok('normativa con plazo ya pasado y sin retirar: no entra', bloqueoDe(pasada, ahora) === null)
const dos = fila('X', [...ean.incidencias, ...precio.incidencias])
ok('con dos problemas manda el más urgente (precio antes que ficha)', bloqueoDe(dos, ahora)?.grupo === 'precio')
const r = resumirBloqueos([ean, precio, doc, aviso, { ...marca, con_stock: false }], 10, ahora)
ok('orden: precio, seguridad, política, ficha', r.listings.map((l) => l.grupo).join(',') === 'precio,seguridad,politica,ficha', r.listings.map((l) => l.grupo).join(','))
ok('vendibles con stock: 10 − 3 bloqueados con stock', r.conStockVendibles === 7, String(r.conStockVendibles))

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo bien')
process.exit(fallos ? 1 : 0)
