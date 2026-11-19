import { buyBox, conversion, diasDe, filasDelInforme, periodoDeComparacion, porJuego, semanaIso, semanasDisponibles, sumarTodas, veces, type FilaAgregada } from './calculo'
import { diasAPedir } from './sincronizar'

let fallos = 0
const ok = (n: string, bien: boolean, d: unknown = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien ? '' : ` -> ${JSON.stringify(d)}`}`)
}

console.log('\n=== semanas y periodos ===')
const w47 = semanaIso('2026-11-19')
ok('el 19 nov 2026 es de la W47 (16–22 nov)', w47.semana === 47 && w47.lunes === '2026-11-16' && w47.domingo === '2026-11-22', w47)
ok('el 1 ene 2026 es de la W1 de 2026', semanaIso('2026-01-01').semana === 1, semanaIso('2026-01-01'))
ok('el 29 dic 2025 es de la W1 de 2026', semanaIso('2025-12-29').anio === 2026 && semanaIso('2025-12-29').semana === 1, semanaIso('2025-12-29'))
const sem = semanasDisponibles('2026-11-01', '2026-11-18')
ok('semanas: de la más reciente a la más antigua, sin pasar del primer día', sem[0].desde === '2026-11-16' && sem[sem.length - 1].desde === '2026-10-26' && sem.length === 4, sem.map((s) => s.desde))
ok('periodo anterior de una semana', JSON.stringify(periodoDeComparacion('2026-11-09', '2026-11-15', 'anterior')) === JSON.stringify({ desde: '2026-11-02', hasta: '2026-11-08' }))
ok('mes anterior', JSON.stringify(periodoDeComparacion('2026-11-01', '2026-11-07', 'mes-anterior')) === JSON.stringify({ desde: '2026-10-01', hasta: '2026-10-31' }))
ok('hace un año', JSON.stringify(periodoDeComparacion('2026-11-01', '2026-11-07', 'anio-anterior')) === JSON.stringify({ desde: '2025-11-01', hasta: '2025-11-07' }))
ok('días de un periodo', diasDe('2026-10-30', '2026-11-02').join() === '2026-10-30,2026-10-31,2026-11-01,2026-11-02')

console.log('\n=== cifras ===')
const f = (asin: string, s: number, u: number, v = 0, bb = 0): FilaAgregada => ({ clave: 'total', asin, sesiones: s, navegador: s, app: 0, visitas: v, visitasBB: bb, unidades: u, pedidos: u, ventas: u * 20 })
const juegos = { B000000001: { juego: 'Dios, Hitler y Gandhi', producto: 'ES' }, B000000002: { juego: 'Dios, Hitler y Gandhi', producto: 'PT' }, B000000003: { juego: 'Poo Fighters', producto: null } }
const g = porJuego([f('B000000001', 100, 5, 200, 180), f('B000000002', 50, 1, 100, 100), f('B000000003', 1000, 1), f('B0UNKNOWN0', 10, 0)], juegos)
ok('suma ediciones en el mismo juego y lo marca', g.find((x) => x.juego === 'Dios, Hitler y Gandhi')?.cifras.sesiones === 150 && g.find((x) => x.juego === 'Dios, Hitler y Gandhi')?.varios === true, g)
ok('ordena por sesiones', g[0].juego === 'Poo Fighters', g.map((x) => x.juego))
ok('un ASIN sin juego sale con su ASIN', g.some((x) => x.juego === 'B0UNKNOWN0'))
const dh = g.find((x) => x.juego === 'Dios, Hitler y Gandhi')!.cifras
ok('conversión = unidades ÷ sesiones', Math.abs((conversion(dh) ?? 0) - 6 / 150) < 1e-9)
ok('Buy Box ponderado por visitas', Math.abs((buyBox(dh) ?? 0) - 280 / 300) < 1e-9)
ok('sin sesiones no hay conversión', conversion(sumarTodas([])) === null)
ok('veces: ×6,5', veces(6691.43, 1030) === '×6,5', veces(6691.43, 1030))
ok('veces: +58 %', veces(37.7, 23.85) === '+58 %', veces(37.7, 23.85))
ok('veces: ×32', veces(2435.7, 76.1) === '×32', veces(2435.7, 76.1))

console.log('\n=== el informe de Amazon ===')
const inf = filasDelInforme({ salesAndTrafficByAsin: [
  { parentAsin: 'B0PADRE001', childAsin: 'B0FK5X28D6', salesByAsin: { unitsOrdered: 3, totalOrderItems: 3, orderedProductSales: { amount: 59.97, currencyCode: 'EUR' } }, trafficByAsin: { sessions: 100, browserSessions: 90, mobileAppSessions: 10, pageViews: 150, buyBoxPercentage: 86.2 } },
  { childAsin: 'basura', salesByAsin: {}, trafficByAsin: {} },
] })
ok('lee sesiones, navegador/app, visitas, Buy Box, unidades y ventas', inf.length === 1 && inf[0].sesiones === 100 && inf[0].app === 10 && Math.abs(inf[0].visitasBB - 129.3) < 1e-9 && inf[0].ventas === 59.97 && inf[0].moneda === 'EUR', inf)

console.log('\n=== qué días se piden ===')
const ahora = Date.parse('2026-11-19T10:00:00Z')
const pedir = diasAPedir('2026-11-10', '2026-11-18', [
  { fecha: '2026-11-18', estado: 'hecho', report_id: null, pedido_at: null, leido_at: '2026-11-19T04:00:00Z', intentos: 0 },
  { fecha: '2026-11-17', estado: 'hecho', report_id: null, pedido_at: null, leido_at: '2026-11-18T04:00:00Z', intentos: 0 },
  { fecha: '2026-11-16', estado: 'pedido', report_id: 'x', pedido_at: '2026-11-19T09:58:00Z', leido_at: null, intentos: 0 },
  { fecha: '2026-11-14', estado: 'error', report_id: null, pedido_at: '2026-11-19T09:00:00Z', leido_at: null, intentos: 1 },
  { fecha: '2026-11-13', estado: 'error', report_id: null, pedido_at: '2026-11-19T01:00:00Z', leido_at: null, intentos: 1 },
  { fecha: '2026-11-12', estado: 'error', report_id: null, pedido_at: '2026-11-18T01:00:00Z', leido_at: null, intentos: 4 },
  { fecha: '2026-11-11', estado: 'hecho', report_id: null, pedido_at: null, leido_at: '2026-11-12T04:00:00Z', intentos: 0 },
], ahora)
ok('pide los que faltan, relee lo provisional de hace más de 20 h, reintenta errores viejos, y no lo demás', pedir.join() === '2026-11-17,2026-11-15,2026-11-13,2026-11-10', pedir)

console.log(fallos ? `\n${fallos} FALLOS\n` : '\nTodo bien\n')
if (fallos) process.exit(1)
