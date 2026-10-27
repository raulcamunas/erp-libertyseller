import { filtroDeBusqueda, textoSeguro } from './buscar-leads'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== lo que se escribe no rompe el filtro ===')
{
  ok('una coma no parte el filtro', !textoSeguro('casa,luz').includes(','))
  ok('ni los paréntesis, asteriscos, porcentajes, comillas o barras', textoSeguro('a(b)c*d%e"f\\g') === 'a b c d e f g')
  ok('los espacios de sobra se quedan en uno', textoSeguro('  casa    luz ') === 'casa luz')
  const f = filtroDeBusqueda('casa,luz')!
  ok('el filtro sigue teniendo solo las comas que separan condiciones (8 condiciones = 7 comas)', f.split(',').length === 8 && f.split(',').every((c) => /^[a-z_]+\.ilike\.%.+%$/.test(c)), f)
}

console.log('\n=== cuándo no se busca ===')
{
  ok('con nada', filtroDeBusqueda('') === null)
  ok('con un carácter', filtroDeBusqueda('a') === null)
  ok('con solo espacios o símbolos que se quitan', filtroDeBusqueda('  ,, ') === null && filtroDeBusqueda('()') === null)
  ok('con dos caracteres ya', filtroDeBusqueda('ca') !== null)
}

console.log('\n=== dónde se busca ===')
{
  const f = filtroDeBusqueda('luz')!
  for (const c of ['store_name', 'company', 'decisor', 'email', 'web', 'cif', 'phone', 'telefonos_extra'])
    ok(`en ${c}`, f.includes(`${c}.ilike.%luz%`))
  ok('no se busca el teléfono sin formato con letras', !f.includes('l%u%z'))
}

console.log('\n=== teléfonos ===')
{
  const f = filtroDeBusqueda('600112233')!
  ok('dígitos pegados: además del texto, la expresión regular con «lo que no sea un dígito» entre dígitos', f.includes('phone.imatch.6[^0-9]*0[^0-9]*0[^0-9]*1[^0-9]*1[^0-9]*2[^0-9]*2[^0-9]*3[^0-9]*3') && f.includes('telefonos_extra.imatch.6[^0-9]*0'), f)
  ok('y NO los comodines que dejaban pasar cualquier cosa (6%0%0…)', !f.includes('6%0%0'), f)
  const g = filtroDeBusqueda('+34 600 11 22 33')!
  ok('con prefijo y espacios también', g.includes('phone.imatch.3[^0-9]*4[^0-9]*6[^0-9]*0[^0-9]*0[^0-9]*1[^0-9]*1[^0-9]*2[^0-9]*2[^0-9]*3[^0-9]*3'), g)
  ok('un nombre con un número no se trata como teléfono', !filtroDeBusqueda('tienda 12345 sl')!.includes('imatch'))
  ok('menos de cinco dígitos no es un teléfono', !filtroDeBusqueda('1234')!.includes('imatch'))
  ok('«91.234.56.78» con puntos sí', filtroDeBusqueda('91.234.56.78')!.includes('9[^0-9]*1[^0-9]*2[^0-9]*3[^0-9]*4[^0-9]*5[^0-9]*6[^0-9]*7[^0-9]*8'))
  // La expresión regular que se manda es la que se probó contra la base: casa con los formatos reales y no con dígitos de por medio
  const re = new RegExp(filtroDeBusqueda('600112233')!.split(',').find((c) => c.startsWith('phone.imatch.'))!.slice('phone.imatch.'.length), 'i')
  ok('casa con «600 11 22 33»', re.test('600 11 22 33'))
  ok('casa con «+34 600-11-22-33» y con «600.11.22.33»', re.test('+34 600-11-22-33') && re.test('600.11.22.33'))
  ok('no casa con otro teléfono que solo tiene esos dígitos desperdigados («6 1 0 2 0 1 1 3 2 2 3 3»)', !re.test('612 034 1122 33'))
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
