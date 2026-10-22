import { analizarMensaje, nombreDeFichero } from '@/lib/correo/analizar'
import { limpiarHtml } from '@/lib/correo/limpiar'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const igual = (n: string, real: unknown, esperado: unknown) => ok(n, JSON.stringify(real) === JSON.stringify(esperado), `real ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`)

/**
 * ANALIZAR UN CORREO: de los bytes del servidor a lo que se guarda.
 *
 * Los correos de abajo tienen la forma de los de verdad (cabeceras plegadas, asuntos codificados, partes anidadas,
 * imágenes incrustadas, HTML hostil). Lo único inventado son las personas y los dominios.
 */

const crlf = (s: string) => Buffer.from(s.replace(/\r?\n/g, '\r\n'), 'utf8')
const AHORA = new Date('2026-10-22T12:00:00Z')

async function main() {
  console.log('un correo de texto')
  {
    const m = await analizarMensaje(
      crlf(`Message-ID: <UNO.123@Mail.Cliente.ES>
Date: Wed, 21 Oct 2026 10:15:00 +0200
From: "Carmen Ruiz" <Carmen@Cliente.es>
To: Ana <ana@liberty.test>, bea@liberty.test
Cc: Luis <luis@z.es>
Subject: =?UTF-8?B?UHJvcHVlc3RhIGRlIEFtYXpvbiDwn5qA?=
MIME-Version: 1.0
Content-Type: text/plain; charset=utf-8
Content-Transfer-Encoding: 8bit

Hola Ana,
me interesa la propuesta. ¿Hablamos mañana?

Un saludo`),
      { ahora: AHORA }
    )
    igual('Message-ID normalizado', m.messageId, 'uno.123@mail.cliente.es')
    igual('remitente', [m.deNombre, m.deDireccion], ['Carmen Ruiz', 'carmen@cliente.es'])
    igual('para', m.para, [{ nombre: 'Ana', direccion: 'ana@liberty.test' }, { nombre: '', direccion: 'bea@liberty.test' }])
    igual('cc', m.cc, [{ nombre: 'Luis', direccion: 'luis@z.es' }])
    igual('asunto decodificado', m.asunto, 'Propuesta de Amazon 🚀')
    igual('fecha', m.fecha.toISOString(), '2026-10-21T08:15:00.000Z')
    ok('texto', m.texto.startsWith('Hola Ana,') && m.texto.includes('¿Hablamos mañana?'))
    igual('sin html', m.html, null)
    igual('vista previa', m.vistaPrevia, 'Hola Ana, me interesa la propuesta. ¿Hablamos mañana? Un saludo')
    igual('sin adjuntos', m.adjuntos, [])
    igual('no automático', m.automatico, false)
    igual('sin cabeceras de hilo', [m.enRespuestaA, m.referencias], [null, []])
  }

  console.log('una respuesta con cabeceras de hilo plegadas')
  {
    const m = await analizarMensaje(
      crlf(`Message-ID: <dos@liberty.test>
In-Reply-To: <UNO.123@mail.cliente.es>
References: <raiz@x.es>
 <UNO.123@mail.cliente.es>
Date: Wed, 21 Oct 2026 11:00:00 +0200
From: ana@liberty.test
To: carmen@cliente.es
Reply-To: Ventas <ventas@liberty.test>
Subject: Re: Propuesta
Content-Type: text/plain; charset=utf-8

Perfecto.

> Hola Ana
> ¿hablamos?`),
      { ahora: AHORA }
    )
    igual('En respuesta a', m.enRespuestaA, 'uno.123@mail.cliente.es')
    igual('References', m.referencias, ['raiz@x.es', 'uno.123@mail.cliente.es'])
    igual('Reply-To', m.responderA, [{ nombre: 'Ventas', direccion: 'ventas@liberty.test' }])
    igual('la vista previa no lleva lo citado', m.vistaPrevia, 'Perfecto.')
  }

  console.log('texto y HTML a la vez')
  {
    const m = await analizarMensaje(
      crlf(`Message-ID: <tres@x.es>
Date: Wed, 21 Oct 2026 10:15:00 +0200
From: a@x.es
To: b@y.es
Subject: Mira
MIME-Version: 1.0
Content-Type: multipart/alternative; boundary="B1"

--B1
Content-Type: text/plain; charset=utf-8

Hola texto
--B1
Content-Type: text/html; charset=utf-8

<html><body><p>Hola <b>html</b></p><script>alert(1)</script></body></html>
--B1--`),
      { ahora: AHORA }
    )
    ok('texto', m.texto === 'Hola texto')
    ok('html limpio', m.html !== null && m.html.includes('<b>html</b>') && !m.html.includes('script') && !m.html.includes('alert'), String(m.html))
  }

  console.log('solo HTML: el texto sale del HTML')
  {
    const m = await analizarMensaje(
      crlf(`Message-ID: <cuatro@x.es>
Date: Wed, 21 Oct 2026 10:15:00 +0200
From: a@x.es
To: b@y.es
Subject: Solo html
Content-Type: text/html; charset=utf-8

<p>Primera línea</p><p>Segunda <a href="https://liberty.es">enlace</a></p>`),
      { ahora: AHORA }
    )
    ok('hay texto', m.texto.includes('Primera línea') && m.texto.includes('Segunda'), m.texto)
    ok('hay html', m.html !== null && m.html.includes('href="https://liberty.es"'))
    ok('el enlace abre fuera y sin referer', m.html !== null && m.html.includes('target="_blank"') && m.html.includes('rel="noopener noreferrer nofollow"'), String(m.html))
  }

  console.log('adjuntos')
  {
    const pdf = Buffer.from('%PDF-1.4 contenido de prueba').toString('base64')
    const m = await analizarMensaje(
      crlf(`Message-ID: <cinco@x.es>
Date: Wed, 21 Oct 2026 10:15:00 +0200
From: a@x.es
To: b@y.es
Subject: Con adjunto
MIME-Version: 1.0
Content-Type: multipart/mixed; boundary="M1"

--M1
Content-Type: text/plain; charset=utf-8

Te adjunto la tarifa.
--M1
Content-Type: application/pdf; name="Tarifa 2026.pdf"
Content-Disposition: attachment; filename="Tarifa 2026.pdf"
Content-Transfer-Encoding: base64

${pdf}
--M1
Content-Type: application/octet-stream; name="../../etc/passwd"
Content-Disposition: attachment; filename="../../etc/passwd"
Content-Transfer-Encoding: base64

${pdf}
--M1--`),
      { ahora: AHORA }
    )
    igual('dos adjuntos con sus números', m.adjuntos.map((a) => [a.n, a.nombre, a.tipo]), [[0, 'Tarifa 2026.pdf', 'application/pdf'], [1, '_.._etc_passwd', 'application/octet-stream']])
    ok('tamaño del adjunto', m.adjuntos[0].tamano === '%PDF-1.4 contenido de prueba'.length, String(m.adjuntos[0].tamano))
    ok('el texto es el cuerpo', m.texto === 'Te adjunto la tarifa.')
  }

  console.log('imagen incrustada (cid)')
  {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082', 'hex').toString('base64')
    const m = await analizarMensaje(
      crlf(`Message-ID: <seis@x.es>
Date: Wed, 21 Oct 2026 10:15:00 +0200
From: a@x.es
To: b@y.es
Subject: Con logo
MIME-Version: 1.0
Content-Type: multipart/related; boundary="R1"

--R1
Content-Type: text/html; charset=utf-8

<p>Mira el logo</p><img src="cid:logo@x.es" width="120" height="40" alt="logo"><img src="cid:no-existe@x.es" alt="roto">
--R1
Content-Type: image/png; name="logo.png"
Content-Disposition: inline; filename="logo.png"
Content-ID: <logo@x.es>
Content-Transfer-Encoding: base64

${png}
--R1--`),
      { ahora: AHORA }
    )
    ok('la imagen se incrusta como data:', m.html !== null && m.html.includes('src="data:image/png;base64,'), String(m.html))
    ok('la imagen incrustada no se ofrece como adjunto', m.adjuntos.length === 0, JSON.stringify(m.adjuntos))
    ok('la imagen que no existe se quita', m.html !== null && !m.html.includes('no-existe'), String(m.html))
  }

  console.log('correos automáticos')
  {
    const base = (cabeceras: string) =>
      crlf(`Message-ID: <auto@x.es>
Date: Wed, 21 Oct 2026 10:15:00 +0200
From: Aviso <alguien@x.es>
To: b@y.es
Subject: Aviso
${cabeceras}
Content-Type: text/plain

Texto`)
    igual('Auto-Submitted', (await analizarMensaje(base('Auto-Submitted: auto-replied'), { ahora: AHORA })).automatico, true)
    igual('List-Unsubscribe', (await analizarMensaje(base('List-Unsubscribe: <mailto:baja@x.es>'), { ahora: AHORA })).automatico, true)
    igual('una persona', (await analizarMensaje(base('X-Mailer: Thunderbird'), { ahora: AHORA })).automatico, false)
  }

  console.log('fechas')
  {
    const con = (fecha: string) => crlf(`Message-ID: <f@x.es>\nDate: ${fecha}\nFrom: a@x.es\nTo: b@y.es\nSubject: x\n\nhola`)
    const servidor = new Date('2026-10-20T09:00:00Z')
    igual('fecha futura -> la del servidor', (await analizarMensaje(con('Wed, 21 Oct 2099 10:15:00 +0200'), { ahora: AHORA, fechaDelServidor: servidor })).fecha.toISOString(), servidor.toISOString())
    igual('sin fecha -> la del servidor', (await analizarMensaje(crlf('Message-ID: <g@x.es>\nFrom: a@x.es\nTo: b@y.es\nSubject: x\n\nhola'), { ahora: AHORA, fechaDelServidor: servidor })).fecha.toISOString(), servidor.toISOString())
    igual('sin nada -> ahora', (await analizarMensaje(crlf('From: a@x.es\nTo: b@y.es\nSubject: x\n\nhola'), { ahora: AHORA })).fecha.toISOString(), AHORA.toISOString())
    igual('fecha muy antigua (1970) -> la del servidor', (await analizarMensaje(con('Thu, 01 Jan 1970 00:00:00 +0000'), { ahora: AHORA, fechaDelServidor: servidor })).fecha.toISOString(), servidor.toISOString())
  }

  console.log('direcciones raras')
  {
    const m = await analizarMensaje(
      crlf(`Message-ID: <r@x.es>
Date: Wed, 21 Oct 2026 10:15:00 +0200
From: "Ana\\" <x@y.es>" <ana@x.es>
To: equipo: a@x.es, b@y.es;, no-es-una-direccion, "Pérez, Luis" <luis@z.es>
Subject: x

hola`),
      { ahora: AHORA }
    )
    igual('remitente', m.deDireccion, 'ana@x.es')
    igual('grupo y lista con basura', m.para.map((p) => p.direccion), ['a@x.es', 'b@y.es', 'luis@z.es'])
  }

  console.log('demasiado grande')
  {
    const m = await analizarMensaje(crlf('Message-ID: <g@x.es>\nDate: Wed, 21 Oct 2026 10:15:00 +0200\nFrom: a@x.es\nTo: b@y.es\nSubject: Vídeo\n\n'), { ahora: AHORA, soloCabeceras: { tamano: 24 * 1024 * 1024 } })
    igual('asunto', m.asunto, 'Vídeo')
    ok('aviso en el texto', m.texto.includes('24,0 MB') && m.texto.includes('webmail'), m.texto)
    igual('sin html ni adjuntos', [m.html, m.adjuntos], [null, []])
  }

  console.log('nombres de fichero')
  igual('quita rutas', nombreDeFichero('../../etc/passwd'), '_.._etc_passwd')
  igual('quita comillas y dos puntos', nombreDeFichero('a"b:c.pdf'), 'a_b_c.pdf')
  igual('quita puntos iniciales', nombreDeFichero('.htaccess'), 'htaccess')
  igual('sin nombre', nombreDeFichero(undefined), 'adjunto')
  igual('solo basura', nombreDeFichero('...'), 'adjunto')
  igual('tope', nombreDeFichero('a'.repeat(300)).length, 200)

  console.log('limpieza del HTML hostil')
  {
    const hostil = `
      <p onclick="robar()" style="color:red;background:url(https://evil.test/x.png);position:fixed;width:100px">Hola</p>
      <script>alert(1)</script>
      <img src="https://evil.test/p.gif" width="1" height="1">
      <img src="https://liberty.test/logo.png" width="120" height="40" onerror="x()">
      <img src="javascript:alert(1)">
      <a href="javascript:alert(1)">malo</a>
      <a href="data:text/html;base64,PHNjcmlwdD4=">malo2</a>
      <a href="https://liberty.es/ok">bueno</a>
      <a href="//evil.test/x">relativo al protocolo</a>
      <iframe src="https://evil.test"></iframe>
      <form action="https://evil.test"><input name="p"><button>Enviar</button></form>
      <object data="x.swf"></object><embed src="x.swf">
      <svg onload="alert(1)"><script>alert(2)</script></svg>
      <meta http-equiv="refresh" content="0;url=https://evil.test">
      <link rel="stylesheet" href="https://evil.test/x.css">
      <base href="https://evil.test/">
      <style>@import url(https://evil.test/x.css); p{color:blue; behavior:url(x.htc)} b{color:green}</style>
      <video src="x.mp4"></video>
      <table width="100%" bgcolor="#eee"><tr><td colspan="2" style="padding:4px;color:#333">celda</td></tr></table>`
    const l = limpiarHtml(hostil) ?? ''
    ok('hay resultado', l.length > 0)
    for (const prohibido of ['<script', 'onclick', 'onerror', 'onload', 'javascript:', '<iframe', '<form', '<input', '<button', '<object', '<embed', '<svg', '<meta', '<link', '<base', '<video', 'data:text/html', 'evil.test/p.gif', 'evil.test/x.png', '@import', 'behavior', '//evil.test', 'position', 'alert(']) {
      ok(`no queda «${prohibido}»`, !l.toLowerCase().includes(prohibido.toLowerCase()), l)
    }
    for (const permitido of ['Hola', 'https://liberty.test/logo.png', 'href="https://liberty.es/ok"', 'celda', 'colspan="2"', 'bgcolor="#eee"', 'padding:4px', 'color:#333', 'color:green']) {
      ok(`sigue «${permitido}»`, l.includes(permitido), l)
    }
    ok('el pixel de seguimiento se quita', !l.includes('evil.test/p.gif'))
    ok('las imágenes de fuera no pasan el referer', l.includes('referrerpolicy="no-referrer"'))
    // Lo relativo apuntaría a nuestro propio ERP: ni enlaces ni imágenes ni fondos
    const relativo = limpiarHtml('<a href="/dashboard/correo">ir</a><a href="#arriba">arriba</a><a href="mailto:a@x.es">correo</a><img src="/api/correo/adjuntos?mensaje=1&n=0" width="50" height="50"><img src="logo.png" width="50" height="50"><style>.a{background:url(/api/x)} .b{background:url("https://liberty.test/f.png")} .c{background:url(data:image/png;base64,AAAA)} .d{background:url(foto.jpg)}</style>') ?? ''
    ok('un enlace relativo se queda sin destino', !relativo.includes('/dashboard/correo'), relativo)
    ok('un ancla se conserva', relativo.includes('href="#arriba"'), relativo)
    ok('mailto se conserva', relativo.includes('href="mailto:a@x.es"'), relativo)
    ok('una imagen relativa se quita', !relativo.includes('/api/correo/adjuntos') && !relativo.includes('logo.png'), relativo)
    ok('un fondo relativo se quita', !relativo.includes('/api/x') && !relativo.includes('foto.jpg'), relativo)
    ok('un fondo de la web se conserva', relativo.includes('https://liberty.test/f.png'), relativo)
    ok('un fondo incrustado se conserva', relativo.includes('url(data:image/png;base64,AAAA)'), relativo)
    igual('vacío', limpiarHtml(''), null)
    igual('solo basura', limpiarHtml('<script>alert(1)</script>'), null)
    igual('demasiado grande', limpiarHtml(`<p>${'a'.repeat(1_600_000)}</p>`), null)
    ok('un data: de imagen que no es png/jpg/gif/webp se quita', !(limpiarHtml('<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">') ?? '').includes('svg'))
    ok('un data: de imagen buena se queda', (limpiarHtml('<img src="data:image/png;base64,iVBORw0KGgo=" width="40" height="40">') ?? '').includes('data:image/png;base64,iVBORw0KGgo='))
  }

  console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLOS`)
  process.exit(fallos === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('ERROR', e)
  process.exit(1)
})
