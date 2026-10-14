import { interpretar } from './pegado'

let fallos = 0
function ok(nombre: string, real: unknown, esperado: unknown) {
  const bien = JSON.stringify(real) === JSON.stringify(esperado)
  if (!bien) fallos += 1
  console.log(`  ${bien ? 'OK  ' : 'FALLA'}  ${nombre}${bien ? '' : ` → ${JSON.stringify(real)} (esperado ${JSON.stringify(esperado)})`}`)
}

console.log('=== TABLA PEGADA ===')
const t = interpretar('FBASKU\tUnidades a enviar\tTalla\nFBA047768-40\t2\t40\nFBA047768-41\t3\t41')
ok('con cabecera: dos líneas', t.lineas.length, 2)
ok('lee SKU, unidades y talla', [t.lineas[0].sku, t.lineas[0].unidades, t.lineas[0].variante], ['FBA047768-40', 2, '40'])
ok('sin cabecera se asume SKU y unidades', interpretar('A1;5\nB2;7').lineas.map((l) => [l.sku, l.unidades]), [['A1', 5], ['B2', 7]])
ok('un SKU repetido se SUMA, no se rechaza', interpretar('sku,unidades\nA,2\nA,3').lineas.map((l) => l.unidades), [5])
ok('unidades con miles: 1.234', interpretar('sku,unidades\nA,"1.234"').lineas[0]?.unidades, 1234)
ok('unidades que no son número: aviso y se salta', [interpretar('sku,unidades\nA,abc').lineas.length, interpretar('sku,unidades\nA,abc').avisos.length], [0, 1])
ok('con cabecera pero sin columna de SKU: aviso y nada', [interpretar('unidades,foo\n5,x').lineas.length, interpretar('unidades,foo\n5,x').avisos.length], [0, 1])
ok('sin cabecera reconocible se asume SKU y unidades', interpretar('foo,bar\n1,2').lineas.map((l) => [l.sku, l.unidades]), [['1', 2]])

console.log(fallos === 0 ? '\n  TODO CORRECTO' : `\n  ${fallos} FALLOS`)
if (fallos) process.exit(1)
