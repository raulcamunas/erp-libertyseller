/**
 * PRUEBAS DE LO PURO DE LA SECCIÓN «VENTAS» (useVentas.ts).
 *
 *   cd /Users/raulcamunas/Dev/ERP-remesas && npx tsx components/remesas/ventas/useVentas.prueba.ts
 */
import { ventasFba, type MovimientoVenta } from '@/lib/fba/ventas-fba'
import {
  calidadDeVentas,
  concentracion,
  csvDiario,
  csvTop,
  datosDelGrafico,
  kpisDeVentas,
  mejorPunto,
  nombreCsv,
  nombrePais,
  salidasConNombre,
  textoHasta,
  textoPeriodo,
  urlVentas,
} from './useVentas'
import { avisosDeBanda } from '../comun/estilo-plan'

let fallos = 0
const ok = (n: string, bien: boolean, d: unknown = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || d === '' ? '' : ` -> ${JSON.stringify(d)}`}`)
}

const HOY = '2026-11-15'
const sumar = (f: string, n: number) => {
  const d = new Date(`${f}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Libro de 800 días hacia atrás desde el 6 nov: A vende 2/día, B 1/día; 1 devolución cada 10 días; país ES y algo de DE
const LEIDO = '2026-11-06'
const movs: MovimientoVenta[] = []
for (let i = 0; i < 800; i++) {
  const f = sumar(LEIDO, -i)
  movs.push({ sku: 'A', fecha: f, tipo: 'Shipments', cantidad: -2, pais: i % 4 === 0 ? 'DE' : 'ES' })
  movs.push({ sku: 'B', fecha: f, tipo: 'Shipments', cantidad: -1, pais: 'ES' })
  if (i % 10 === 0) movs.push({ sku: 'A', fecha: f, tipo: 'CustomerReturns', cantidad: 1 })
}
const precios = new Map<string, number | null>([['A', 10], ['B', 20]])
const nombres = new Map<string, string | null>([['A', 'Producto A'], ['B', null]])
const desdeLargo = sumar(LEIDO, -799)

console.log('\n=== fechas, url y calidad ===')
const v30 = ventasFba(movs, precios, HOY, 30, desdeLargo, { leidoHasta: LEIDO, nombres })
ok('url', urlVentas('abc', 90) === '/api/fba/ventas?cliente=abc&dias=90')
ok('el periodo acaba el último día leído', v30.hasta === LEIDO, v30.hasta)
ok('«hasta el 6 nov»', textoHasta(v30, HOY) === 'hasta el 6 nov', textoHasta(v30, HOY))
ok('«hasta el … 2025» de otro año', textoHasta({ hasta: '2025-12-30' }, HOY) === 'hasta el 30 dic 2025')
ok('texto del periodo', textoPeriodo(30) === 'últimos 30 días' && textoPeriodo(365) === 'último año')

const cal = calidadDeVentas({ leidoHasta: LEIDO, leidoDesde: desdeLargo, mercado: 'A1RKKUPIHCS9HS', aviso: null }, HOY)
ok('calidad: 9 días de atraso, libro ok', cal.diasAtraso === 9 && cal.libro === 'ok' && cal.avisos.length === 0, cal)
ok('la banda lo pinta como provisional (> 7 días)', avisosDeBanda(cal, { hoy: HOY })[0]?.id === 'provisional', avisosDeBanda(cal, { hoy: HOY }))
const sinApi = calidadDeVentas({ leidoHasta: null, leidoDesde: null, mercado: null, aviso: 'Sin API de Amazon: no hay ventas leídas de este cliente' }, HOY)
ok('sin API: sinConexion y sin_leer, sin repetir el aviso', sinApi.sinConexion === true && sinApi.libro === 'sin_leer' && sinApi.avisos.length === 0, sinApi)
const sinLeer = calidadDeVentas({ leidoHasta: null, leidoDesde: null, mercado: 'A1RKKUPIHCS9HS', aviso: 'Las ventas no están leídas todavía: pide…' }, HOY)
ok('sin leer: un solo aviso en la banda', avisosDeBanda(sinLeer, { hoy: HOY }).length === 1 && sinLeer.sinConexion === false)
const conAviso = calidadDeVentas({ leidoHasta: '2026-11-14', leidoDesde: '2025-05-01', mercado: 'A1RKKUPIHCS9HS', aviso: 'Ventas hasta el 14 nov: la copia de España es la única con historia suficiente' }, HOY)
ok('el aviso de la lectura elegida pasa a la banda', conAviso.avisos.length === 1 && avisosDeBanda(conAviso, { hoy: HOY }).some((a) => a.texto.startsWith('Ventas hasta el 14 nov')))

console.log('\n=== KPI ===')
const k30 = kpisDeVentas(v30)
ok('unidades 30 d = 90', k30.unidades === 90, k30.unidades)
ok('€ 30 d = 30×(2×10 + 20) = 1.200', k30.euros === 1200, k30.euros)
ok('ud/día = 3', k30.udDia === 3, k30.udDia)
ok('devoluciones 3 y tasa 3,3 %', k30.devoluciones === 3 && k30.tasaDevolucion === 3.3, k30)
ok('anterior completo: 90 ud, 1.200 €, 3 ud/día', k30.anterior?.unidades === 90 && k30.anterior?.euros === 1200 && k30.anterior?.udDia === 3, k30.anterior)

