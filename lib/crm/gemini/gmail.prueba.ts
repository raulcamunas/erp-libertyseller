import { cabecera, correoDeGmail, cuerpoDeGmail, decodificarBase64Url, decodificarCabecera, encabezadoDeGmail, type MensajeDeGmail } from './gmail'
import { leerCorreoDeGemini } from './correo'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const TEXTO = 'Notas de Consultoría Estratégica Amazon · Liberty Seller · ANA PÉREZ\n\nResumen\n\nUna reunión de prueba con tildes: ñandú, ó, ü.\n\nPasos siguientes recomendados\n\n[Liberty Seller] Enviar propuesta: El viernes.'
const HTML = '<a href="https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcD/edit">Abrir notas de la reunión</a>'

const MENSAJE: MensajeDeGmail = {
  id: 'msg-77',
  internalDate: String(Date.parse('2026-10-20T08:54:44Z')),
  payload: {
    mimeType: 'multipart/alternative',
    headers: [
      { name: 'Subject', value: 'Notas: Consultoría Estratégica Amazon · Liberty Seller · ANA PÉREZ 20 oct 2026' },
      { name: 'From', value: 'Gemini <gemini-notes@google.com>' },
      { name: 'Date', value: 'Tue, 20 Oct 2026 10:54:44 +0200' },
    ],
    body: { size: 0 },
    parts: [
      { mimeType: 'text/plain', body: { size: TEXTO.length, data: b64url(TEXTO) } },
      { mimeType: 'text/html', body: { size: HTML.length, data: b64url(HTML) } },
    ],
  },
}

console.log('\n=== base64url ===')
{
  ok('con tildes y símbolos', decodificarBase64Url(b64url('ñandú · ó ü —')) === 'ñandú · ó ü —')
  ok('con los caracteres propios de base64url («-» y «_»)', decodificarBase64Url(b64url('>>>???~~~')) === '>>>???~~~' && b64url('>>>???~~~').match(/[-_]/) !== null)
  ok('vacío', decodificarBase64Url('') === '')
}

console.log('\n=== cabeceras ===')
{
  ok('sin mirar mayúsculas', cabecera(MENSAJE.payload, 'subject').startsWith('Notas:') && cabecera(MENSAJE.payload, 'FROM').includes('gemini-notes@google.com'))
  ok('una que no está, vacía', cabecera(MENSAJE.payload, 'X-Nada') === '' && cabecera(undefined, 'Subject') === '')
  const codificado = '=?UTF-8?B?Tm90YXM6IENvbnN1bHRvcsOtYSDCtyBBbmE=?='
  ok('palabra codificada en base64', decodificarCabecera(codificado) === 'Notas: Consultoría · Ana', decodificarCabecera(codificado))
  ok('palabra codificada en quoted-printable', decodificarCabecera('=?UTF-8?Q?Consultor=C3=ADa_Estrat=C3=A9gica?=') === 'Consultoría Estratégica', decodificarCabecera('=?UTF-8?Q?Consultor=C3=ADa_Estrat=C3=A9gica?='))
  ok('dos palabras seguidas se unen sin el espacio de en medio', decodificarCabecera('=?UTF-8?B?Q29uc3Vs?= =?UTF-8?B?dG9yw61h?=') === 'Consultoría', decodificarCabecera('=?UTF-8?B?Q29uc3Vs?= =?UTF-8?B?dG9yw61h?='))
  ok('mezclada con texto normal', decodificarCabecera('Notas: =?UTF-8?B?w7M=?= fin') === 'Notas: ó fin')
  ok('un texto normal pasa tal cual', decodificarCabecera('Notas: algo') === 'Notas: algo')
  ok('una palabra codificada rota no revienta', typeof decodificarCabecera('=?UTF-8?B?%%%?=') === 'string')
}

