import {
  citarTexto,
  documentoDeCorreo,
  documentoDeTexto,
  encabezadoDeCita,
  escaparHtml,
  htmlATextoBasico,
  htmlDeRespuesta,
  textoAHtml,
  textoDeRespuesta,
  vistaPrevia,
} from '@/lib/correo/html'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const igual = (n: string, real: unknown, esperado: unknown) => ok(n, JSON.stringify(real) === JSON.stringify(esperado), `real ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`)

/** HTML: escribir, citar y enseñar el texto de un correo. */

console.log('escaparHtml y textoAHtml')
igual('escapa', escaparHtml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;')
ok('un texto con etiquetas no genera etiquetas', !textoAHtml('<script>alert(1)</script>').includes('<script'))
ok('los saltos de línea pasan a <br>', textoAHtml('uno\ndos').includes('uno<br>dos'))
ok('los saltos \\r\\n también', textoAHtml('uno\r\ndos').includes('uno<br>dos') && !textoAHtml('uno\r\ndos').includes('\r'))
ok('una URL pasa a enlace', textoAHtml('mira https://liberty.es/x ahora').includes('<a href="https://liberty.es/x" target="_blank" rel="noopener noreferrer">https://liberty.es/x</a> ahora'))
ok('el punto final no entra en el enlace', textoAHtml('mira https://liberty.es/x.').includes('href="https://liberty.es/x"') && textoAHtml('mira https://liberty.es/x.').includes('</a>.'))
ok('el paréntesis de cierre de la frase no entra', textoAHtml('(mira https://liberty.es/x)').includes('href="https://liberty.es/x"'))
ok('el paréntesis de una URL de wikipedia sí', textoAHtml('https://es.wikipedia.org/wiki/X_(y)').includes('href="https://es.wikipedia.org/wiki/X_(y)"'))
ok('una URL con comillas no rompe el atributo', !/href="[^"]*"[^>]*"[^>]*>/.test(textoAHtml('https://a.es/x"onmouseover="alert(1)').replace(/target="_blank" rel="noopener noreferrer"/g, '')))
ok('javascript: no se enlaza', !textoAHtml('javascript:alert(1)').includes('<a '))

console.log('citas')
igual('citarTexto', citarTexto('uno\n\ndos'), '> uno\n>\n> dos')
ok('encabezado de cita', encabezadoDeCita(new Date('2026-10-21T08:15:00Z'), 'Ana <ana@x.es>').startsWith('El 21 de octubre de 2026, 10:15, Ana <ana@x.es> escribió:'), encabezadoDeCita(new Date('2026-10-21T08:15:00Z'), 'Ana <ana@x.es>'))
ok('respuesta en HTML: lo escrito y lo citado', htmlDeRespuesta('Gracias', { encabezado: 'El lunes, Ana escribió:', texto: 'Hola\nQué tal' }).includes('Gracias') && htmlDeRespuesta('Gracias', { encabezado: 'El lunes, Ana escribió:', texto: 'Hola\nQué tal' }).includes('<blockquote'))
ok('respuesta en HTML: lo citado va escapado', !htmlDeRespuesta('x', { encabezado: 'e', texto: '<img src=x onerror=alert(1)>' }).includes('<img'))
ok('respuesta en HTML sin cita', !htmlDeRespuesta('Gracias').includes('<blockquote'))
igual('respuesta en texto', textoDeRespuesta('Gracias', { encabezado: 'El lunes, Ana escribió:', texto: 'Hola' }), 'Gracias\n\nEl lunes, Ana escribió:\n> Hola')
igual('respuesta en texto sin cita', textoDeRespuesta('Gracias'), 'Gracias')

console.log('vistaPrevia')
igual('texto normal', vistaPrevia('Hola Ana,\nTe paso la propuesta.\nUn saludo'), 'Hola Ana, Te paso la propuesta. Un saludo')
igual('sin lo citado', vistaPrevia('Perfecto, mañana hablamos.\n\n> Hola\n> ¿hablamos?'), 'Perfecto, mañana hablamos.')
igual('corta en el encabezado de una cita (español)', vistaPrevia('Vale.\nEl lun, 21 oct 2026 a las 10:15, Ana <ana@x.es> escribió:\n> hola'), 'Vale.')
igual('corta en el encabezado de una cita (inglés)', vistaPrevia('Ok.\nOn Mon, Oct 21, 2026 at 10:15 AM Ana <ana@x.es> wrote:\n> hi'), 'Ok.')
igual('corta en un reenviado', vistaPrevia('Mira esto\n---------- Mensaje reenviado ----------\nDe: Ana'), 'Mira esto')
igual('si es solo una cita, se enseña la cita', vistaPrevia('> hola\n> qué tal'), 'hola qué tal')
igual('recorta con puntos suspensivos', vistaPrevia('a'.repeat(300), 20), `${'a'.repeat(19)}…`)
igual('vacío', vistaPrevia('   \n  '), '')

console.log('htmlATextoBasico')
igual('quita etiquetas, estilos y entidades', htmlATextoBasico('<style>p{color:red}</style><p>Hola&nbsp;<b>Ana</b></p><p>Qué&amp;tal</p>'), 'Hola Ana\n\nQué&tal')

console.log('documentos para el iframe')
const sin = documentoDeCorreo('<p>hola</p>', { imagenesDeFuera: false })
const con = documentoDeCorreo('<p>hola</p>', { imagenesDeFuera: true })
ok('lleva su política de contenido', sin.includes('Content-Security-Policy'))
ok("por defecto no carga imágenes de fuera", sin.includes("img-src data:;") && !sin.includes('img-src data: https:'))
ok('pidiéndolas, las carga', con.includes('img-src data: https: http:'))
ok("no permite scripts ni conexiones", sin.includes("default-src 'none'") && !sin.includes('script-src') && !sin.includes('connect-src'))
ok('no permite formularios', sin.includes("form-action 'none'"))
ok('fondo blanco', sin.includes('background:#ffffff'))
ok('el cuerpo va dentro', sin.includes('<body><p>hola</p></body>'))
ok('el texto plano se escapa', !documentoDeTexto('<script>x</script>', { imagenesDeFuera: false }).includes('<script>x'))
ok('el texto plano respeta saltos de línea', documentoDeTexto('a\nb', { imagenesDeFuera: false }).includes('a<br>b'))

console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
