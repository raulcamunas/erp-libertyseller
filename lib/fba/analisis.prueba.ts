import { analizarProductos, construirSerie, matrizDeVentas, resumenDeRitmo, serieDeRemesa, ultimosDias } from './analisis'
import type { LineaDePanel, SkuDePanel } from './datos'

let fallos = 0
function ok(nombre: string, real: unknown, esperado: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado)
  if (!bien) fallos += 1
  console.log(`  ${bien ? 'OK  ' : 'FALLA'}  ${nombre}${bien ? '' : ` → ${JSON.stringify(real)} (esperado ${JSON.stringify(esperado)})`}`)
}

const linea = (sku: string, o: Partial<LineaDePanel>): LineaDePanel => ({
  sku, recibidas: 10, nombre: sku, variante: null, asin: null, referencia: null, fnsku: null, ean: null,
  enviadas: 10, consumidas: 0, devueltas: 0, quedan: 10, quedanVendibles: 10, retiradas: 0, mermas: 0, agotadaEl: null, porDia: {}, ...o,
})

console.log('=== SERIE DIARIA ===')
const s = construirSerie({ '2026-10-02': 3, '2026-10-04': 2 }, 10, '2026-10-01', '2026-10-05')
ok('cinco días, sin huecos', s.map((d) => d.fecha.slice(8)), ['01', '02', '03', '04', '05'])
ok('los días sin ventas son cero', s.map((d) => d.vendidas), [0, 3, 0, 2, 0])
ok('acumuladas', s.map((d) => d.acumuladas), [0, 3, 3, 5, 5])
ok('quedan = base menos lo vendido', s.map((d) => d.quedan), [10, 7, 7, 5, 5])
ok('una fecha futura no da serie', construirSerie({}, 10, '2026-10-09', '2026-10-05'), [])
ok('las ventas negativas (devoluciones) bajan el acumulado', construirSerie({ '2026-10-01': 4, '2026-10-02': -1 }, 10, '2026-10-01', '2026-10-02').map((d) => d.acumuladas), [4, 3])

console.log('=== ANÁLISIS POR PRODUCTO ===')
const hoy = '2026-10-10'
const lineas = [
  linea('RAPIDA', { consumidas: 7, quedan: 3, porDia: { '2026-10-08': 3, '2026-10-09': 2, '2026-10-10': 2 } }), // 7 en 7 días: 1/día, quedan 3 → 3 días
  linea('LENTA', { consumidas: 1, quedan: 99, porDia: { '2026-10-09': 1 } }), // 1/7 al día → 693 días
  linea('MUERTA', { consumidas: 2, quedan: 8, porDia: { '2026-08-01': 2 } }), // vendió hace meses
  linea('AGOTADA', { consumidas: 10, quedan: 0, porDia: { '2026-10-05': 10 } }),
]
const globales = new Map<string, SkuDePanel>()
const f = analizarProductos({ cuentaDesde: '2026-10-01', lineas }, globales, hoy)
const por = (sku: string) => f.find((x) => x.sku === sku)!
ok('la rápida: 3 días de stock', por('RAPIDA').cobertura, 3)
ok('la rápida se clasifica rápida', por('RAPIDA').clase, 'rapida')
ok('la lenta se clasifica lenta', por('LENTA').clase, 'lenta')
ok('sin ventas en 30 días: sin ventas, y sin cobertura', [por('MUERTA').clase, por('MUERTA').cobertura], ['sin_ventas', null])
ok('agotada gana a todo', por('AGOTADA').clase, 'sin_stock')
ok('se agota el día 13', por('RAPIDA').seAgotaEl, '2026-10-13')

console.log('=== RESUMEN DE RITMO ===')
const r = { cuentaDesde: '2026-10-01', quedan: 110, lineas, ventasPorDia: [{ fecha: '2026-10-08', vendidas: 3 }, { fecha: '2026-10-09', vendidas: 3 }, { fecha: '2026-10-10', vendidas: 2 }] }
const rr = resumenDeRitmo(r, f, hoy)
ok('ud/día de la última semana', rr.udDia7, Math.round((8 / 7) * 100) / 100)
ok('hay una referencia a menos de una semana de agotarse', rr.encaminoDeAgotarse, 1)
ok('una sin ventas y una agotada', [rr.sinVentas, rr.agotadas], [1, 1])
ok('serie de la remesa: diez días', serieDeRemesa(r, hoy).length, 10)

console.log('=== MATRIZ DE VENTAS ===')
const dias = ultimosDias(hoy, '2026-10-01', 3)
ok('los últimos 3 días', dias, ['2026-10-08', '2026-10-09', '2026-10-10'])
const m = matrizDeVentas(lineas, dias)
ok('la que más vendió, primero', m[0].sku, 'RAPIDA')
ok('sus valores por día', m[0].valores, [3, 2, 2])
ok('no pide más días de los que lleva', ultimosDias('2026-10-02', '2026-10-01', 30).length, 2)

console.log(fallos === 0 ? '\n  TODO CORRECTO' : `\n  ${fallos} FALLOS`)
if (fallos) process.exit(1)
