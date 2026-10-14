import { clasificarVerificacion, construirInforme, textoSlack, type EntradaVerificacion } from './verificacion-pura'

let fallos = 0
function ok(nombre: string, real: unknown, esperado: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado)
  if (!bien) fallos += 1
  console.log(`  ${bien ? 'OK  ' : 'FALLA'}  ${nombre}${bien ? '' : ` → ${JSON.stringify(real)} (esperado ${JSON.stringify(esperado)})`}`)
}
const e = (o: Partial<EntradaVerificacion>): EntradaVerificacion => ({ sku: 'A', anterior: 10, enviado: 8, actual: 8, ventas: 0, estadoEnvio: 'aceptado', ...o })
const r = (o: Partial<EntradaVerificacion>) => clasificarVerificacion(e(o)).resultado

console.log('=== CON DATOS DE VENTAS ===')
ok('hay lo enviado, sin ventas: correcto', r({}), 'ok')
ok('enviadas 8, vendidas 1, hay 7: correcto con ventas', r({ ventas: 1, actual: 7 }), 'ok_con_ventas')
ok('enviadas 8, vendidas 3 pero hay 7 (sigue siendo lo de antes menos 3): no aplicado', r({ ventas: 3, actual: 7, anterior: 7 }), 'no_aplicado')
ok('hay más de lo esperado: distinto', r({ ventas: 0, actual: 12 }), 'distinto')
ok('ventas que dejan a cero: correcto con ventas', r({ enviado: 2, ventas: 5, actual: 0 }), 'ok_con_ventas')
ok('hay menos de lo que explican las ventas: aviso, no fallo', r({ ventas: 1, actual: 4 }), 'bajo_probable_venta')

console.log('=== SIN DATOS DE VENTAS ===')
ok('hay lo enviado: correcto', r({ ventas: null }), 'ok')
ok('sigue exactamente como antes: no aplicado', r({ ventas: null, actual: 10 }), 'no_aplicado')
ok('hay más de lo enviado: distinto', r({ ventas: null, actual: 15, anterior: 3 }), 'distinto')
ok('hay menos de lo enviado: probable venta', r({ ventas: null, actual: 6 }), 'bajo_probable_venta')

console.log('=== CASOS ESQUINA ===')
ok('Amazon rechazó el cambio', r({ estadoEnvio: 'invalido', errorEnvio: 'ficha rota' }), 'rechazado')
ok('sin lectura: no verificable', r({ actual: null }), 'no_verificable')
ok('no se conocía el valor anterior y hay más: distinto, no «no aplicado»', r({ anterior: null, ventas: null, actual: 15 }), 'distinto')

console.log('=== INFORME ===')
const inf = construirInforme(
  [e({ sku: 'B' }), e({ sku: 'C', actual: 10 }), e({ sku: 'D', actual: 6 }), e({ sku: 'E', estadoEnvio: 'error', errorEnvio: 'x' })],
  { conVentas: true }
)
ok('cuatro verificados, dos fallos y un aviso', [inf.total, inf.fallos, inf.avisos], [4, 2, 1])
ok('los fallos van antes que los avisos', inf.filas.map((f) => f.sku), ['C', 'E', 'D'])
ok('lo correcto no ocupa fila', inf.filas.some((f) => f.sku === 'B'), false)
const t = textoSlack(inf, { cliente: 'Shoplamp', perfil: 'diario', minutos: 30 })
ok('el aviso dice que ha fallado', t.includes(':warning:') && t.includes('2 de 4'), true)
ok('el aviso nombra el SKU que falla', t.includes('`C`'), true)
const limpio = textoSlack(construirInforme([e({ sku: 'B' })], { conVentas: true }), { cliente: 'Lenobotics', perfil: 'diario', minutos: 30 })
ok('todo bien: marca verde', limpio.includes(':white_check_mark:'), true)
ok('el tope de filas del aviso se respeta y dice cuántas más hay', textoSlack(construirInforme(Array.from({ length: 30 }, (_, i) => e({ sku: `S${i}`, actual: 20 })), { conVentas: true }), { cliente: 'X', perfil: 'p', minutos: 30, maxFilas: 5 }).includes('…y 25 más.'), true)

console.log(fallos === 0 ? '\n  TODO CORRECTO' : `\n  ${fallos} FALLOS`)
if (fallos) process.exit(1)
