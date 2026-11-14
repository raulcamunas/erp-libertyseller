import { leerCerebro, leerGrabber, numero, partirCsv } from './helium10'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** LOS CSV DE HELIUM 10 */
console.log('\n=== números ===')
ok('miles con coma', numero('1,234') === 1234)
ok('miles con punto', numero('12.345') === 12345)
ok('decimal con coma', numero('0,85') === 0.85)
ok('decimal con punto', numero('0.85') === 0.85)
ok('europeo completo', numero('1.234,56') === 1234.56)
ok('inglés completo', numero('1,234.56') === 1234.56)
ok('con moneda', numero('€1,20') === 1.2)
ok('vacío o guion', numero('-') === null && numero('') === null)

console.log('\n=== CSV ===')
ok('comas dentro de comillas', partirCsv('a,b\n"x, y",2\n')[1][0] === 'x, y')
ok('punto y coma', partirCsv('a;b\n1;2\n')[1][1] === '2')

const cerebro = leerCerebro('Keyword Phrase,ABA Total Click Share,Search Volume,Competing Products,Title Density,H10 PPC Sugg. Bid,Organic Rank\njamon serrano,"12,5%","4,320",1200,14,"0,85",-\n"jamón ibérico",1%,980,300,5,1.10,23\njamon serrano,1%,1,1,1,1,1\n')
ok('lee Cerebro en inglés', cerebro.ok && cerebro.filas.length === 2 && cerebro.filas[0].volumen === 4320 && cerebro.filas[0].pujaSugerida === 0.85 && cerebro.filas[1].rankingOrganico === 23, JSON.stringify(cerebro))
ok('sin duplicados', cerebro.ok && cerebro.filas.filter((f) => f.keyword === 'jamon serrano').length === 1)
ok('un fichero que no es de Cerebro se dice', !leerCerebro('ASIN,Price\nB0ABCDEFGH,10').ok)

const grabber = leerGrabber('Product Name,ASIN,Brand,Price,Ratings,Review Count\n"Jamón, 7kg",B0ABCDEFGH,Marca,"€89,90",4.5,"1,203"\nbasura,XYZ,,,,\n')
ok('lee ASIN Grabber y descarta lo que no es un ASIN', grabber.ok && grabber.filas.length === 1 && grabber.filas[0].precio === 89.9 && grabber.filas[0].resenas === 1203 && grabber.filas[0].titulo === 'Jamón, 7kg', JSON.stringify(grabber))

console.log(fallos ? `\n${fallos} FALLOS\n` : '\nTodo bien\n')
if (fallos) process.exit(1)
