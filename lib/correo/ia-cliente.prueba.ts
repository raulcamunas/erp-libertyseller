import { SUGERENCIAS_DE_CAMBIO, cuerpoEscrito, hayCuerpoEscrito, ponerBorradorIa, sumarIndicacion } from '@/lib/correo/ia-cliente'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const FIRMA = 'Ana López\nLiberty Seller'
const CUERPO = 'Hola,\n\nTe escribo por una cosa.\n\nUn saludo,'

console.log('\n=== ponerBorradorIa ===')
ok('cuerpo y firma debajo, como un mensaje en blanco', ponerBorradorIa(FIRMA, CUERPO) === `${CUERPO}\n\n${FIRMA}`)
ok('sin firma, solo el cuerpo', ponerBorradorIa(null, CUERPO) === CUERPO && ponerBorradorIa('', CUERPO) === CUERPO && ponerBorradorIa('  \n ', CUERPO) === CUERPO)
ok('quita los saltos de línea de más del cuerpo', ponerBorradorIa(FIRMA, `\n\n${CUERPO}\n\n\n`) === `${CUERPO}\n\n${FIRMA}`)
ok('no duplica la firma al volver a redactar', ponerBorradorIa(FIRMA, 'Otro texto\n\nUn saludo,') === `Otro texto\n\nUn saludo,\n\n${FIRMA}`)
ok('la firma del buzón se recorta antes de ponerla', ponerBorradorIa(`\n${FIRMA}\n\n`, CUERPO) === `${CUERPO}\n\n${FIRMA}`)

console.log('\n=== cuerpoEscrito y hayCuerpoEscrito ===')
ok('el cuerpo es lo de encima de la firma', cuerpoEscrito(`${CUERPO}\n\n${FIRMA}`, FIRMA) === CUERPO)
ok('un mensaje en blanco (solo la firma) no tiene cuerpo', cuerpoEscrito(`\n\n${FIRMA}`, FIRMA) === '' && !hayCuerpoEscrito(`\n\n${FIRMA}`, FIRMA))
ok('un mensaje vacío sin firma no tiene cuerpo', !hayCuerpoEscrito('', null))
ok('menos de 20 caracteres no cuenta como cuerpo', !hayCuerpoEscrito(`Hola\n\n${FIRMA}`, FIRMA))
ok('un cuerpo de verdad sí', hayCuerpoEscrito(`${CUERPO}\n\n${FIRMA}`, FIRMA))
ok('sin firma, todo lo escrito es cuerpo', cuerpoEscrito('Un texto cualquiera', null) === 'Un texto cualquiera')

console.log('\n=== sumarIndicacion ===')
ok('a un campo vacío', sumarIndicacion('', 'Más corto') === 'Más corto')
ok('a uno con algo, con un punto de separación', sumarIndicacion('Que mencione la llamada', 'Más corto') === 'Que mencione la llamada. Más corto')
ok('sin repetir (aunque cambien las mayúsculas)', sumarIndicacion('más corto', 'Más corto') === 'más corto')
ok('quita la puntuación final antes de sumar', sumarIndicacion('Que mencione la llamada.', 'Más corto') === 'Que mencione la llamada. Más corto')
ok('hay sugerencias', SUGERENCIAS_DE_CAMBIO.length >= 4 && SUGERENCIAS_DE_CAMBIO.every((s) => s.length < 40))

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
