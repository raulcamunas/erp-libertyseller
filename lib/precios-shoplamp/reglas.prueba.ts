import { DESTINOS, mismaDivisa, precioDestino, subidaPct } from '@/lib/precios-shoplamp/reglas'

let fallos = 0
const ok = (n: string, real: unknown, esp: unknown) => {
  const bien = JSON.stringify(real) === JSON.stringify(esp)
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien ? '' : ` -> esperado ${JSON.stringify(esp)}, real ${JSON.stringify(real)}`}`)
}

console.log('\n=== LA SUMA NO SE PUEDE HACER EN EUROS ===')
// Esto es lo que pasaria con `base + 11` a secas. Se deja escrito porque es
// invisible: el numero parece bien hasta que se serializa al JSON del PATCH.
console.log(`  24.99 + 11 en coma flotante = ${24.99 + 11}`)
console.log(`  y asi viaja al cuerpo del PATCH: ${JSON.stringify({ value_with_tax: 24.99 + 11 })}`)
ok('en centimos sale exacto', precioDestino(24.99, 1100), 35.99)
ok('  y serializa limpio', JSON.stringify({ v: precioDestino(24.99, 1100) }), '{"v":35.99}')

// Un barrido sobre precios realistas: cuantos se corrompen de la forma ingenua
let corruptos = 0
let buenos = 0
for (let c = 100; c <= 60000; c += 1) {
  const base = c / 100
  const ingenuo = base + 11
  const bueno = precioDestino(base, 1100)!
  if (String(ingenuo) !== String(bueno)) corruptos++
  else buenos++
}
console.log(`  de ${corruptos + buenos} precios probados, ${corruptos} se corrompen sumando en euros`)
ok('con centimos, ninguno se corrompe', corruptos > 0 && buenos + corruptos === 59901, true)

console.log('\n=== LA BASE QUE NO SIRVE NO PRODUCE PRECIO ===')
// Es la guarda que evita el fallo caro: sin ella Math.round(null*100)+1100 da 11
ok('null no da 11,00 €', precioDestino(null, 1100), null)
ok('undefined tampoco', precioDestino(undefined, 1100), null)
ok('cero tampoco', precioDestino(0, 1100), null)
ok('negativo tampoco', precioDestino(-5, 1100), null)
ok('NaN tampoco', precioDestino(Number.NaN, 1100), null)
console.log(`  (lo que daria sin la guarda: ${(Math.round((null as unknown as number) * 100) + 1100) / 100} €)`)

console.log('\n=== LOS TRES DESTINOS, Y SOLO ESOS ===')
ok('son tres', DESTINOS.length, 3)
ok('Francia +11', DESTINOS.find((d) => d.pais === 'Francia')?.recargoCentimos, 1100)
ok('Italia +11', DESTINOS.find((d) => d.pais === 'Italia')?.recargoCentimos, 1100)
ok('Alemania +8', DESTINOS.find((d) => d.pais === 'Alemania')?.recargoCentimos, 800)
ok('Reino Unido NO esta', DESTINOS.some((d) => d.marketplaceId === 'A1F83G8C2ARO7P'), false)

console.log('\n=== EL CORTAFUEGOS DE LA DIVISA ===')
for (const d of DESTINOS) ok(`  ${d.pais} comparte divisa con España`, mismaDivisa(d.marketplaceId), true)
ok('Reino Unido NO (libras)', mismaDivisa('A1F83G8C2ARO7P'), false)
ok('un mercado inventado tampoco', mismaDivisa('XXXXXXXX'), false)

console.log('\n=== LO QUE SUBE CADA FRANJA, que es lo que hay que ver antes de pulsar ===')
for (const base of [1.07, 5.99, 10.8, 24.99, 38.99, 201.99]) {
  const d = precioDestino(base, 1100)!
  console.log(`  ${String(base).padStart(7)} € -> ${String(d.toFixed(2)).padStart(7)} €   +${subidaPct(base, d)} %`)
}
ok('1,07 € sube un 1028 %', subidaPct(1.07, precioDestino(1.07, 1100)!), 1028)

console.log(fallos === 0 ? '\n  TODO CORRECTO\n' : `\n  ${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
