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
  ok('dígitos pegados: además del texto, el patrón con comodines entre dígitos', f.includes('phone.ilike.%6%0%0%1%1%2%2%3%3%') && f.includes('telefonos_extra.ilike.%6%0%0%1%1%2%2%3%3%'), f)
  const g = filtroDeBusqueda('+34 600 11 22 33')!
  ok('con prefijo y espacios también', g.includes('phone.ilike.%3%4%6%0%0%1%1%2%2%3%3%'), g)
  ok('un nombre con un número no se trata como teléfono', !filtroDeBusqueda('tienda 12345 sl')!.includes('1%2%3%4%5'))
  ok('menos de cinco dígitos no es un teléfono', !filtroDeBusqueda('1234')!.includes('1%2%3%4'))
  ok('«91.234.56.78» con puntos sí', filtroDeBusqueda('91.234.56.78')!.includes('9%1%2%3%4%5%6%7%8'))
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