console.log('\n=== el cuerpo ===')
{
  const c = cuerpoDeGmail(MENSAJE.payload)
  ok('texto plano y HTML, decodificados', c.texto === TEXTO && c.html === HTML)
  const anidado = cuerpoDeGmail({
    mimeType: 'multipart/mixed',
    parts: [{ mimeType: 'multipart/related', parts: [{ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: b64url('hola') } }, { mimeType: 'text/html', body: { data: b64url('<b>hola</b>') } }] }] }, { mimeType: 'application/pdf', body: { attachmentId: 'xyz', size: 100 } }],
  })
  ok('con las partes anidadas', anidado.texto === 'hola' && anidado.html === '<b>hola</b>')
  ok('un adjunto no se lee como texto', !anidado.texto.includes('xyz'))
  const unTrozo = cuerpoDeGmail({ mimeType: 'text/plain', body: { data: b64url('solo texto') } })
  ok('un mensaje de un solo trozo lleva el cuerpo en el propio payload', unTrozo.texto === 'solo texto' && unTrozo.html === '')
  ok('sin payload, vacío', cuerpoDeGmail(undefined).texto === '' && cuerpoDeGmail({}).html === '')
}

console.log('\n=== el mensaje entero ===')
{
  const c = correoDeGmail(MENSAJE)
  ok('sale un correo con id, asunto, remitente y hora de llegada', c !== null && c.id === 'msg-77' && c.asunto.startsWith('Notas: Consultoría') && c.remitente.includes('gemini-notes@google.com') && c.recibidoMs === Date.parse('2026-10-20T08:54:44Z'))
  const nota = c ? leerCorreoDeGemini(c) : null
  ok('y ese correo lo entiende el lector de Gemini, de punta a punta', nota !== null && nota.titulo === 'Consultoría Estratégica Amazon · Liberty Seller · ANA PÉREZ' && nota.gmailMessageId === 'msg-77' && nota.driveFileId === '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcD' && nota.proximosPasos.length === 1 && nota.fechaReunion === '2026-10-20T08:54:44.000Z', JSON.stringify(nota?.fechaReunion))
  ok('sin id o sin payload, null', correoDeGmail({ payload: MENSAJE.payload }) === null && correoDeGmail({ id: 'x' }) === null)
  const sinFecha = correoDeGmail({ ...MENSAJE, internalDate: undefined })
  ok('sin hora de llegada, NaN (el lector ya lo trata)', sinFecha !== null && Number.isNaN(sinFecha.recibidoMs) && leerCorreoDeGemini(sinFecha)?.fechaReunion === null)
  const asuntoCodificado = correoDeGmail({ ...MENSAJE, payload: { ...MENSAJE.payload, headers: [{ name: 'Subject', value: '=?UTF-8?B?Tm90YXM6IENvbnN1bHRvcsOtYSDCtyBBbmE=?=' }, { name: 'From', value: 'gemini-notes@google.com' }] } })
  ok('un asunto codificado se decodifica', asuntoCodificado?.asunto === 'Notas: Consultoría · Ana')
}

console.log('\n=== solo el encabezado (sin abrir el cuerpo) ===')
{
  // Un mensaje pedido en formato «metadata»: cabeceras y hora, y ni rastro del cuerpo
  const soloCabeceras: MensajeDeGmail = { id: 'msg-5', internalDate: String(Date.parse('2026-10-21T10:00:00Z')), payload: { headers: [{ name: 'Subject', value: 'Notas: Reunión Semanal | Comerciales 21 oct 2026' }, { name: 'From', value: 'Gemini <gemini-notes@google.com>' }] } }
  const e = encabezadoDeGmail(soloCabeceras)
  ok('asunto, remitente y hora de llegada', e !== null && e.id === 'msg-5' && e.asunto.startsWith('Notas: Reunión Semanal') && e.remitente.includes('gemini-notes@google.com') && e.recibidoMs === Date.parse('2026-10-21T10:00:00Z'))
  ok('con el asunto codificado también', encabezadoDeGmail({ ...soloCabeceras, payload: { headers: [{ name: 'Subject', value: '=?UTF-8?B?Tm90YXM6IENvbnN1bHRvcsOtYSDCtyBBbmE=?=' }, { name: 'From', value: 'x' }] } })?.asunto === 'Notas: Consultoría · Ana')
  ok('sin id o sin cabeceras, null', encabezadoDeGmail({ payload: soloCabeceras.payload }) === null && encabezadoDeGmail({ id: 'x' }) === null)
  ok('sin hora, NaN', Number.isNaN(encabezadoDeGmail({ ...soloCabeceras, internalDate: undefined })!.recibidoMs))
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
