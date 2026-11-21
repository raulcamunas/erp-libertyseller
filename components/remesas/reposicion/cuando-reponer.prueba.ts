/**
 *   npx tsx components/remesas/reposicion/cuando-reponer.prueba.ts
 */
import { escalaCobertura, filasDeReposicion, semaforo, tramoDeLinea } from './cuando-reponer'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien ? '' : ` -> ${d}`}`)
}
const HOY = '2026-11-21'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const linea = (o: Record<string, unknown>): any => ({
  sku: 'A', nombre: 'Prod', modelo: null, talla: null, prioridad: 'mas_adelante', fuera: null, cantidad: 0, cajas: null, avisos: [], fechaRotura: null,
  fechaPrimerHueco: null, salirAntesDe: null, decidirAntesDe: null, coberturaDias: 40, coberturaConLoQueViene: 40, vendibles: 40, deCamino: 0,
  comprometido: 0, eurosEnRiesgo: null, eurosSiVaTarde: null, ...o,
})

ok('urgente con cantidad → ya', tramoDeLinea(linea({ prioridad: 'urgente', cantidad: 10 })) === 'ya')
ok('esta semana con cantidad → pronto', tramoDeLinea(linea({ prioridad: 'esta_semana', cantidad: 10 })) === 'pronto')
ok('más adelante → no', tramoDeLinea(linea({ prioridad: 'mas_adelante', cantidad: 10 })) === 'no')
ok('no cabe por capacidad y tarde → ya', tramoDeLinea(linea({ prioridad: 'tarde', cantidad: 0, avisos: ['recortada_capacidad'], fuera: 'cantidad_ridicula' })) === 'ya')
ok('sin ventas → aparte', tramoDeLinea(linea({ fuera: 'sin_ventas' })) === 'aparte')
ok('exceso → no', tramoDeLinea(linea({ fuera: 'exceso' })) === 'no')
ok('stock de sobra → no', tramoDeLinea(linea({ fuera: 'stock_de_sobra' })) === 'no')

const s = semaforo([linea({ prioridad: 'tarde', cantidad: 20, vendibles: 0, eurosEnRiesgo: 100.4, fechaRotura: HOY }), linea({ sku: 'B', prioridad: 'este_mes', cantidad: 5, decidirAntesDe: '2026-11-30', fechaRotura: '2026-12-20' }), linea({ sku: 'C', fuera: 'exceso' })], HOY)
ok('semáforo: 1 ya (agotada, 20 ud, 100 €), 1 pronto, 1 no con exceso', s.ya.referencias === 1 && s.ya.agotadas === 1 && s.ya.unidades === 20 && s.ya.euros === 100 && s.pronto.referencias === 1 && s.no.exceso === 1, JSON.stringify(s))
ok('próxima rotura evitable: la de después de hoy', s.proximaRoturaEvitable === '2026-12-20')

const tallas = filasDeReposicion([
  linea({ sku: 'Z-38', modelo: 'ZAPA', talla: '38', prioridad: 'urgente', cantidad: 6, fechaRotura: '2026-11-25' }),
  linea({ sku: 'Z-39', modelo: 'ZAPA', talla: '39', prioridad: 'este_mes', cantidad: 4, fechaRotura: '2026-12-10' }),
  linea({ sku: 'Z-40', modelo: 'ZAPA', talla: '40', fuera: 'stock_de_sobra' }),
  linea({ sku: 'OTRO', prioridad: 'esta_semana', cantidad: 3 }),
], HOY)
ok('tallas del mismo modelo: una fila; manda la peor; suma lo propuesto', tallas.length === 2 && tallas[0].titulo === 'ZAPA' && tallas[0].tramo === 'ya' && tallas[0].cantidad === 10 && tallas[0].tallas.length === 3, JSON.stringify(tallas[0]))
const hueco = filasDeReposicion([linea({ prioridad: 'urgente', cantidad: 5, fechaPrimerHueco: '2026-11-24', fechaRotura: '2026-12-15' })], HOY)
ok('hueco antes de la rotura (Shoplamp): 3 días', hueco[0].huecoDias === 3)
ok('escala con L = 10: 60 días', escalaCobertura({ hastaLaVenta: 10, margen: 7 }) === 60)
ok('escala con L = 67 (barco): 67 + M + 30', escalaCobertura({ hastaLaVenta: 67, margen: 10 }) === 107)

console.log(fallos === 0 ? '\n  TODO CORRECTO' : `\n  ${fallos} FALLOS`)
if (fallos) process.exit(1)
