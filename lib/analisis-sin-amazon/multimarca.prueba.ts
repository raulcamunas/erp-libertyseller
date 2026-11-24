/** Pruebas de la tienda multimarca: `npx tsx lib/analisis-sin-amazon/multimarca.prueba.ts` */
import { esLaFicha } from './estudio'
import { construirReventa, textosDelInforme } from './construir'

let fallos = 0
const ok = (n: string, bien: boolean, d: unknown = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien ? '' : ` -> ${JSON.stringify(d)}`}`)
}
const ficha = (title: string, brand = '', extra: object = {}) => ({ asin: title.slice(0, 10), title, brand, stats: { current: [] }, ...extra })

ok('el mismo modelo', esLaFicha('Fujifilm Instax Mini 12', 'Fujifilm', ficha('Fujifilm Instax Mini 12 - Cámara instantánea, Azul')))
ok('otro número de modelo, no', !esLaFicha('Fujifilm Instax Mini 12', 'Fujifilm', ficha('Fujifilm Instax Mini 11 Cámara')))
ok('otra marca, no', !esLaFicha('Canon EOS R50', 'Canon', ficha('Funda para EOS R50 de cuero', 'Generic')))
ok('una funda de la misma marca, no', !esLaFicha('Canon EOS R50', 'Canon', ficha('Funda Canon EOS R50 cuero')))
ok('A6400 = Alpha 6400', esLaFicha('Sony Alpha A6400 16-50mm', 'Sony', ficha('Sony Alpha 6400 | Cámara APS-C con objetivo 16-50mm', 'Sony')))
ok('XF35mm F2 = XF35mmF2', esLaFicha('Fujifilm Fujinon XF 35mm F2 R WR', 'Fujifilm', ficha('Fujinon XF35mmF2 R WR - Objetivo', 'Fujifilm')))
ok('A6400 no es A6100', !esLaFicha('Sony Alpha A6400', 'Sony', ficha('Sony Alpha 6100 Cámara', 'Sony')))
ok('f/2 no es f/2.8', !esLaFicha('Fujifilm Fujinon XF 23mm f/2 R WR', 'Fujifilm', ficha('FUJIFILM Fujinon XF 23mm f/2.8 R WR Plata', 'Fujifilm')))
ok('f/1.8 = F1.8', esLaFicha('Canon EF 50mm f/1.8 STM', 'Canon', ficha('Canon EF 50mm F1.8 STM - Objetivo', 'Canon')))
ok('marca en el campo brand', esLaFicha('Nikon Z50 II', 'Nikon', ficha('Z50 II + Z 16-50 kit', 'NIKON')))

// Las cifras de la reventa: amazon vende (current[0]) y ofertas (current[11])
const c = (precio: number, ofertas: number, amazon: boolean) => ({ stats: { current: Object.assign(Array(19).fill(-1), { 0: amazon ? precio * 100 : -1, 11: ofertas, 18: precio * 100 }) } })
const r = construirReventa(
  [
    { titulo: 'A', marca: 'Canon', busqueda: 'Canon A', precio: 600, producto: ficha('Canon A', 'Canon', { ...c(649, 7, true), monthlySold: 100 }) },
    { titulo: 'B', marca: 'Sony', busqueda: 'Sony B', precio: 900, producto: ficha('Sony B', 'Sony', c(878, 3, false)) },
    { titulo: 'C', marca: 'Sony', busqueda: 'Sony C', precio: null, producto: null },
  ],
  ['Canon', 'Sony'],
  {},
)
ok('encontrados 2 de 3', r.encontrados === 2 && r.productos.length === 3, r)
ok('ventas sumadas', r.ventasMes === 100, r.ventasMes)
ok('una sin Amazon vendiendo', r.sinAmazon === 1, r.sinAmazon)
ok('su precio compite en 1 de 2', r.suPrecioCompite === 1 && r.conAmbosPrecios === 2, r)
ok('mediana de ofertas', r.ofertasMediana === 5, r.ofertasMediana)
const t = textosDelInforme({ caso: 'multimarca', marcaNombre: 'Percy', modelos: 0, nombresTerceros: [], sinVendedor: 0, revisadas: 0, productosWeb: 40, mercados: [], reventa: r })
ok('el guion no habla de «su marca»', t.guion.tipo.startsWith('Tienda multimarca') && !t.guion.frases.join(' ').includes('no estás'), t.guion)
ok('el titular habla de venderlo en las fichas', t.titular[1].includes('mismas fichas'), t.titular)

if (fallos) {
  console.log(`\n${fallos} fallos`)
  process.exit(1)
}
console.log('\nTodo bien')
