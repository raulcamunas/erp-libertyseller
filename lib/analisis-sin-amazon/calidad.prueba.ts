import type { InformeSinAmazon, MercadoSinAmazon, ProductoMini } from './construir'
import { cuentaDeMercado, depurar, evaluarMercado } from './calidad'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** LOS LÍMITES DEL INFORME DE UNA TIENDA SIN AMAZON (14 nov 2026: un snack de 0,90 € «dejaba» −2,94 € por venta) */

const prod = (i: number, precio: number): ProductoMini => ({ asin: `B0TEST${String(i).padStart(4, '0')}`, titulo: `Producto ${i}`, marca: `Marca ${i}`, imagen: null, precio, ventasMes: 100, resenas: 50, estrellas: 4.4, vende: 'Amazon' })
const mercado = (o: Partial<MercadoSinAmazon>): MercadoSinAmazon => ({
  nombre: 'Culottes con tirantes',
  categoria: 'Culotes',
  origen: 'texto',
  modo: 'ventas',
  productos: [prod(1, 40), prod(2, 50), prod(3, 52), prod(4, 60)],
  ventasMes: 400,
  facturacionMes: 20000,
  precioMediano: 51,
  resenasMediana: 50,
  comisionPct: 15,
  logistica: 3.68,
  suyo: { titulo: 'Culotte Elite', precio: 145, deAmazon: false },
  marcas: [],
  ...o,
})
const informe = (mercados: MercadoSinAmazon[], o: Partial<InformeSinAmazon> = {}): InformeSinAmazon => ({
  clase: 'sin_amazon',
  version: 1,
  fecha: '2026-11-14',
  caso: 'ausente',
  tipo: null,
  tipoTexto: 'Sin Amazon · su marca no está',
  vendedor: { nombre: 'Tienda', web: 'https://tienda.es' },
  catalogo: { productos: 40 },
  marca: { nombre: 'Tienda', modelos: 0, fichas: [], revisadas: 0, sinVendedor: 0, vendedores: [], ventasMes: 0, comprobadoPor: null },
  mercados,
  titular: ['a', 'b'],
  resumen: 'r',
  claves: [],
  guion: { tipo: 't', frases: [] },
  ...o,
})

console.log('\n=== la cuenta: precio y margen ===')
const culottes = cuentaDeMercado(mercado({}))
ok('145 € contra una mediana de 51 € se compara (la mitad del rango)', culottes.comparable === true && culottes.usaSuyo)
ok('145 € deja 93,75 € sin IVA, como antes del cambio', Math.abs((culottes.llega ?? 0) - 93.75) < 0.01, String(culottes.llega))
const snack = cuentaDeMercado(mercado({ suyo: { titulo: 'Barritas de Ternera', precio: 0.9, deAmazon: false }, precioMediano: 7.01, comisionPct: 6.73, logistica: 3.62 }))
ok('un snack de 0,90 € contra 7,01 € no se compara', snack.comparable === false && !snack.usaSuyo)
ok('…y la cuenta sale de la mediana, no de su precio', snack.base === 7.01)
ok('…y con 7 € la logística pesa más que el producto: no hay cuenta', snack.sinCuenta === 'precio-bajo', String(snack.sinCuenta))
const bateria = cuentaDeMercado(mercado({ suyo: { titulo: 'Kit batería Pylontech 14,4 kWh', precio: 7240.11, deAmazon: false }, precioMediano: 299.99, comisionPct: 11.31, logistica: 5.61 }))
ok('7.240 € contra 300 € no se compara', bateria.comparable === false && bateria.pct === null)
ok('…y se calcula con la mediana, no con 7.240 €', bateria.base === 299.99 && bateria.sinCuenta === null)
const limite = cuentaDeMercado(mercado({ suyo: { titulo: 'x', precio: 153, deAmazon: false } }))
ok('justo 3 veces la mediana todavía se compara', limite.comparable === true, String(limite.comparable))
const sobre = cuentaDeMercado(mercado({ suyo: { titulo: 'x', precio: 154, deAmazon: false } }))
ok('un poco más de 3 veces ya no', sobre.comparable === false)
const bajo = cuentaDeMercado(mercado({ suyo: { titulo: 'x', precio: 17, deAmazon: false } }))
ok('un tercio justo de la mediana todavía se compara', bajo.comparable === true, String(bajo.comparable))
ok('sin su precio se usa la mediana y no hay comparación', cuentaDeMercado(mercado({ suyo: null })).comparable === null)
ok('sin comisión o logística de Keepa no hay cuenta', cuentaDeMercado(mercado({ comisionPct: null })).sinCuenta === 'sin-tarifas')
const poco = cuentaDeMercado(mercado({ suyo: { titulo: 'x', precio: 60, deAmazon: false }, logistica: 40, precioMediano: 60 }))
ok('si lo que queda no llega al 30 % del precio, tampoco', poco.sinCuenta === 'margen-bajo', String(poco.sinCuenta))

