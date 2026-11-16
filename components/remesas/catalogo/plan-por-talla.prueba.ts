/**
 * PRUEBAS DE LA BASE DE DATOS CRUZADA CON EL PLAN (lo puro de C9).
 *
 *   cd /Users/raulcamunas/Dev/ERP-remesas && npx tsx components/remesas/catalogo/plan-por-talla.prueba.ts
 */
import type { FilaCatalogo } from '@/lib/fba/catalogo/tipos'
import { claveSku, curvaDeModelo, datoDeFila, datosPorSku, refsQueVendenFuera, resumenDeModelo, textoPlan, type LineaParaTalla } from './plan-por-talla'

let fallos = 0
const ok = (n: string, bien: boolean, d: unknown = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien ? '' : ` -> ${JSON.stringify(d)}`}`)
}

const fila = (talla: string, fbasku: string | null, extra: Partial<FilaCatalogo> = {}): FilaCatalogo => ({
  id: `id-${talla}`, ref: 'F0047', nombre: 'BURDEOS', talla, ean: null, fnsku: null, asin: null, fbasku, codArt: '047768', continuidad: true, precio: 89.9, nota: null, ...extra,
})

const linea = (sku: string, v: number, ventas90: number, previsto: number | null, extra: Partial<LineaParaTalla> = {}): LineaParaTalla => ({
  sku, vendibles: v, deCamino: 0, cantidad: 0, fuera: null, prioridad: 'este_mes', salirAntesDe: null,
  ritmo: { base: previsto, previsto, confianza: 'media', explicacion: 'x', origen: 'sku', ventas90 }, ...extra,
})

console.log('\n=== cruce por SKU ===')
ok('claveSku quita espacios y pasa a mayúsculas', claveSku(' fba047768-38 ') === 'FBA047768-38')
const lineas: LineaParaTalla[] = [
  linea('FBA047768-37', 2, 5, 0.06, { cantidad: 0, fuera: 'stock_de_sobra' }),
  linea('FBA047768-38', 0, 9, 0.1, { cantidad: 4, ritmo: { base: 0.1, previsto: 0.1, confianza: 'baja', explicacion: 'repartido', origen: 'modelo', ventas90: 9 }, salirAntesDe: '2026-12-03' }),
  linea('FBA047768-39', 1, 0, null, { cantidad: 0, fuera: 'talla_sin_ventas', ritmo: { base: null, previsto: null, confianza: 'sin_datos', explicacion: '', ventas90: 0 } }),
  linea('FBA999999-40', 3, 12, 0.13, { nombre: 'Fuera de la base', modelo: 'FBA999999', talla: '40' }),
  linea('FBA888888-41', 5, 0, null, { ritmo: { base: null, confianza: 'sin_datos', explicacion: '', ventas90: 0 } }),
]
const datos = datosPorSku(lineas)
ok('una entrada por línea', datos.size === 5, datos.size)
ok('cruza aunque el FBASKU de la base esté en minúsculas', datoDeFila(fila('38', 'fba047768-38'), datos)?.cantidad === 4)
ok('una talla sin FBASKU no cruza', datoDeFila(fila('42', null), datos) === null)
ok('el ritmo es el previsto', datos.get('FBA047768-38')?.ritmo === 0.1)
ok('el origen del ritmo repartido se conserva', datos.get('FBA047768-38')?.origenRitmo === 'modelo')

console.log('\n=== columna Plan ===')
const t38 = textoPlan(datos.get('FBA047768-38')!, true)
ok('con cantidad: «4 ud» y tono propone', t38.texto === '4 ud' && t38.tono === 'propone', t38)
ok('con cantidad: la fecha de salida en el detalle', t38.detalle === 'Tiene que salir antes del 3 dic', t38.detalle)
const t39 = textoPlan(datos.get('FBA047768-39')!, true)
ok('talla sin ventas: el motivo', t39.texto === 'Talla sin ventas en 180 días' && t39.tono === 'fuera', t39)
ok('stock de sobra: el motivo', textoPlan(datos.get('FBA047768-37')!, true).texto === 'Tiene stock de sobra')
ok('el cliente externo no ve el plan', textoPlan(datos.get('FBA047768-38')!, false).texto === '—')
ok('sin dato: guion con explicación', textoPlan(null, true).tono === 'nada' && !!textoPlan(null, true).detalle)
const cero = datosPorSku([linea('X-1', 3, 4, 0.1, { cantidad: 0, fuera: null })]).get('X-1')!
ok('cantidad 0 sin motivo: «Nada»', textoPlan(cero, true).texto === 'Nada')

console.log('\n=== curva de tallas del modelo ===')
const filas = [fila('39', 'FBA047768-39'), fila('37', 'FBA047768-37'), fila('38', 'FBA047768-38'), fila('40', null, { continuidad: false })]
const c = curvaDeModelo(filas, datos)
ok('ordena por talla', c.puntos.map((p) => p.talla).join(',') === '37,38,39,40', c.puntos.map((p) => p.talla))
ok('vendido 90 d del modelo = 5 + 9 + 0', c.vendido90 === 14, c.vendido90)
ok('en FBA = 2 + 0 + 1', c.enFba === 3, c.enFba)
ok('propuesto = 4 (el resto, fuera)', c.propuesto === 4, c.propuesto)
ok('ritmo del modelo = 0,06 + 0,1', c.ritmoModelo === 0.16, c.ritmoModelo)
const p38 = c.puntos.find((p) => p.talla === '38')!
ok('cuota de la 38 = 0,1 / 0,16', Math.abs((p38.cuota ?? 0) - 0.625) < 1e-9, p38.cuota)
ok('una talla repartida del modelo', c.tallasRepartidas === 1)
ok('la talla sin FBASKU sale sin cifras', c.puntos.find((p) => p.talla === '40')!.enFba === null)
ok('talla fuera del plan propone 0', c.puntos.find((p) => p.talla === '39')!.propuesto === 0)
ok('3 tallas con datos', c.conDatos === 3)
ok('hay ventas y propuesta', c.hayVentas && c.hayPropuesta)

const sinPlan = curvaDeModelo(filas, new Map())
ok('sin plan: sin ritmo ni ventas', sinPlan.ritmoModelo === null && sinPlan.vendido90 === null && sinPlan.conDatos === 0 && !sinPlan.hayVentas)

// Cliente externo: sin ventas90 ni cantidad
const delCliente = datosPorSku([{ sku: 'FBA047768-37', vendibles: 4, deCamino: 2, ritmo: { base: 0.2, confianza: 'media', explicacion: '' } }])
const cc = curvaDeModelo(filas, delCliente)
ok('cliente: en FBA sí, vendido y propuesto no', cc.enFba === 4 && cc.vendido90 === null && cc.propuesto === null, cc)

console.log('\n=== resumen para la tarjeta ===')
ok('resumen con plan', JSON.stringify(resumenDeModelo(filas, datos)) === JSON.stringify({ enFba: 3, propuesto: 4 }), resumenDeModelo(filas, datos))
ok('resumen sin plan = null', resumenDeModelo(filas, new Map()) === null)

console.log('\n=== referencias que venden fuera de la base (D5.5) ===')
const fuera = refsQueVendenFuera(lineas, filas)
ok('solo la que vende y no está', fuera.length === 1 && fuera[0].sku === 'FBA999999-40', fuera.map((f) => f.sku))
ok('lleva modelo y talla para prellenar', fuera[0].modelo === 'FBA999999' && fuera[0].talla === '40')
ok('sin ventas90, decide el ritmo', refsQueVendenFuera([linea('Z-1', 0, undefined as unknown as number, 0.3, { ritmo: { base: 0.3, confianza: 'baja', explicacion: '' } })], []).length === 1)
const orden = refsQueVendenFuera([linea('A', 0, 2, 0.1), linea('B', 0, 8, 0.1)], [])
ok('ordenadas por lo que venden', orden.map((f) => f.sku).join(',') === 'B,A')

console.log(fallos ? `\n${fallos} FALLAN\n` : '\nTodo bien\n')
process.exit(fallos ? 1 : 0)
