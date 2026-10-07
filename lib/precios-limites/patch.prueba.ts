/**
 * EL CUERPO DEL PATCH QUE IRÍA A AMAZON, SIN LLAMAR A AMAZON.
 *
 *   npx tsx lib/precios-limites/patch.prueba.ts
 */
import { patchLimitesPrecio, patchIsRepeatable } from '@/lib/amazon/sp-api'

let fallos = 0
function ok(que: string, real: unknown, esperado: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado)
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK  ' : 'MAL '}  ${que}${bien ? '' : `\n         real:     ${JSON.stringify(real)}\n         esperado: ${JSON.stringify(esperado)}`}`)
}

const ES = 'A1RKKUPIHCS9HS'

console.log('\n=== SOLO EL MÍNIMO (el caso de la captura: 62,73 con mínimo 63,99) ===')
{
  const p = patchLimitesPrecio(ES, { precio: 62.73, currency: 'EUR', minimo: 62.73, maximo: null })
  console.log('   ' + JSON.stringify(p))
  ok('una sola operación', p.length, 1)
  ok('es un merge, NO un replace', p[0].op, 'merge')
  ok('sobre purchasable_offer', p[0].path, '/attributes/purchasable_offer')
  const o = (p[0].value as Record<string, unknown>[])[0]
  ok('lleva el mínimo nuevo', o.minimum_seller_allowed_price, [{ schedule: [{ value_with_tax: 62.73 }] }])
  ok('NO lleva máximo: no se toca el del vendedor', 'maximum_seller_allowed_price' in o, false)
  ok('reenvía el precio tal cual', o.our_price, [{ schedule: [{ value_with_tax: 62.73 }] }])
  ok('NO lleva rebaja: con merge se conserva la que haya', 'discounted_price' in o, false)
}

console.log('\n=== SOLO EL MÁXIMO ===')
{
  const o = (patchLimitesPrecio(ES, { precio: 80, currency: 'EUR', minimo: null, maximo: 80 })[0].value as Record<string, unknown>[])[0]
  ok('lleva el máximo nuevo', o.maximum_seller_allowed_price, [{ schedule: [{ value_with_tax: 80 }] }])
  ok('NO lleva mínimo', 'minimum_seller_allowed_price' in o, false)
}

console.log('\n=== LOS DOS A LA VEZ ===')
{
  const o = (patchLimitesPrecio(ES, { precio: 50, currency: 'EUR', minimo: 50, maximo: 50 })[0].value as Record<string, unknown>[])[0]
  ok('lleva los dos', ['minimum_seller_allowed_price', 'maximum_seller_allowed_price'].every((k) => k in o), true)
}

console.log('\n=== QUÉ VIAJA EN CADA CAMPO ===')
{
  const o = (patchLimitesPrecio('A13V1IB3VIYZZH', { precio: 10, currency: 'EUR', minimo: 10, maximo: null })[0].value as Record<string, unknown>[])[0]
  ok('el marketplace es el que se pidió', o.marketplace_id, 'A13V1IB3VIYZZH')
  ok('la divisa es la que se pasó', o.currency, 'EUR')
  ok('sin `audience`: es la oferta del comprador normal, no la de empresas', 'audience' in o, false)
}

console.log('\n=== EL JSON SALE LIMPIO: el límite es el MISMO número que el precio ===')
{
  // 24,99 + algo sería 24.99000000000001; aquí se copia, no se opera
  const precio = 24.99
  const o = (patchLimitesPrecio(ES, { precio, currency: 'EUR', minimo: precio, maximo: null })[0].value as Record<string, unknown>[])[0]
  ok('serializa 24.99, no 24.990000000000002', JSON.stringify(o.minimum_seller_allowed_price), '[{"schedule":[{"value_with_tax":24.99}]}]')
}

console.log('\n=== SE PUEDE REPETIR SI FALLA LA RED (es de valor absoluto) ===')
ok('el patch es repetible', patchIsRepeatable(patchLimitesPrecio(ES, { precio: 5, currency: 'EUR', minimo: 5, maximo: null })), true)

console.log(fallos === 0 ? '\n  TODO CORRECTO\n' : `\n  ${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
