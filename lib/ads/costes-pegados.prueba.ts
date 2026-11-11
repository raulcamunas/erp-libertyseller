import { leerCostesPegados, numeroEscrito } from './costes-pegados'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
ok('6,20 → 6.2', numeroEscrito('6,20') === 6.2)
ok('1.234,50 € → 1234.5', numeroEscrito('1.234,50 €') === 1234.5)
ok('1,234.50 → 1234.5', numeroEscrito('1,234.50') === 1234.5)
ok('texto → null', numeroEscrito('coste') === null)
const r = leerCostesPegados('SKU\tCoste\n650 GATO GRIS/37\t6,20\nBOTA-44\t12.5\n\nmal\nX;3,1\nY, Z,4.75\nX;3,4')
ok('cabecera y línea rota descartadas', r.descartadas === 2, JSON.stringify(r))
ok('tabulador, punto y coma y coma final', r.costes.find((c) => c.sku === '650 GATO GRIS/37')?.coste === 6.2 && r.costes.find((c) => c.sku === 'BOTA-44')?.coste === 12.5 && r.costes.find((c) => c.sku === 'Y, Z')?.coste === 4.75, JSON.stringify(r))
ok('un SKU repetido se queda con el último', r.costes.find((c) => c.sku === 'X')?.coste === 3.4)
console.log(fallos === 0 ? '\nTODO OK' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
