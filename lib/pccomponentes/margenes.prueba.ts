import { comisionDe, juzgar, margenAlPrecio, normalizarCategoria, precioMinimoParaMargen, TARIFA_POR_DEFECTO } from '@/lib/pccomponentes/margenes'

let fallos = 0
const ok = (nombre: string, cond: boolean, detalle = '') => {
  console.log(`${cond ? '  OK  ' : '  MAL '} ${nombre}${cond || !detalle ? '' : ` → ${detalle}`}`)
  if (!cond) fallos++
}
const casi = (a: number, b: number, tol = 0.011) => Math.abs(a - b) <= tol

console.log('\n=== categorías ===')
{
  ok('se normalizan acentos y mayúsculas', normalizarCategoria(' Tarjetas Gráficas ') === 'tarjetas graficas')
  ok('una categoría del histórico se encuentra aunque venga con acentos', !comisionDe('Portátiles').porDefecto && comisionDe('Portátiles').pct > 0.08 && comisionDe('Portátiles').pct < 0.09)
  ok('una desconocida usa la tarifa por defecto y lo dice', comisionDe('Categoría inventada').porDefecto && comisionDe(null).pct === TARIFA_POR_DEFECTO.pct)
}

console.log('\n=== el margen con una tarifa conocida ===')
{
  // Monitor MSI: coste 78,71, vendido a 122,26 € con IVA. Base 101,04; comisión 8,51 % = 8,60; beneficio 13,73 → 13,6 %
  const t = { fija: 0, pct: 0.0851, lineas: 1, origen: 'reciente' as const }
  const m = margenAlPrecio(122.26, 78.71, t)
  ok('base sin IVA', casi(m.base, 101.04, 0.02), JSON.stringify(m))
  ok('comisión sobre la base sin IVA', casi(m.comision, 8.6, 0.02), JSON.stringify(m))
  ok('beneficio y margen', casi(m.beneficio, 13.73, 0.03) && Math.abs(m.margen - 0.1359) < 0.002, JSON.stringify(m))
}

console.log('\n=== el precio mínimo y la vuelta ===')
{
  const t = { fija: 0.7, pct: 0.14, lineas: 50, origen: 'ajustada' as const }
  const suelo = precioMinimoParaMargen(10, 0.05, t)
  ok('hay precio mínimo', suelo !== null)
  const vuelta = margenAlPrecio(suelo!, 10, t)
  ok('al precio mínimo el margen sale el pedido (5 %)', Math.abs(vuelta.margen - 0.05) < 0.002, JSON.stringify(vuelta))
  ok('si la comisión y el margen se lo comen todo, no hay precio', precioMinimoParaMargen(10, 0.9, t) === null)
  ok('un coste de cero no tiene precio', precioMinimoParaMargen(0, 0.05, t) === null)
}

console.log('\n=== el juicio contra el mercado ===')
{
  const barato = juzgar({ coste: 78.71, categoria: 'Monitores', precioMercado: 116.71, margenObjetivo: 0.05 })
  ok('el monitor es competitivo con el 5 %', barato.competitivo && barato.alMercado !== null && barato.alMercado.margen > 0.09, JSON.stringify(barato))
  ok('el suelo del monitor es de unos 110 €', barato.suelo !== null && casi(barato.suelo, 110.1, 0.3), String(barato.suelo))
  const caro = juzgar({ coste: 814.56, categoria: 'Sobremesa', precioMercado: 1065.47, margenObjetivo: 0.05 })
  ok('el Dell a su coste NO es competitivo con el 5 %', !caro.competitivo && caro.sobreElMercado !== null && caro.sobreElMercado > 50, JSON.stringify(caro))
  const sin = juzgar({ coste: 10, categoria: 'Cables', precioMercado: null, margenObjetivo: 0.05 })
  ok('sin nadie vendiéndolo no hay margen al mercado ni se dice competitivo', sin.alMercado === null && !sin.competitivo && sin.suelo !== null)
}

if (fallos > 0) {
  console.log(`\n${fallos} FALLOS`)
  process.exit(1)
}
console.log('\nTODO BIEN')
