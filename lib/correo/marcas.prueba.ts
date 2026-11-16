import { DOMINIOS_PROPIOS, colorDeBuzon, direccionCorta, huecoDeBuzon, inicialDeBuzon } from '@/lib/correo/marcas'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== colorDeBuzon ===')
{
  const c = colorDeBuzon('stock@libertyseller.es')
  ok('da var(--viz-N) con N de 1 a 6', /^var\(--viz-[1-6]\)$/.test(c), c)
  ok('estable: la misma dirección, el mismo color', colorDeBuzon('stock@libertyseller.es') === c)
  ok('sin mirar mayúsculas ni espacios', colorDeBuzon('  STOCK@LibertySeller.es ') === c)
  ok('el hueco y el color van de la mano', c === `var(--viz-${huecoDeBuzon('stock@libertyseller.es')})`)
  const direcciones = ['stock', 'soporte', 'daniela', 'jose', 'maoli', 'patricia', 'raul', 'jhanna', 'alejandro', 'mario', 'ventas', 'info', 'business', 'cobros', 'admin', 'ana'].map((x) => `${x}@libertyseller.es`)
  const huecos = new Set(direcciones.map(huecoDeBuzon))
  ok('16 buzones se reparten en al menos 4 colores', huecos.size >= 4, [...huecos].join(','))
  ok('todos dentro de 1..6', direcciones.every((d) => { const h = huecoDeBuzon(d); return h >= 1 && h <= 6 }))
  ok('vacío o null no rompe', /^var\(--viz-[1-6]\)$/.test(colorDeBuzon('')) && /^var\(--viz-[1-6]\)$/.test(colorDeBuzon(null)))
}

console.log('\n=== direccionCorta ===')
ok('de la empresa (.es): sin dominio', direccionCorta('stock@libertyseller.es') === 'stock@', direccionCorta('stock@libertyseller.es'))
ok('de la empresa (.com): sin dominio', direccionCorta('ana@libertyseller.com') === 'ana@')
ok('dominio en mayúsculas: también', direccionCorta('Ana@LibertySeller.ES') === 'Ana@', direccionCorta('Ana@LibertySeller.ES'))
ok('de fuera: entera', direccionCorta('ana@gmail.com') === 'ana@gmail.com')
ok('un dominio que solo se parece: entera', direccionCorta('x@libertyseller.es.malo.com') === 'x@libertyseller.es.malo.com')
ok('con dominioPropio: ese manda', direccionCorta('ana@agencia.es', 'agencia.es') === 'ana@' && direccionCorta('stock@libertyseller.es', 'agencia.es') === 'stock@libertyseller.es')
ok('dominioPropio con @ delante o en lista', direccionCorta('ana@agencia.es', '@agencia.es') === 'ana@' && direccionCorta('ana@otra.es', ['agencia.es', 'otra.es']) === 'ana@')
ok('sin arroba: tal cual', direccionCorta('nadie') === 'nadie')
ok('vacío y null: vacío', direccionCorta('') === '' && direccionCorta(null) === '')
ok('espacios de los lados fuera', direccionCorta('  stock@libertyseller.es ') === 'stock@')
ok('DOMINIOS_PROPIOS trae los dos de la empresa', DOMINIOS_PROPIOS.includes('libertyseller.es') && DOMINIOS_PROPIOS.includes('libertyseller.com'))

console.log('\n=== inicialDeBuzon (el carril) ===')
ok('la primera letra, en mayúscula', inicialDeBuzon('stock@libertyseller.es') === 'S' && inicialDeBuzon('daniela.fernandez@libertyseller.es') === 'D')
ok('con tilde se queda la tilde', inicialDeBuzon('ángela@libertyseller.es') === 'Á', inicialDeBuzon('ángela@libertyseller.es'))
ok('se salta lo que no es letra ni cifra', inicialDeBuzon('_info@libertyseller.es') === 'I' && inicialDeBuzon('2ventas@x.com') === '2')
ok('vacío, null o sin letras: @', inicialDeBuzon('') === '@' && inicialDeBuzon(null) === '@' && inicialDeBuzon('_.@x') === 'X')

console.log(fallos ? `\n${fallos} FALLOS` : '\nTodo bien')
if (fallos) process.exit(1)
