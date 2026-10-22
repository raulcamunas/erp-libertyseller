import { claveDeTelefono, clavesDeTelefonos, telefonoLegible } from '@/lib/rendimiento/telefonos'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * CASAR EL TELÉFONO DE UNA LLAMADA CON EL DE UN LEAD.
 *
 * Los formatos de cold_leads.phone son los reales (muestra de 1.000 leads): «+34600112233» (62 %),
 * «+34 600 11 22 33» (19 %), «600.112.233», «600 11 22 33», «600112233», «600 - 112 233»…
 */

const UNO = '600112233'

console.log('\n=== un mismo número, escrito de todas las formas ===')
{
  for (const forma of ['+34600112233', '+34 600 11 22 33', '600.112.233', '600 11 22 33', '600112233', '0034600112233', '0034 600 112 233', '34600112233', ' +34-600-112-233 ', '(+34) 600 112 233']) {
    ok(`«${forma.trim()}» da la clave de nueve cifras`, claveDeTelefono(forma) === UNO, String(claveDeTelefono(forma)))
  }
  ok('el número de Rinkel (E.164) y el del lead (con espacios) dan la misma clave', claveDeTelefono('+34600112233') === claveDeTelefono('+34 600 11 22 33'))
  ok('y el del Excel de la centralita, sin el más', claveDeTelefono('34600112233') === claveDeTelefono('+34600112233'))
}

console.log('\n=== un fijo ===')
{
  ok('93 111 22 33 (Barcelona) es de nueve cifras', claveDeTelefono('931112233') === '931112233' && claveDeTelefono('+34 931 11 22 33') === '931112233' && claveDeTelefono('093-1112233') === null)
}

console.log('\n=== lo que NO es un teléfono ===')
{
  ok('vacío, nulo y espacios', claveDeTelefono(null) === null && claveDeTelefono(undefined) === null && claveDeTelefono('') === null && claveDeTelefono('   ') === null)
  ok('un «9» suelto o una extensión de pocas cifras', claveDeTelefono('9') === null && claveDeTelefono('1234') === null)
  ok('un número con una cifra de menos no se adivina', claveDeTelefono('60011223') === null)
  ok('un código de diez cifras sin prefijo no se toma por un teléfono español', claveDeTelefono('6001122331') === null)
  ok('texto sin cifras', claveDeTelefono('sin teléfono') === null)
}

console.log('\n=== números de otros países ===')
{
  ok('un británico NO se recorta a nueve cifras: lleva su prefijo y un +', claveDeTelefono('+442079460958') === '+442079460958', String(claveDeTelefono('+442079460958')))
  ok('y no se confunde con el alemán que acaba igual', claveDeTelefono('+442079460958') !== claveDeTelefono('+492079460958'))
  ok('con 00 delante también', claveDeTelefono('00442079460958') === '+442079460958')
  ok('un +34 con las cifras mal no se acepta como español', claveDeTelefono('+3460011223') !== UNO)
}

console.log('\n=== varios teléfonos en el mismo campo ===')
{
  ok('separados por barra', JSON.stringify(clavesDeTelefonos('931112244 / 600112233')) === '["931112244","600112233"]')
  ok('separados por punto y coma o por coma', JSON.stringify(clavesDeTelefonos('600112233; 931112244')) === '["600112233","931112244"]' && JSON.stringify(clavesDeTelefonos('600112233, 931112244')) === '["600112233","931112244"]')
  ok('separados por guion con espacios', JSON.stringify(clavesDeTelefonos('600 112 233 - 931 112 244')) === '["600112233","931112244"]')
  ok('sin repetidos', JSON.stringify(clavesDeTelefonos('600112233 / +34 600 11 22 33')) === '["600112233"]')
  ok('un campo vacío da una lista vacía', clavesDeTelefonos(null).length === 0 && clavesDeTelefonos('').length === 0 && clavesDeTelefonos('n/a').length === 0)
  ok('un solo número con espacios no se parte por los espacios', JSON.stringify(clavesDeTelefonos('+34 600 11 22 33')) === '["600112233"]')
}

console.log('\n=== otros formatos reales de un campo con varios teléfonos ===')
{
  const claves = (t: string) => JSON.stringify(clavesDeTelefonos(t))
  ok('separados por « y » o « o »', claves('931112244 y 600112233') === '["931112244","600112233"]' && claves('931112244 o 600112233') === '["931112244","600112233"]')
  ok('separados por barra vertical o por salto de línea', claves('931112244|600112233') === '["931112244","600112233"]' && claves('931112244\n600112233') === '["931112244","600112233"]')
  ok('pegados con un solo espacio: dos números de nueve cifras', claves('931112244 600112233') === '["931112244","600112233"]')
  ok('pegados con espacios dentro de cada uno', claves('931 11 22 44 600 11 22 33') === '["931112244","600112233"]')
  ok('dos con el +34 delante', claves('+34 931112244 +34 600112233') === '["931112244","600112233"]')
  ok('tres de nueve cifras', claves('931112244 600112233 977000111') === '["931112244","600112233","977000111"]')
  ok('con una extensión detrás', claves('910 21 04 65 ext. 2') === '["910210465"]' && claves('931112244 (ext 12)') === '["931112244"]' && claves('931112244 extensión 3') === '["931112244"]')
  ok('con texto delante o detrás', claves('Tel: 931112244') === '["931112244"]' && claves('931112244 (centralita)') === '["931112244"]')
  ok('una tira de dieciocho cifras donde un trozo no es un número español NO se adivina', claves('931112244 123456789') === '[]')
  ok('una tira que no es múltiplo de nueve ni de once tampoco', claves('9311122446001122') === '[]')
  ok('uno de otro país suelto sigue siendo uno solo', claves('+44 20 7946 0958') === '["+442079460958"]')
}

console.log('\n=== cómo se lee en pantalla ===')
{
  ok('un español con espacios', telefonoLegible('+34600112233') === '+34 600 11 22 33')
  ok('un número oculto', telefonoLegible(null) === 'Número oculto' && telefonoLegible('') === 'Número oculto')
  ok('uno de fuera se deja como llegó', telefonoLegible('+442079460958') === '+442079460958')
}

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
