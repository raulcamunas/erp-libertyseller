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
  tieneDisenoPropio,
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
igual('el encabezado de la cita partido en dos líneas (Gmail)', vistaPrevia('Hola\n\nEl jue, 22 oct 2026 a las 18:59, Daniela Guzman <daniela@libertyseller.es>\nescribió:\n> correo de prueba'), 'Hola')
igual('el encabezado partido en tres líneas', vistaPrevia('Vale\nOn Thu, Oct 22, 2026 at 6:59 PM Daniela Guzman\n<daniela@x.es>\nwrote:\n> test'), 'Vale')
igual('una frase que empieza por «El» pero no es una cita se conserva', vistaPrevia('El presupuesto está listo\nUn saludo'), 'El presupuesto está listo Un saludo')
igual('«On» sin cita detrás se conserva', vistaPrevia('On Monday we ship it\nthanks'), 'On Monday we ship it thanks')
igual('recorta con puntos suspensivos', vistaPrevia('a'.repeat(300), 20), `${'a'.repeat(19)}…`)
igual('vacío', vistaPrevia('   \n  '), '')

console.log('htmlATextoBasico')
igual('quita etiquetas, estilos y entidades', htmlATextoBasico('<style>p{color:red}</style><p>Hola&nbsp;<b>Ana</b></p><p>Qué&amp;tal</p>'), 'Hola Ana\n\nQué&tal')

console.log('documentos para el iframe')
const sin = documentoDeCorreo('<p>hola</p>', { imagenesDeFuera: false, fondo: 'claro' })
const con = documentoDeCorreo('<p>hola</p>', { imagenesDeFuera: true, fondo: 'claro' })
ok('lleva su política de contenido', sin.includes('Content-Security-Policy'))
ok("por defecto no carga imágenes de fuera", sin.includes("img-src data:;") && !sin.includes('img-src data: https:'))
ok('pidiéndolas, las carga', con.includes('img-src data: https: http:'))
ok("no permite scripts ni conexiones", sin.includes("default-src 'none'") && !sin.includes('script-src') && !sin.includes('connect-src'))
ok('no permite formularios', sin.includes("form-action 'none'"))
ok('el cuerpo va dentro', sin.includes('<body><p>hola</p></body>'))

console.log('el fondo')
ok('claro: un gris suave, no blanco puro', sin.includes('background:#eceef2') && !sin.includes('#ffffff'))
ok('claro: sin filtros', !sin.includes('filter'))
const oscuro = documentoDeCorreo('<p>hola</p>', { imagenesDeFuera: false, fondo: 'oscuro' })
ok('oscuro: invierte el conjunto', oscuro.includes('filter:invert(1) hue-rotate(180deg)'))
ok('oscuro: el lienzo de detrás es el fondo oscuro del ERP', oscuro.includes('html{margin:0;padding:0;background:#1a1d22}'))
ok('oscuro: el cuerpo lleva el color que, ya invertido, es ese fondo', oscuro.includes('body{margin:0;background:#e0e3e8'))
ok('oscuro: las imágenes se vuelven a invertir para verse como son', oscuro.includes('img,video{filter:invert(1) hue-rotate(180deg)}'))
ok('oscuro: la política de contenido sigue puesta', oscuro.includes("default-src 'none'") && oscuro.includes('img-src data:;'))
ok('oscuro: no tiene el blanco de antes', !oscuro.includes('#ffffff'))

// El color del cuerpo del documento oscuro es el que la inversión devuelve al fondo del ERP: se comprueba con la propia matriz de CSS
function invertir(rgb: [number, number, number]): [number, number, number] {
  const x = rgb.map((v) => v / 255)
  const m = [[-0.574, 1.43, 0.144], [0.426, 0.43, 0.144], [0.426, 1.43, -0.856]]
  return m.map((fila) => Math.round((1 - (fila[0] * x[0] + fila[1] * x[1] + fila[2] * x[2])) * 255)) as [number, number, number]
}
igual('#e0e3e8 invertido es #1a1d22 (26, 29, 34)', invertir([0xe0, 0xe3, 0xe8]).map((v) => Math.abs(v - [26, 29, 34][invertir([0xe0, 0xe3, 0xe8]).indexOf(v)]) <= 1), [true, true, true])
igual('invertir dos veces devuelve el color de partida (por eso las imágenes quedan bien)', invertir(invertir([200, 120, 40])).map((v, i) => Math.abs(v - [200, 120, 40][i]) <= 2), [true, true, true])

