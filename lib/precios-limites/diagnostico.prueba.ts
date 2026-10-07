/**
 * LA REGLA DE LOS LÍMITES DE PRECIO, SIN RED NI BASE DE DATOS.
 *
 *   npx tsx lib/precios-limites/diagnostico.prueba.ts
 */
import { diagnosticar, tieneError, DESVIO_SOSPECHOSO } from './diagnostico'

let fallos = 0
function ok(que: string, real: unknown, esperado: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado)
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK  ' : 'MAL '}  ${que}${bien ? '' : `  (${JSON.stringify(real)} != ${JSON.stringify(esperado)})`}`)
}

console.log('\n=== LOS TRES CASOS DE LA CAPTURA DEL CLIENTE ===')
{
  // Precio 62,73 · mínimo 63,99 · máximo 75,90
  const a = diagnosticar({ precio: 62.73, precioMinimo: 63.99, precioMaximo: 75.9 })
  ok('62,73 con mínimo 63,99 -> bajo el mínimo', a.estado, 'bajo_minimo')
  ok('  el mínimo pasa a valer el precio', a.minimoNuevo, 62.73)
  ok('  el máximo NO se toca', a.maximoNuevo, null)

  const b = diagnosticar({ precio: 37.19, precioMinimo: 44.59, precioMaximo: 51.75 })
  ok('37,19 con mínimo 44,59 -> bajo el mínimo', [b.estado, b.minimoNuevo, b.maximoNuevo], ['bajo_minimo', 37.19, null])

  const c = diagnosticar({ precio: 53.72, precioMinimo: 56.99, precioMaximo: 65 })
  ok('53,72 con mínimo 56,99 -> bajo el mínimo', [c.estado, c.minimoNuevo, c.maximoNuevo], ['bajo_minimo', 53.72, null])
}

console.log('\n=== POR ENCIMA DEL MÁXIMO ===')
{
  const d = diagnosticar({ precio: 80, precioMinimo: 60, precioMaximo: 75.9 })
  ok('80 con máximo 75,90 -> sobre el máximo', d.estado, 'sobre_maximo')
  ok('  el máximo pasa a valer el precio', d.maximoNuevo, 80)
  ok('  el mínimo NO se toca', d.minimoNuevo, null)
}

console.log('\n=== LO QUE NO ES UN ERROR NO SE TOCA ===')
{
  ok('precio dentro del rango', diagnosticar({ precio: 70, precioMinimo: 60, precioMaximo: 75.9 }).estado, 'ok')
  ok('precio justo en el mínimo', diagnosticar({ precio: 60, precioMinimo: 60, precioMaximo: 75 }).estado, 'ok')
  ok('precio justo en el máximo', diagnosticar({ precio: 75, precioMinimo: 60, precioMaximo: 75 }).estado, 'ok')
  ok('sin límites ninguno', diagnosticar({ precio: 70, precioMinimo: null, precioMaximo: null }).estado, 'ok')
  ok('solo mínimo y está bien', diagnosticar({ precio: 70, precioMinimo: 60, precioMaximo: null }).estado, 'ok')
  ok('solo máximo y está bien', diagnosticar({ precio: 70, precioMinimo: null, precioMaximo: 80 }).estado, 'ok')
}

console.log('\n=== EL MÍNIMO O EL MÁXIMO QUE FALTAN NO SON UN ERROR ===')
{
  const x = diagnosticar({ precio: 50, precioMinimo: null, precioMaximo: 40 })
  ok('sin mínimo y precio sobre el máximo -> solo el máximo', [x.estado, x.minimoNuevo, x.maximoNuevo], ['sobre_maximo', null, 50])
  const y = diagnosticar({ precio: 30, precioMinimo: 40, precioMaximo: null })
  ok('sin máximo y precio bajo el mínimo -> solo el mínimo', [y.estado, y.minimoNuevo, y.maximoNuevo], ['bajo_minimo', 30, null])
}

console.log('\n=== SIN PRECIO NO HAY QUÉ COPIAR ===')
for (const p of [null, 0, -3, Number.NaN]) {
  const d = diagnosticar({ precio: p, precioMinimo: 60, precioMaximo: 75 })
  ok(`precio ${String(p)} -> sin_precio y no se toca nada`, [d.estado, d.minimoNuevo, d.maximoNuevo], ['sin_precio', null, null])
}
ok('un límite a cero no cuenta como límite', diagnosticar({ precio: 5, precioMinimo: 0, precioMaximo: 10 }).estado, 'ok')

console.log('\n=== MÍNIMO Y MÁXIMO CRUZADOS ===')
{
  // El mínimo por encima del máximo: el precio rompe los dos a la vez
  const d = diagnosticar({ precio: 50, precioMinimo: 60, precioMaximo: 40 })
  ok('mínimo 60, máximo 40, precio 50', [d.estado, d.minimoNuevo, d.maximoNuevo], ['ambos', 50, 50])
}

console.log('\n=== SE COMPARA EN CÉNTIMOS, NO EN DECIMALES ===')
{
  // 0,1 + 0,2 = 0.30000000000000004: comparado a pelo sería «sobre el máximo»
  ok('0,1+0,2 contra un máximo de 0,3', diagnosticar({ precio: 0.1 + 0.2, precioMinimo: 0.1, precioMaximo: 0.3 }).estado, 'ok')
  // El límite nuevo es el MISMO número, no una operación
  const d = diagnosticar({ precio: 24.99, precioMinimo: 30, precioMaximo: 40 })
  ok('el límite nuevo es exactamente el precio', Object.is(d.minimoNuevo, 24.99), true)
}

console.log('\n=== EL DESVÍO, PARA VER LO SOSPECHOSO ===')
{
  const pequeno = diagnosticar({ precio: 62.73, precioMinimo: 63.99, precioMaximo: 75.9 })
  ok('62,73 vs 63,99 -> menos de un 2 %', pequeno.desvio < 0.02, true)
  const grande = diagnosticar({ precio: 10, precioMinimo: 60, precioMaximo: 75 })
  ok('10 vs 60 -> 83 % y es sospechoso', [Math.round(grande.desvio * 100), grande.desvio > DESVIO_SOSPECHOSO], [83, true])
  ok('un listing sano tiene desvío cero', diagnosticar({ precio: 70, precioMinimo: 60, precioMaximo: 80 }).desvio, 0)
}

console.log('\n=== tieneError ===')
ok('bajo_minimo sí', tieneError(diagnosticar({ precio: 1, precioMinimo: 2, precioMaximo: null })), true)
ok('ok no', tieneError(diagnosticar({ precio: 3, precioMinimo: 2, precioMaximo: null })), false)
ok('sin_precio no', tieneError(diagnosticar({ precio: null, precioMinimo: 2, precioMaximo: null })), false)

console.log(fallos === 0 ? '\n  TODO CORRECTO\n' : `\n  ${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
