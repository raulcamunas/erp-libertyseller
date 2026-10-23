import { etiquetaLimpia, MAX_ETIQUETA, MAX_RUTA, rutaLimpia, textoCorto } from '@/lib/actividad/limpieza'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== rutaLimpia ===')
ok('una ruta normal queda igual', rutaLimpia('/dashboard/cold-calling') === '/dashboard/cold-calling')
ok('se quita la consulta y el fragmento', rutaLimpia('/dashboard/correo?buzon=abc&hilo=9#top') === '/dashboard/correo')
ok('un uuid pasa a :id', rutaLimpia('/dashboard/clients/3f2b8c1e-1a2b-4c3d-8e9f-0123456789ab/notas') === '/dashboard/clients/:id/notas')
ok('un número largo pasa a :id', rutaLimpia('/dashboard/leads/1234567') === '/dashboard/leads/:id')
ok('un número corto se queda (una página)', rutaLimpia('/dashboard/x/12') === '/dashboard/x/12')
ok('un token largo pasa a :id', rutaLimpia('/encajar/Xk3mP9qRtZ2vB7nLw4YsH8dJ') === '/encajar/:id')
ok('la raíz', rutaLimpia('/') === '/')
ok('sin barra inicial: nada', rutaLimpia('dashboard') === null)
ok('una dirección de otro sitio: nada', rutaLimpia('https://evil.com/x') === null)
ok('«//evil.com»: nada', rutaLimpia('//evil.com/x') === null)
ok('no es texto: nada', rutaLimpia(42) === null && rutaLimpia(null) === null && rutaLimpia(undefined) === null)
ok('se recorta lo larguísimo', (rutaLimpia(`/${'a/'.repeat(500)}`) ?? '').length <= MAX_RUTA)
ok('los trozos de un segmento se recortan a 40', rutaLimpia(`/${'x'.repeat(30)}-${'y'.repeat(30)}`)!.length <= 41)
ok('barras dobles se juntan', rutaLimpia('/dashboard//correo') === '/dashboard/correo')

console.log('\n=== etiquetaLimpia ===')
ok('un botón normal', etiquetaLimpia('Guardar') === 'Guardar')
ok('espacios y saltos se juntan', etiquetaLimpia('  Enviar \n  correo  ') === 'Enviar correo')
ok('vacío: nada', etiquetaLimpia('   ') === null)
ok('no es texto: nada', etiquetaLimpia(7) === null)
ok('un correo no se guarda', etiquetaLimpia('juan@empresa.com') === '(dato oculto)')
ok('un teléfono no se guarda', etiquetaLimpia('Llamar 600 123 456') === '(dato oculto)')
ok('una cifra larga no se guarda', etiquetaLimpia('Pedido 123456789') === '(dato oculto)')
ok('una dirección web no se guarda', etiquetaLimpia('Abrir https://x.com/y') === '(enlace)')
ok('una cifra corta sí (página 2)', etiquetaLimpia('Página 2') === 'Página 2')
{
  const larga = etiquetaLimpia('Esto es un texto larguísimo de botón que nadie debería tener '.repeat(3))!
  ok('lo largo se recorta con puntos suspensivos', larga.length <= MAX_ETIQUETA && larga.endsWith('…'), larga)
}
ok('caracteres de control fuera', etiquetaLimpia('A\u0000B\u0007C') === 'A B C')

console.log('\n=== textoCorto ===')
ok('recorta', textoCorto('abcdef', 3) === 'abc')
ok('vacío: nada', textoCorto('  ', 5) === null)
ok('no es texto: nada', textoCorto(undefined, 5) === null)
ok('quita saltos', textoCorto('a\nb', 10) === 'a b')

console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
