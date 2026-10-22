import {
  analizarLista,
  dominioDe,
  esDireccionValida,
  etiquetaDePersona,
  limpiarNombre,
  leerLista,
  lineaDePersonas,
  normalizarDireccion,
  sinRepetidas,
} from '@/lib/correo/direcciones'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const igual = (n: string, real: unknown, esperado: unknown) => ok(n, JSON.stringify(real) === JSON.stringify(esperado), `real ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`)

/** DIRECCIONES: validar, normalizar y leer listas escritas a mano. */

console.log('normalizarDireccion')
igual('minúsculas y sin espacios', normalizarDireccion('  Ana.Lopez@Cliente.ES '), 'ana.lopez@cliente.es')
igual('con signo +', normalizarDireccion('ana+ventas@cliente.es'), 'ana+ventas@cliente.es')
igual('subdominios', normalizarDireccion('a@mail.eu.cliente.co.uk'), 'a@mail.eu.cliente.co.uk')
igual('dominio punycode', normalizarDireccion('a@xn--espaa-rta.es'), 'a@xn--espaa-rta.es')
igual('sin arroba', normalizarDireccion('ana.cliente.es'), null)
igual('sin parte local', normalizarDireccion('@cliente.es'), null)
igual('dominio sin punto', normalizarDireccion('ana@localhost'), null)
igual('punto al principio', normalizarDireccion('.ana@cliente.es'), null)
igual('dos puntos seguidos', normalizarDireccion('an..a@cliente.es'), null)
igual('extensión de una letra', normalizarDireccion('ana@cliente.e'), null)
igual('extensión con cifras', normalizarDireccion('ana@cliente.e1'), null)
igual('guion al principio de la etiqueta', normalizarDireccion('ana@-cliente.es'), null)
igual('espacio dentro', normalizarDireccion('an a@cliente.es'), null)
igual('coma dentro', normalizarDireccion('ana,b@cliente.es'), null)
igual('salto de línea (inyección de cabecera)', normalizarDireccion('ana@cliente.es\r\nBcc: otro@x.es'), null)
igual('salto de línea al final', normalizarDireccion('ana@cliente.es\n'), 'ana@cliente.es')
igual('comillas', normalizarDireccion('"ana"@cliente.es'), null)
igual('mayor y menor', normalizarDireccion('<ana@cliente.es>'), null)
igual('no es texto', normalizarDireccion(42), null)
igual('demasiado larga', normalizarDireccion(`${'a'.repeat(65)}@cliente.es`), null)
igual('64 caracteres en la parte local', normalizarDireccion(`${'a'.repeat(64)}@cliente.es`), `${'a'.repeat(64)}@cliente.es`)
ok('esDireccionValida', esDireccionValida('ana@cliente.es') && !esDireccionValida('ana'))
igual('dominioDe', dominioDe('ana@Cliente.es'), 'cliente.es')

console.log('limpiarNombre')
igual('quita comillas de adorno', limpiarNombre('"Ana López"'), 'Ana López')
igual('quita comillas dobles anidadas', limpiarNombre('""Ana""'), 'Ana')
igual('quita saltos de línea', limpiarNombre('Ana\r\nBcc: x@y.es'), 'Ana Bcc: x@y.es')
igual('quita ángulos', limpiarNombre('Ana <x>'), 'Ana x')
igual('desescapa comillas', limpiarNombre('Ana \\"la jefa\\"'), 'Ana "la jefa"')
igual('tope de 120', limpiarNombre('a'.repeat(300)).length, 120)
igual('no es texto', limpiarNombre(undefined), '')

console.log('analizarLista')
igual('una sola', analizarLista('ana@cliente.es'), [{ nombre: '', direccion: 'ana@cliente.es' }])
igual('con nombre', analizarLista('Ana López <ANA@cliente.es>'), [{ nombre: 'Ana López', direccion: 'ana@cliente.es' }])
igual('varias por comas', analizarLista('a@x.es, b@y.es'), [
  { nombre: '', direccion: 'a@x.es' },
  { nombre: '', direccion: 'b@y.es' },
])
igual('por punto y coma y salto de línea', analizarLista('a@x.es; b@y.es\nc@z.es'), [
  { nombre: '', direccion: 'a@x.es' },
  { nombre: '', direccion: 'b@y.es' },
  { nombre: '', direccion: 'c@z.es' },
])
igual('coma dentro del nombre entre comillas', analizarLista('"Pérez, Luis" <luis@z.es>, b@y.es'), [
  { nombre: 'Pérez, Luis', direccion: 'luis@z.es' },
  { nombre: '', direccion: 'b@y.es' },
])
igual('coma dentro de los ángulos no parte', analizarLista('Luis <luis@z.es>'), [{ nombre: 'Luis', direccion: 'luis@z.es' }])
igual('descarta lo que no es dirección', analizarLista('hola, a@x.es, nada@'), [{ nombre: '', direccion: 'a@x.es' }])
igual('repetidas', analizarLista('a@x.es, A@X.es, Ana <a@x.es>'), [{ nombre: 'Ana', direccion: 'a@x.es' }])
igual('desde un array', analizarLista(['a@x.es', 'Bea <b@y.es>']), [
  { nombre: '', direccion: 'a@x.es' },
  { nombre: 'Bea', direccion: 'b@y.es' },
])
igual('vacío', analizarLista(''), [])
igual('no es texto', analizarLista(null), [])
igual('la inyección en el nombre no crea otra dirección', analizarLista('Ana\r\nBcc: x@y.es <ana@x.es>').map((p) => p.direccion), ['ana@x.es'])
igual('sinRepetidas conserva el primer nombre', sinRepetidas([{ nombre: '', direccion: 'a@x.es' }, { nombre: 'Ana', direccion: 'a@x.es' }]), [{ nombre: 'Ana', direccion: 'a@x.es' }])
igual('etiqueta con nombre', etiquetaDePersona({ nombre: 'Ana', direccion: 'a@x.es' }), 'Ana <a@x.es>')
igual('etiqueta sin nombre', etiquetaDePersona({ nombre: '', direccion: 'a@x.es' }), 'a@x.es')
igual('línea de personas', lineaDePersonas([{ nombre: 'Ana', direccion: 'a@x.es' }], [{ nombre: '', direccion: 'b@y.es' }]), 'Ana a@x.es, b@y.es')

console.log('leerLista: lo que no entra se dice')
igual('todo bien', leerLista('a@x.es, Bea <b@y.es>').invalidas, [])
igual('una a medias', leerLista('a@x.es, ana@, b@y.es').invalidas, ['ana@'])
igual('y las buenas siguen', leerLista('a@x.es, ana@, b@y.es').personas.map((p) => p.direccion), ['a@x.es', 'b@y.es'])
igual('varias malas', leerLista('hola; a@x.es; b@; ').invalidas, ['hola', 'b@'])
igual('una repetida no es inválida', leerLista('a@x.es, A@x.es').invalidas, [])
igual('sin saltos de línea en lo que se devuelve', leerLista('mal\r\nBcc: x').invalidas.every((i) => !/[\r\n]/.test(i)), true)
igual('vacío', leerLista('   ').invalidas, [])
igual('con ángulos mal cerrados', leerLista('Ana <ana@x.es').invalidas.length, 1)

console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