const v365 = ventasFba(movs, precios, HOY, 365, desdeLargo, { leidoHasta: LEIDO })
const k365 = kpisDeVentas(v365)
ok('365 con 800 días de libro: anterior completo', v365.anteriorCompleto === true && k365.anterior !== null)
const v365corto = ventasFba(movs.filter((m) => m.fecha >= sumar(LEIDO, -539)), precios, HOY, 365, sumar(LEIDO, -539), { leidoHasta: LEIDO })
const k365corto = kpisDeVentas(v365corto)
ok('caso 61: libro de 540 días → sin anterior (no se compara)', v365corto.anteriorCompleto === false && k365corto.anterior === null && v365corto.totales.variacionUnidades === null)

const sinPrecio = ventasFba(movs, new Map(), HOY, 30, desdeLargo, { leidoHasta: LEIDO })
const kSin = kpisDeVentas(sinPrecio)
ok('sin precio: € null (no 0) y anterior € null', kSin.euros === null && kSin.anterior?.euros === null, kSin)

const vacio = ventasFba([], new Map(), HOY, 30, null, { leidoHasta: null })
const kVacio = kpisDeVentas(vacio)
ok('sin ventas: tasa null y sin anterior', kVacio.tasaDevolucion === null && kVacio.anterior === null && kVacio.unidades === 0)

console.log('\n=== gráfico ===')
const g30 = datosDelGrafico(v30)
ok('30 días: 30 puntos por día con anterior', g30.datos.length === 30 && !g30.porSemana && g30.anterior?.length === 30)
const g365 = datosDelGrafico(v365)
ok('365 días: por semanas (lunes)', g365.porSemana && g365.datos.length >= 52 && g365.datos.length <= 54 && g365.anterior !== null, g365.datos.length)
ok('las semanas empiezan en lunes', g365.datos.every((d) => new Date(`${d.fecha}T00:00:00Z`).getUTCDay() === 1))
ok('la suma semanal cuadra con el total', g365.datos.reduce((s, d) => s + d.unidades, 0) === v365.totales.unidades)
const g365corto = datosDelGrafico(v365corto)
ok('365 con libro corto: sin línea del anterior', g365corto.anterior === null)
const anteriorVacio = datosDelGrafico({ ...v30, anterior: v30.anterior.map((d) => ({ ...d, unidades: 0, euros: 0 })) })
ok('anterior todo a cero: no se pinta', anteriorVacio.anterior === null)
ok('mejor punto', mejorPunto([{ fecha: 'a', unidades: 1, euros: null }, { fecha: 'b', unidades: 5, euros: null }])?.fecha === 'b' && mejorPunto([]) === null)

console.log('\n=== top y almacenes ===')
ok('top ordenado: A primero con 60 ud y 2 ud/día', v30.top[0].sku === 'A' && v30.top[0].unidades === 60 && v30.top[0].udDia === 2)
ok('concentración top 1 = 66,7 %', concentracion(v30, 1) === 66.7, concentracion(v30, 1))
ok('concentración sin ventas = null', concentracion(vacio) === null)
ok('nombres de país', nombrePais('es') === 'España' && nombrePais('DE') === 'Alemania' && nombrePais('UK') === 'Reino Unido' && nombrePais('ZZ') === 'ZZ' && nombrePais('Sin país') === 'Sin país')
const sal = salidasConNombre(v30)
const totalSal = sal.reduce((s, x) => s + x.unidades, 0)
ok('salidas: ES delante de DE y suman las unidades', sal[0].pais === 'ES' && sal[1].pais === 'DE' && totalSal === v30.totales.unidades, sal)
ok('salidas: % que suma ~100', Math.abs(sal.reduce((s, x) => s + x.pct, 0) - 100) < 0.2)
ok('salidas vacías: lista vacía', salidasConNombre({ salidasPorAlmacen: [] }).length === 0 && salidasConNombre({ salidasPorAlmacen: [{ pais: 'ES', unidades: 0 }] }).length === 0)

console.log('\n=== CSV ===')
const c30 = csvDiario(v30)
ok('CSV diario: cabecera con anterior y 30 filas', c30.cabecera.length === 5 && c30.filas.length === 30, c30.cabecera)
ok('CSV diario: decimales con coma, anterior alineado', c30.filas[29][0] === LEIDO && c30.filas[29][3] === sumar(LEIDO, -30))
const cCorto = csvDiario(v365corto)
ok('CSV 365 corto: por semana y sin anterior', cCorto.cabecera[0] === 'Semana (lunes)' && cCorto.cabecera.length === 3)
const cTop = csvTop(v30)
ok('CSV top: % de unidades', cTop.filas[0][0] === 'A' && cTop.filas[0][5] === '66,7' && cTop.filas[1][1] === '', cTop.filas)
ok('nombre del CSV', nombreCsv('Creative Toys ñ', v30, 'top') === 'ventas-fba-creative-toys-n-30d-referencias-hasta-2026-11-06.csv', nombreCsv('Creative Toys ñ', v30, 'top'))

console.log(fallos === 0 ? '\nTodo bien.\n' : `\n${fallos} FALLO(S).\n`)
if (fallos > 0) process.exit(1)
