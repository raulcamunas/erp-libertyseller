import { AmazonApiError, humanMessageOf } from '@/lib/amazon/errors'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const GENERICO = 'Ha fallado la llamada a Amazon y no ha dicho por qué. Vuelve a intentarlo dentro de un rato.'

console.log('\n=== humanMessageOf ===')

// Un error de Amazon ya trae su frase
{
  const e = new AmazonApiError({ kind: 'servidor', message: 'tecnico', humanMessage: 'Amazon está fallando por su lado.' })
  ok('un error de Amazon dice su frase', humanMessageOf(e) === 'Amazon está fallando por su lado.')
}

// Un Error normal dice su mensaje
ok('un Error con mensaje dice su mensaje', humanMessageOf(new Error('El stock 3,5 no es entero')) === 'El stock 3,5 no es entero')

// LO QUE FALTABA: los errores de Supabase/PostgREST son objetos sueltos, no `Error`
{
  const deLaBase = {
    message: 'new row for relation "amazon_submissions" violates check constraint "amazon_submissions_source_ref_check"',
    code: '23514',
    details: 'Failing row contains (secreto-que-no-debe-salir, 46664, 287.75)',
    hint: null,
  }
  const frase = humanMessageOf(deLaBase)
  ok('un error de la base de datos NO se disfraza de «fallo de Amazon»', frase !== GENERICO, frase)
  ok('dice qué ha pasado', frase.includes('violates check constraint'), frase)
  ok('dice el código', frase.includes('(23514)'), frase)
  ok('NO copia `details`, que lleva la fila entera', !frase.includes('secreto-que-no-debe-salir'), frase)
}
{
  const largo = { message: 'x'.repeat(1000), code: '57014' }
  ok('un mensaje enorme se recorta', humanMessageOf(largo).length < 400)
}
ok('sin código tampoco falla', humanMessageOf({ message: 'timeout' }) === 'Error de la base de datos: timeout')

// Lo que de verdad no se puede describir sigue diciendo la frase de siempre
ok('un objeto sin mensaje', humanMessageOf({ code: '23514' }) === GENERICO)
ok('un mensaje vacío', humanMessageOf({ message: '   ', code: '1' }) === GENERICO)
ok('null', humanMessageOf(null) === GENERICO)
ok('undefined', humanMessageOf(undefined) === GENERICO)
ok('un texto suelto', humanMessageOf('boom') === GENERICO)
ok('un Error sin mensaje', humanMessageOf(new Error('')) === GENERICO)

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
