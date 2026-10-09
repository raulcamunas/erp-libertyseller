import {
  actuaElSuelo,
  DESTINOS,
  mismaDivisa,
  precioDestino,
  SUELO_DESTINO_CENTIMOS,
  subidaPct,
} from '@/lib/precios-shoplamp/reglas'

let fallos = 0
const ok = (n: string, real: unknown, esp: unknown) => {
  const bien = JSON.stringify(real) === JSON.stringify(esp)
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien ? '' : ` -> esperado ${JSON.stringify(esp)}, real ${JSON.stringify(real)}`}`)
}

console.log('\n=== LA SUMA NO SE PUEDE HACER EN EUROS ===')
// Esto es lo que pasaria con `base + 7` a secas. Se deja escrito porque es
// invisible: el numero parece bien hasta que se serializa al JSON del PATCH.
// Con bases POR ENCIMA del suelo: por debajo, el precio es 15 y no hay suma.
console.log(`  9.13 + 7 en coma flotante = ${9.13 + 7}`)
console.log(`  y asi viaja al cuerpo del PATCH: ${JSON.stringify({ value_with_tax: 9.13 + 7 })}`)
ok('en centimos sale exacto', precioDestino(9.13, 700), 16.13)
ok('  y serializa limpio', JSON.stringify({ v: precioDestino(9.13, 700) }), '{"v":16.13}')

// Un barrido sobre precios realistas: cuantos se corrompen de la forma ingenua
let corruptos = 0
let buenos = 0
// Desde 8,00 €: por debajo, el suelo de 15 € pisa la suma y compararla con la
// ingenua no mediria nada.
for (let c = 800; c <= 60000; c += 1) {
  const base = c / 100
  const ingenuo = base + 7
  const bueno = precioDestino(base, 700)!
  if (String(ingenuo) !== String(bueno)) corruptos++
  else buenos++
}
console.log(`  de ${corruptos + buenos} precios probados, ${corruptos} se corrompen sumando en euros`)
ok('con centimos, ninguno se corrompe', corruptos > 0 && buenos + corruptos === 59201, true)

console.log('\n=== LA BASE QUE NO SIRVE NO PRODUCE PRECIO ===')
// Es la guarda que evita el fallo caro: sin ella Math.round(null*100)+700 da 7
ok('null no da 7,00 €', precioDestino(null, 700), null)
ok('undefined tampoco', precioDestino(undefined, 700), null)
ok('cero tampoco', precioDestino(0, 700), null)
ok('negativo tampoco', precioDestino(-5, 700), null)
ok('NaN tampoco', precioDestino(Number.NaN, 700), null)
console.log(`  (lo que daria sin la guarda: ${(Math.round((null as unknown as number) * 100) + 700) / 100} €)`)

console.log('\n=== EL SUELO: NADA POR DEBAJO DE 15 € FUERA DE ESPAÑA ===')
ok('el suelo son 1.500 céntimos', SUELO_DESTINO_CENTIMOS, 1500)
// El ejemplo del cliente: 1 € en España, +6 en Alemania = 7, y tiene que ser 15
ok('1 € en Alemania (+6) -> 15, no 7', precioDestino(1, 600), 15)
ok('1,07 € en Francia (+7) -> 15, no 8,07', precioDestino(1.07, 700), 15)
ok('5 € en Italia (+7) -> 15, no 12', precioDestino(5, 700), 15)
ok('8,99 € en Alemania (+6 = 14,99) -> 15', precioDestino(8.99, 600), 15)
ok('9 € en Alemania (+6 = 15,00) -> 15, justo en el suelo', precioDestino(9, 600), 15)
ok('9,01 € en Alemania (+6 = 15,01) -> 15,01, por encima no cambia', precioDestino(9.01, 600), 15.01)
ok('8 € en Francia (+7 = 15,00) -> 15', precioDestino(8, 700), 15)
ok('8,01 € en Francia (+7 = 15,01) -> 15,01', precioDestino(8.01, 700), 15.01)
ok('20 € en Francia -> 27, el suelo no toca lo que ya pasa', precioDestino(20, 700), 27)
ok('200 € en Alemania -> 206', precioDestino(200, 600), 206)

// EL FALLO CARO: el suelo NO puede inventar un precio donde no hay base
ok('null NO se convierte en 15 €', precioDestino(null, 700), null)
ok('undefined NO se convierte en 15 €', precioDestino(undefined, 700), null)
ok('cero NO se convierte en 15 €', precioDestino(0, 700), null)
ok('negativo NO se convierte en 15 €', precioDestino(-5, 600), null)
ok('NaN NO se convierte en 15 €', precioDestino(Number.NaN, 700), null)

// Barrido: ningún destino baja de 15, y nunca sale un céntimo sucio
let porDebajo = 0
let sucios = 0
let cambiaSobre = 0
for (let c = 1; c <= 60000; c += 1) {
  const base = c / 100
  for (const d of DESTINOS) {
    const p = precioDestino(base, d.recargoCentimos)!
    if (p < 15) porDebajo++
    if (Math.abs(p * 100 - Math.round(p * 100)) > 1e-9) sucios++
    // Por encima del suelo el resultado es EXACTAMENTE base + recargo
    if (Math.round(base * 100) + d.recargoCentimos >= 1500 && Math.round(p * 100) !== Math.round(base * 100) + d.recargoCentimos) cambiaSobre++
  }
}
ok('de 0,01 a 600 € y en los tres países: ni un precio por debajo de 15', porDebajo, 0)
ok('  y ninguno con céntimos sucios', sucios, 0)
ok('  y por encima del suelo no se toca nada', cambiaSobre, 0)

console.log('\n=== actuaElSuelo: PARA SABER SI LO HA PUESTO EL SUELO O EL RECARGO ===')
ok('1,07 € +7 -> lo pone el suelo', actuaElSuelo(1.07, 700), true)
ok('8,99 € +6 -> lo pone el suelo', actuaElSuelo(8.99, 600), true)
ok('9,00 € +6 = 15,00 justo -> NO, lo pone el recargo', actuaElSuelo(9, 600), false)
ok('20 € +7 -> NO', actuaElSuelo(20, 700), false)
ok('sin base -> NO (no hay precio, no hay suelo)', actuaElSuelo(null, 700), false)
ok('cero -> NO', actuaElSuelo(0, 700), false)

console.log('\n=== LOS TRES DESTINOS, Y SOLO ESOS ===')
ok('son tres', DESTINOS.length, 3)
ok('Francia +7', DESTINOS.find((d) => d.pais === 'Francia')?.recargoCentimos, 700)
ok('Italia +7', DESTINOS.find((d) => d.pais === 'Italia')?.recargoCentimos, 700)
ok('Alemania +6', DESTINOS.find((d) => d.pais === 'Alemania')?.recargoCentimos, 600)
ok('Reino Unido NO esta', DESTINOS.some((d) => d.marketplaceId === 'A1F83G8C2ARO7P'), false)

console.log('\n=== EL CORTAFUEGOS DE LA DIVISA ===')
for (const d of DESTINOS) ok(`  ${d.pais} comparte divisa con España`, mismaDivisa(d.marketplaceId), true)
ok('Reino Unido NO (libras)', mismaDivisa('A1F83G8C2ARO7P'), false)
ok('un mercado inventado tampoco', mismaDivisa('XXXXXXXX'), false)

console.log('\n=== LO QUE SUBE CADA FRANJA, que es lo que hay que ver antes de pulsar ===')
for (const base of [1.07, 5.99, 10.8, 24.99, 38.99, 201.99]) {
  const d = precioDestino(base, 700)!
  console.log(`  ${String(base).padStart(7)} € -> ${String(d.toFixed(2)).padStart(7)} €   +${subidaPct(base, d)} %`)
}
// Antes del suelo eran 8,07 € y +654,2 %. Ahora la peor del catálogo va a 15 €.
ok('1,07 € sube un 1301,9 %', subidaPct(1.07, precioDestino(1.07, 700)!), 1301.9)

console.log(fallos === 0 ? '\n  TODO CORRECTO\n' : `\n  ${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
