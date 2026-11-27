import { readFileSync, existsSync } from 'node:fs'
import { leerCostesCsv, partirLinea } from './costes-csv'
let fallos = 0
const ok = (q: string, c: boolean, d = '') => { console.log(`  ${c ? 'OK   ' : 'FALLA'} ${q}${c ? '' : ` -> ${d}`}`); if (!c) fallos++ }
ok('comillas con ; dentro', partirLinea('"a;b";"3,25";""', ';').join('|') === 'a;b|3,25|')
const sb = '"ASIN";"SKU";"Title";"Cost";"VAT"\n"B0F";"T7-0CG9-DSP7";"Juego; adultos";"3,25";"21"\n"B0G";"CTE01512";"x";"";"21"\n"B0H";"WM50531";"y";"13,42";"21"'
const r = leerCostesCsv(sb)
ok('lee el export de Sellerboard (comillas, ; y coma decimal)', r.costes.length === 2 && r.costes[0].sku === 'T7-0CG9-DSP7' && r.costes[0].coste === 3.25 && r.costes[1].coste === 13.42, JSON.stringify(r))
ok('sin cabecera: SKU y coste', leerCostesCsv('ABC;4,5\nDEF;1.234,50').costes[1]?.coste === 1234.5)
ok('una pulgada (") en el título no se come la fila', leerCostesCsv('SKU;ASIN;Producto;Canal;COGS\n46464;B0G;Lenovo Idea Tab 11" 2.5K;FBM;168,35\n1;B1;Otro 15" y 17";FBM;2').costes.map((c) => `${c.sku}=${c.coste}`).join() === '46464=168.35,1=2')
ok('las comillas al empezar el campo siguen valiendo', leerCostesCsv('"SKU";"Cost"\n"A;B";"3,5"').costes[0]?.sku === 'A;B')
const real = '/Users/raulcamunas/Downloads/Creative_Toys_Espa_a_Productos_(2026_11_26_19_54_40_570)_sellerboard.com.csv'
if (existsSync(real)) {
  const x = leerCostesCsv(readFileSync(real, 'utf8'))
  ok(`el fichero real de Creative Toys: ${x.costes.length} costes`, x.costes.length > 90 && x.costes.some((c) => c.sku === 'B3-POVL-HWCF' && c.coste === 6.73), x.error ?? '')
}
console.log(fallos ? `\n${fallos} FALLOS` : '\nTODO BIEN')
if (fallos) process.exit(1)
