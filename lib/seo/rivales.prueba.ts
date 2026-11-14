/**
 * PRUEBAS DEL SEGUIMIENTO DE LA COMPETENCIA (lib/seo/rivales.ts): la foto desde Catalog Items y getItemOffersBatch, y los cambios entre dos fotos.
 *   npx tsx lib/seo/rivales.prueba.ts
 */
import { asinsDeTexto, cambiosEntreFotos, completarConAnterior, fotoDeItemCatalogo, hashDeFoto, ofertasDeRespuesta, type FotoRival } from './rivales'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const ES = 'A1RKKUPIHCS9HS'

console.log('\n=== la foto desde el catálogo ===')
{
  const f = fotoDeItemCatalogo(
    {
      asin: 'B0RIVAL001',
      attributes: { item_name: [{ value: 'Rival  Lámpara de pie', marketplace_id: ES }], bullet_point: [{ value: 'Uno', marketplace_id: ES }, { value: 'Dos', marketplace_id: ES }], brand: [{ value: 'Rival', marketplace_id: ES }] },
      images: [{ marketplaceId: ES, images: [{ variant: 'PT01', link: 'https://x/pt01-s.jpg', height: 100, width: 100 }, { variant: 'MAIN', link: 'https://x/main-s.jpg', height: 75, width: 75 }, { variant: 'MAIN', link: 'https://x/main-l.jpg', height: 1500, width: 1500 }] }],
      salesRanks: [{ marketplaceId: ES, displayGroupRanks: [{ title: 'Hogar', rank: 1200 }], classificationRanks: [{ title: 'Lámparas de pie', rank: 15 }] }],
    },
    ES
  )
  ok('título con espacios normalizados', f.titulo === 'Rival Lámpara de pie')
  ok('viñetas y marca', f.bullets.length === 2 && f.marca === 'Rival')
  ok('imágenes: la más grande de cada variante, MAIN primero', f.imagenes.join() === 'https://x/main-l.jpg,https://x/pt01-s.jpg', f.imagenes.join())
  ok('BSR de grupo y de categoría', f.bsr.length === 2 && f.bsr[0].tipo === 'grupo' && f.bsr[0].rank === 1200)
}

console.log('\n=== precio y Buy Box ===')
{
  const o = ofertasDeRespuesta({ payload: { ASIN: 'B0RIVAL001', Summary: { BuyBoxPrices: [{ LandedPrice: { Amount: 29.991, CurrencyCode: 'EUR' } }], TotalOfferCount: 4 }, Offers: [{ SellerId: 'A1', IsBuyBoxWinner: false }, { SellerId: 'A2', IsBuyBoxWinner: true }] } })
  ok('precio de la Buy Box redondeado', o.precio === 29.99 && o.moneda === 'EUR')
  ok('quién la gana y cuántas ofertas', o.buyboxVendedor === 'A2' && o.ofertas === 4)
  const sinBb = ofertasDeRespuesta({ payload: { ASIN: 'B0X', Summary: { LowestPrices: [{ LandedPrice: { Amount: 30 } }, { LandedPrice: { Amount: 25 } }] } } })
  ok('sin Buy Box: el más bajo', sinBb.precio === 25)
  ok('respuesta vacía no rompe', ofertasDeRespuesta(null).precio === null)
}

console.log('\n=== cambios entre fotos ===')
{
  const a: FotoRival = { titulo: 'Rival Lámpara de pie LED', bullets: ['Uno', 'Dos'], imagenes: ['m1', 'p1'], marca: 'Rival', bsr: [{ tipo: 'grupo', categoria: 'Hogar', rank: 1000 }], precio: 30, moneda: 'EUR', buyboxVendedor: 'A1', ofertas: 3 }
  ok('primera foto: nada que comparar', cambiosEntreFotos(null, a).length === 0)
  ok('igual: sin cambios', cambiosEntreFotos(a, { ...a, titulo: ' Rival  Lámpara de pie LED ' }).length === 0)
  ok('BSR que se mueve poco no cuenta', cambiosEntreFotos(a, { ...a, bsr: [{ tipo: 'grupo', categoria: 'Hogar', rank: 1150 }] }).length === 0)
  ok('precio que se mueve menos del 1 % no cuenta', cambiosEntreFotos(a, { ...a, precio: 30.2 }).length === 0)
  const c = cambiosEntreFotos(a, { ...a, titulo: 'Rival Lámpara de pie LED regulable', bullets: ['Uno', 'Tres'], imagenes: ['m2', 'p1', 'p2'], precio: 24, bsr: [{ tipo: 'grupo', categoria: 'Hogar', rank: 600 }], buyboxVendedor: 'A9' })
  const de = (campo: string) => c.find((x) => x.campo === campo)
  ok('título: dice qué palabra entra', de('titulo')?.resumen.includes('regulable') === true, de('titulo')?.resumen)
  ok('viñetas: una reescrita', de('bullets')?.magnitud === 1)
  ok('imágenes: cambia la principal y hay nuevas', de('imagenes')?.resumen.includes('principal') === true)
  ok('precio: baja un 20 %', de('precio')?.resumen === 'baja un 20 %', de('precio')?.resumen)
  ok('BSR: mejora', de('bsr')?.resumen.startsWith('mejora') === true)
  ok('Buy Box', !!de('buybox'))
  ok('el hash cambia si cambia algo', hashDeFoto(a) !== hashDeFoto({ ...a, precio: 31 }) && hashDeFoto(a) === hashDeFoto({ ...a }))
  const heredada = completarConAnterior({ ...a, precio: null, buyboxVendedor: null }, a, false)
  ok('sin presupuesto de ofertas hereda el precio (no hay cambio falso)', heredada.precio === 30 && cambiosEntreFotos(a, heredada).length === 0)
}

console.log('\n=== ASIN escritos a mano ===')
ok('ASIN sueltos, repetidos y enlaces', asinsDeTexto('b0rival001, B0RIVAL001 https://www.amazon.es/dp/B0RIVAL002?th=1 hola').join() === 'B0RIVAL001,B0RIVAL002', asinsDeTexto('b0rival001, B0RIVAL001 https://www.amazon.es/dp/B0RIVAL002?th=1 hola').join())
ok('palabras de 10 letras no son ASIN', asinsDeTexto('LAMPARASDE').length === 0)

console.log(fallos === 0 ? '\nTodo bien.\n' : `\n${fallos} FALLOS\n`)
process.exit(fallos === 0 ? 0 : 1)
