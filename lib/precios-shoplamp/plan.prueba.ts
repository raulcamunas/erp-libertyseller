/**
 * EL CLASIFICADOR DE FILAS, SIN BASE DE DATOS NI RED.
 *
 * `construirFila()` es lo único del plan con lógica de verdad, y es lo que
 * decide si una referencia se puede enviar. Aquí se le meten listings
 * inventados —incluidos los casos feos que la base sí produce— y se comprueba
 * el veredicto.
 *
 * Los cuatro casos que importan, y por qué cada uno:
 *
 *   sin_base       existe fuera y no en España. 553 reales en este catálogo.
 *   base_invalida  está en España pero su precio no sirve (vacío, cero).
 *   ya_correcto    ya vale lo que la regla manda. Mandarlo gasta cupo para nada.
 *   cambia         lo único enviable.
 *
 *   npx tsx lib/precios-shoplamp/plan.prueba.ts
 */

import { construirFila, aNumero, type FilaListing } from './plan'
import { DESTINOS } from './reglas'

let fallos = 0
function ok(que: string, real: unknown, esperado: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado)
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK  ' : 'MAL '}  ${que}${bien ? '' : `  (${JSON.stringify(real)} != ${JSON.stringify(esperado)})`}`)
}

const FRANCIA = DESTINOS.find((d) => d.pais === 'Francia')!
const ALEMANIA = DESTINOS.find((d) => d.pais === 'Alemania')!

/**
 * Un listing de mentira.
 *
 * `'clave' in p` y NO `p.clave ?? defecto`: con `??` un `title: null` escrito a
 * propósito en la prueba se convierte en el título por defecto, y entonces la
 * prueba de «sin título cae al de España» pasa sin probar nada. Es el mismo
 * despiste de null-contra-defecto que esta pantalla vigila en los precios.
 */
function listing(p: Partial<FilaListing> & { sku: string }): FilaListing {
  return {
    sku: p.sku,
    asin: 'asin' in p ? (p.asin as string | null) : 'B000000001',
    title: 'title' in p ? (p.title as string | null) : 'Lámpara de pie',
    price: 'price' in p ? (p.price as number | string | null) : null,
    marketplace_id: p.marketplace_id ?? 'A13V1IB3VIYZZH',
    product_type: 'product_type' in p ? (p.product_type as string | null) : 'LIGHT_FIXTURE',
    last_seen_at: p.last_seen_at ?? '2026-10-05T08:00:00+00:00',
  }
}

console.log('\n=== EL CASO NORMAL ===')
{
  const f = construirFila(FRANCIA, listing({ sku: 'A1', price: 30 }), listing({ sku: 'A1', price: 24.99 }))
  ok('base de España', f.base, 24.99)
  ok('precio de hoy allí', f.actual, 30)
  ok('quedaría en 31,99', f.destino, 31.99)
  ok('cambia', f.estado, 'cambia')
  ok('sube un 28 %', f.subida, 28)
  ok('el recargo se enseña en euros', f.recargo, 7)
}

console.log('\n=== NO ESTÁ EN ESPAÑA: no se adivina su base ===')
{
  const f = construirFila(FRANCIA, listing({ sku: 'B1', price: 19.9 }), undefined)
  ok('sin_base', f.estado, 'sin_base')
  ok('no hay precio nuevo', f.destino, null)
  ok('no hay subida que enseñar', f.subida, null)
}

console.log('\n=== LA BASE QUE NO SIRVE — y aquí está el fallo caro ===')
for (const malo of [null, '', 0, '0', '0.00'] as (number | string | null)[]) {
  const f = construirFila(FRANCIA, listing({ sku: 'C1', price: 40 }), listing({ sku: 'C1', price: malo }))
  ok(`price=${JSON.stringify(malo)} -> base_invalida, NO 7,00 €`, [f.estado, f.destino], ['base_invalida', null])
}

console.log('\n=== YA ESTÁ EN SU PRECIO: no se gasta cupo de Amazon ===')
{
  const f = construirFila(FRANCIA, listing({ sku: 'D1', price: 31.99 }), listing({ sku: 'D1', price: 24.99 }))
  ok('ya_correcto', f.estado, 'ya_correcto')
}
{
  // EL CASO QUE JUSTIFICA COMPARAR EN CÉNTIMOS. Si el espejo guarda el número
  // que produce la suma en euros, 9,13 + 7 da 16.130000000000003. Comparando
  // en coma flotante no es igual a 8,13 y la fila saldría como «cambia» para
  // siempre: cada pasada volvería a mandar a Amazon el precio que ya tiene.
  // Con una base POR ENCIMA del suelo: por debajo, el precio es 15 y la suma no
  // llega a existir.
  const sucio = 9.13 + 7
  ok('la suma en euros está sucia', String(sucio), '16.130000000000003')
  const f = construirFila(FRANCIA, listing({ sku: 'D2', price: sucio }), listing({ sku: 'D2', price: 9.13 }))
  ok('aun así: ya_correcto', f.estado, 'ya_correcto')
}

console.log('\n=== EL PRECIO LLEGA COMO CADENA, que es como lo manda PostgREST ===')
{
  // Los NUMERIC vienen como cadena en cuanto se salen de lo que un double
  // representa sin perder nada. `Number('')` es 0, o sea un precio de cero.
  ok("'24.99' es 24,99", aNumero('24.99'), 24.99)
  ok("' 24.99 ' con espacios también", aNumero(' 24.99 '), 24.99)
  ok("'' NO es cero: es que no hay dato", aNumero(''), null)
  ok("'hola' no es un precio", aNumero('hola'), null)
  ok('Infinity no es un precio', aNumero(Number.POSITIVE_INFINITY), null)
  const f = construirFila(FRANCIA, listing({ sku: 'E1', price: '30.00' }), listing({ sku: 'E1', price: '24.99' }))
  ok('y la fila sale igual', [f.base, f.destino, f.estado], [24.99, 31.99, 'cambia'])
}

