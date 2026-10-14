import { aCentimos, diferenciasPrecio } from './precios'

let fallos = 0
function ok(nombre: string, real: unknown, esperado: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado)
  if (!bien) fallos += 1
  console.log(`  ${bien ? 'OK  ' : 'FALLA'}  ${nombre}${bien ? '' : ` → ${JSON.stringify(real)} (esperado ${JSON.stringify(esperado)})`}`)
}

console.log('=== PRECIOS DEL AUDITOR ===')
ok('9,13 son 913 céntimos, sin decimales raros', aCentimos(9.13), 913)
ok('16,13 tras sumar 7: 1613', aCentimos(9.13 + 7), 1613)
ok('sin precio no es un precio', [aCentimos(null), aCentimos(0), aCentimos(-3), aCentimos(NaN)], [null, null, null, null])

const antes = new Map([['A', 1000], ['B', 2000], ['C', 3000]])
const ahora = new Map([
  ['A', { asin: 'X', centimos: 1000 }], // igual
  ['B', { asin: 'Y', centimos: 2500 }], // sube
  ['C', { asin: 'Z', centimos: 1500 }], // baja
  ['D', { asin: 'W', centimos: 999 }], // nuevo: no es un cambio
])
const r = diferenciasPrecio(antes, ahora)
ok('dos cambios, uno sube y uno baja', [r.total, r.suben, r.bajan], [2, 1, 1])
ok('el de mayor salto va primero (C: −15 €)', r.cambios.map((c) => c[0]), ['C', 'B'])
ok('lleva antes y ahora', r.cambios[0], ['C', 'Z', 3000, 1500])
ok('se apunta lo nuevo y lo cambiado, no lo igual', r.aGuardar.map((x) => x[0]).sort(), ['B', 'C', 'D'])
ok('un SKU sin precio ahora no se compara', diferenciasPrecio(antes, new Map()).total, 0)
ok('el tope recorta la lista pero no el recuento', [diferenciasPrecio(antes, ahora, 1).cambios.length, diferenciasPrecio(antes, ahora, 1).total], [1, 2])

console.log(fallos === 0 ? '\n  TODO CORRECTO' : `\n  ${fallos} FALLOS`)
if (fallos) process.exit(1)