console.log('solo texto')
const textoClaro = documentoDeTexto('<script>x</script>', { imagenesDeFuera: false, fondo: 'claro' })
const textoOscuro = documentoDeTexto('hola\nque tal https://liberty.es', { imagenesDeFuera: false, fondo: 'oscuro' })
ok('el texto se escapa en claro', !textoClaro.includes('<script>x'))
ok('el texto se escapa en oscuro', !documentoDeTexto('<script>x</script>', { imagenesDeFuera: false, fondo: 'oscuro' }).includes('<script>x'))
ok('respeta saltos de línea', textoOscuro.includes('hola<br>que tal'))
ok('oscuro: pinta directamente con la paleta del ERP, sin invertir nada', textoOscuro.includes('background:#1a1d22') && textoOscuro.includes('color:#e4e6ea') && !textoOscuro.includes('filter'))
ok('oscuro: los enlaces son legibles sobre oscuro', textoOscuro.includes('a{color:#8ab4ff}'))
ok('oscuro: lleva la política de contenido', textoOscuro.includes("default-src 'none'"))
ok('claro: sobre el gris suave', textoClaro.includes('background:#eceef2'))

console.log('tieneDisenoPropio')
ok('una respuesta de Gmail no tiene diseño', !tieneDisenoPropio('<div dir="ltr">Hola</div><div class="gmail_quote"><blockquote style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">correo de prueba</blockquote></div>'))
ok('texto con estilos de tipografía: no', !tieneDisenoPropio('<div style="font-family:Arial;font-size:14px;color:#222222">hola</div>'))
ok('con color de texto explícito (negro): no', !tieneDisenoPropio('<span style="color:#000000">hola</span><font color="#000000">x</font>'))
ok('fondo blanco explícito: no', !tieneDisenoPropio('<div style="background:white">a</div><div style="background-color:#ffffff">b</div><div style="background:#fff">c</div><table bgcolor="#ffffff"><tr><td>d</td></tr></table>'))
ok('fondo transparente o ninguno: no', !tieneDisenoPropio('<div style="background:transparent">a</div><div style="background:none">b</div><div style="background-color:rgba(255,255,255,0.9)">c</div>'))
ok('fondo de color en estilo en línea: sí', tieneDisenoPropio('<div style="background:#ff9900">a</div>'))
ok('background-color de color: sí', tieneDisenoPropio('<td style="padding:4px;background-color: #232f3e;color:white">a</td>'))
ok('bgcolor de color: sí', tieneDisenoPropio('<table bgcolor="#eeeeee"><tr><td>a</td></tr></table>'))
ok('bgcolor sin comillas: sí', tieneDisenoPropio('<table bgcolor=#eeeeee><tr><td>a</td></tr></table>'))
ok('un fondo de color en un bloque <style>: sí', tieneDisenoPropio('<style>.cabecera{background:#232f3e}</style><div class="cabecera">a</div>'))
ok('un fondo con imagen: sí', tieneDisenoPropio('<div style="background:#fff url(https://x.es/f.png)">a</div>'))
ok('una imagen: sí (un logo transparente con letras oscuras no se vería sobre oscuro)', tieneDisenoPropio('<p>Un saludo</p><img src="data:image/png;base64,AAAA" width="80">'))
ok('una imagen en mayúsculas: sí', tieneDisenoPropio('<IMG SRC="x">'))
ok('«background» dentro de un texto normal no cuenta', !tieneDisenoPropio('<p>El background de este proyecto es largo</p>'))
ok('vacío: no', !tieneDisenoPropio(''))

console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