console.log('\n=== qué mercados se enseñan ===')
ok('un mercado normal está bien', evaluarMercado(mercado({})).estado === 'ok')
ok('su precio de otra gama deja el mercado «ajustado»: se enseña sin compararlo', evaluarMercado(mercado({ suyo: { titulo: 'x', precio: 7240, deAmazon: false }, precioMediano: 300 })).estado === 'ajustado')
const monitores = evaluarMercado(mercado({ nombre: 'Monitores', categoria: 'Soportes para monitor' }))
ok('«Monitores» que Amazon clasifica como «Soportes para monitor» no se enseña', monitores.estado === 'dudoso', monitores.motivo ?? '')
ok('«Fregaderos» que sale como «Grifos» no se enseña', evaluarMercado(mercado({ nombre: 'Fregaderos', categoria: 'Grifos de fregadero de cocina táctiles' })).estado === 'dudoso')
ok('si lo suyo SON los soportes, sí se enseña', evaluarMercado(mercado({ nombre: 'Soportes para monitor', categoria: 'Soportes para monitor' })).estado === 'ok')
const cristaleria = evaluarMercado(mercado({ nombre: 'Cristalería', categoria: 'Copas de vino' }))
ok('una categoría que no se parece se enseña, pero pide revisión', cristaleria.estado === 'ok' && cristaleria.revisar)
ok('si es de su marca, la categoría no se discute', !evaluarMercado(mercado({ origen: 'marca', nombre: 'Seca', categoria: 'Seca' })).revisar)
ok('con menos de 3 productos no se enseña', evaluarMercado(mercado({ productos: [prod(1, 20), prod(2, 22)] })).estado === 'dudoso')
ok('el nombre «Seca» avisa de que no dice qué producto es', evaluarMercado(mercado({ origen: 'marca', nombre: 'Seca', categoria: 'Seca' })).avisos.length === 1)

console.log('\n=== la calidad del informe ===')
const bueno = depurar(informe([mercado({})]))
ok('un informe normal es bueno', bueno.calidad.nivel === 'bueno' && bueno.calidad.motivos.length === 0)
const conUnoMalo = depurar(informe([mercado({}), mercado({ nombre: 'Monitores', categoria: 'Soportes para monitor' })]))
ok('con un mercado oculto, se enseña el otro y hay que revisarlo', conUnoMalo.mercados.length === 1 && conUnoMalo.calidad.nivel === 'revisar')
ok('…y dice cuál se ha ocultado y por qué', conUnoMalo.calidad.ocultos[0]?.nombre === 'Monitores' && /Soportes para monitor/.test(conUnoMalo.calidad.ocultos[0].motivo))
const sinNada = depurar(informe([mercado({ nombre: 'Monitores', categoria: 'Soportes para monitor' })]))
ok('sin mercados que valgan y sin marca en Amazon: flojo', sinNada.calidad.nivel === 'flojo')
ok('…y los textos ya no hablan de lo que se ha quitado', !/unidades al mes/.test(JSON.stringify(sinNada.claves)) && !/Monitores/.test(JSON.stringify(sinNada.guion)))
const revendidaSinMercado = depurar(informe([], { caso: 'revendida', marca: { nombre: 'Marca', modelos: 5, fichas: [], revisadas: 5, sinVendedor: 0, vendedores: [], ventasMes: 0, comprobadoPor: null } }))
ok('con su marca en Amazon y sin mercados, se revisa pero no es flojo', revendidaSinMercado.calidad.nivel === 'revisar')
const grande = depurar(informe([mercado({})], { caso: 'revendida', marca: { nombre: 'Real Madrid', modelos: 547, fichas: [], revisadas: 8, sinVendedor: 0, vendedores: [], ventasMes: 0, comprobadoPor: null } }))
ok('una marca con más de 100 fichas se revisa: puede ser enorme o compartir nombre', grande.calidad.nivel === 'revisar' && /547/.test(grande.calidad.motivos.join(' ')))
const otra = depurar(depurar(conUnoMalo))
ok('aplicarlo dos veces da lo mismo', otra.mercados.length === conUnoMalo.mercados.length && JSON.stringify(otra.claves) === JSON.stringify(conUnoMalo.claves))

console.log(fallos ? `\n${fallos} FALLOS` : '\nTODO BIEN')
process.exit(fallos ? 1 : 0)