console.log('\n=== SIN TIPO DE PRODUCTO SE ENSEÑA, PERO NO SE PUEDE ENVIAR ===')
{
  const f = construirFila(
    FRANCIA,
    listing({ sku: 'F1', price: 30, product_type: null }),
    listing({ sku: 'F1', price: 24.99 })
  )
  ok('cambia, sí', f.estado, 'cambia')
  ok('pero sin tipo de producto', f.productType, null)
}

console.log('\n=== EL SUELO DE 14,99 € EN LA FILA ===')
{
  // La referencia de 1,07 € de España: es la peor del catálogo real
  const f = construirFila(FRANCIA, listing({ sku: 'S1', price: 7.07 }), listing({ sku: 'S1', price: 1.07 }))
  ok('1,07 € en España -> 14,99 € en Francia', f.destino, 14.99)
  ok('  lo ha puesto el suelo', f.porSuelo, true)
  ok('  cambia (hoy vale 7,07)', f.estado, 'cambia')
  ok('  sube un 1300,9 %', f.subida, 1300.9)

  const alem = construirFila(ALEMANIA, listing({ sku: 'S2', price: 7 }), listing({ sku: 'S2', price: 1 }))
  ok('1 € en España -> 14,99 € en Alemania, no 7', alem.destino, 14.99)

  // Una referencia que ya está a 14,99 no se vuelve a mandar
  const ya = construirFila(FRANCIA, listing({ sku: 'S3', price: 14.99 }), listing({ sku: 'S3', price: 1.07 }))
  ok('si ya está a 14,99 -> ya_correcto', ya.estado, 'ya_correcto')

  // Una que se publicó a 15,00 con el suelo anterior baja un céntimo
  const quince = construirFila(FRANCIA, listing({ sku: 'S3b', price: 15 }), listing({ sku: 'S3b', price: 1.07 }))
  ok('si se publicó a 15,00 con el suelo anterior -> cambia a 14,99', [quince.estado, quince.destino], ['cambia', 14.99])

  // Por encima del suelo, nada cambia
  const alto = construirFila(FRANCIA, listing({ sku: 'S4', price: 30 }), listing({ sku: 'S4', price: 20 }))
  ok('20 € -> 27 €, el suelo no actúa', [alto.destino, alto.porSuelo], [27, false])

  // Justo en el borde: 7,99 + 7 = 14,99 lo pone el recargo; 7,98 + 7 = 14,98 lo pone el suelo
  const borde = construirFila(FRANCIA, listing({ sku: 'S5', price: 1 }), listing({ sku: 'S5', price: 7.99 }))
  ok('7,99 € + 7 = 14,99 justo: lo pone el recargo, no el suelo', [borde.destino, borde.porSuelo], [14.99, false])
  const bajo = construirFila(FRANCIA, listing({ sku: 'S5b', price: 1 }), listing({ sku: 'S5b', price: 7.98 }))
  ok('7,98 € + 7 = 14,98: lo sube el suelo a 14,99', [bajo.destino, bajo.porSuelo], [14.99, true])

  // EL FALLO CARO: sin base no hay 14,99 €
  const sinBase = construirFila(FRANCIA, listing({ sku: 'S6', price: 40 }), undefined)
  ok('sin España: NO sale a 14,99 €', [sinBase.destino, sinBase.estado, sinBase.porSuelo], [null, 'sin_base', false])
  const baseVacia = construirFila(FRANCIA, listing({ sku: 'S7', price: 40 }), listing({ sku: 'S7', price: null }))
  ok('base sin precio: NO sale a 14,99 €', [baseVacia.destino, baseVacia.estado, baseVacia.porSuelo], [null, 'base_invalida', false])
}

console.log('\n=== CADA PAÍS CON SU RECARGO ===')
{
  const base = listing({ sku: 'G1', price: 24.99 })
  ok('Francia +7 -> 31,99', construirFila(FRANCIA, listing({ sku: 'G1' }), base).destino, 31.99)
  ok('Alemania +6 -> 30,99', construirFila(ALEMANIA, listing({ sku: 'G1' }), base).destino, 30.99)
}

console.log('\n=== EL TÍTULO: el de allí, y si no hay, el de España ===')
{
  const f = construirFila(
    FRANCIA,
    listing({ sku: 'H1', price: 30, title: null }),
    listing({ sku: 'H1', price: 24.99, title: 'Lámpara de España' })
  )
  ok('cae al de España', f.titulo, 'Lámpara de España')
  const g = construirFila(FRANCIA, listing({ sku: 'H2', price: 30, title: null }), undefined)
  ok('y si no hay ninguno, null', g.titulo, null)
}

console.log('\n=== LOS CÉNTIMOS SALEN EXACTOS EN TODO EL CATÁLOGO ===')
{
  let sucios = 0
  for (let c = 1; c <= 60000; c += 1) {
    const f = construirFila(
      FRANCIA,
      listing({ sku: 'X', price: 1 }),
      listing({ sku: 'X', price: c / 100 })
    )
    const d = f.destino as number
    if (Math.abs(d * 100 - Math.round(d * 100)) > 1e-9) sucios++
  }
  ok('60.000 precios y ni un céntimo sucio', sucios, 0)
}

console.log(fallos === 0 ? '\n  TODO CORRECTO\n' : `\n  ${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
