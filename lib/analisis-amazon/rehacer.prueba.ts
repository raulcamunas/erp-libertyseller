import assert from 'node:assert/strict'
import { listaValida, siguienteRehacer, trasRehacer, type ListaRehacer } from './rehacer'
const a = { lead: 'a', fila: '1', tienda: 'A', fase: 'primero' as const }
const b = { lead: 'b', fila: '2', tienda: 'B', fase: 'mezcla' as const }
const c = { lead: 'c', fila: '3', tienda: 'C', fase: 'mezcla' as const }
let l: ListaRehacer = { pendientes: [b, a, c] }
assert.equal(siguienteRehacer(l, true)?.lead, 'a', 'los de primero van antes, aunque estén detrás')
l = trasRehacer(l, a, null, 'x')
assert.equal(l.hechos, 1)
assert.equal(siguienteRehacer(l, true), null, 'tras un rehecho, toca uno nuevo')
assert.equal(siguienteRehacer(l, false)?.lead, 'b', 'sin nuevos, seguidos')
l = { ...l, ultimoFueRehacer: false }
assert.equal(siguienteRehacer(l, true)?.lead, 'b', 'tras uno nuevo, toca rehacer')
l = trasRehacer(l, b, 'web caída', 'x')
assert.deepEqual(l.pendientes.map((p) => p.lead), ['c'])
assert.equal(l.fallidos?.[0].motivo, 'web caída')
assert.deepEqual(listaValida(null).pendientes, [])
assert.equal(siguienteRehacer(listaValida({}), false), null)
console.log('rehacer: ok')
