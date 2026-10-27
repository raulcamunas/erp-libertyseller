import { clasificarFalloDeToken, clasificarRespuestaDeGoogle, ErrorDeGoogle, falloDeRed, FRASE_DE_PERMISOS } from './errores-google'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

console.log('\n=== respuestas de las APIs ===')
{
  const apagada = clasificarRespuestaDeGoogle('gmail', 403, { error: { code: 403, message: 'Gmail API has not been used in project 123456 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/gmail.googleapis.com/overview?project=123456', status: 'PERMISSION_DENIED', errors: [{ reason: 'accessNotConfigured' }] } })
  ok('API apagada: tipo, API y la frase con el enlace para activarla', apagada.tipo === 'api_apagada' && apagada.api === 'gmail' && apagada.message.includes('Gmail') && apagada.message.includes('console.developers.google.com'), apagada.message)
  ok('y es un fallo general (no se sigue con las demás notas)', apagada.esGeneral)
  ok('la de Docs, con el nombre de Docs', clasificarRespuestaDeGoogle('docs', 403, { error: { message: 'Google Docs API has not been used in project 1 before or it is disabled.', errors: [{ reason: 'accessNotConfigured' }] } }).message.includes('Google Docs'))
  ok('con la razón SERVICE_DISABLED también', clasificarRespuestaDeGoogle('docs', 403, { error: { message: 'x', errors: [{ reason: 'SERVICE_DISABLED' }] } }).tipo === 'api_apagada')

  const sinAcceso = clasificarRespuestaDeGoogle('docs', 403, { error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED' } })
  ok('un 403 normal es «sin acceso» a ESE documento: no es general', sinAcceso.tipo === 'sin_acceso' && !sinAcceso.esGeneral)
  ok('un 404: ya no existe, no es general', clasificarRespuestaDeGoogle('docs', 404, { error: { message: 'Requested entity was not found.' } }).tipo === 'no_existe' && !clasificarRespuestaDeGoogle('docs', 404, null).esGeneral)
  ok('un 429: límite, se reintenta en la siguiente pasada', clasificarRespuestaDeGoogle('gmail', 429, {}).tipo === 'limite' && !clasificarRespuestaDeGoogle('gmail', 429, {}).esGeneral)
  ok('un 403 por cuota también es límite, no «sin acceso»', clasificarRespuestaDeGoogle('gmail', 403, { error: { errors: [{ reason: 'userRateLimitExceeded' }] } }).tipo === 'limite')
  const noAutorizado = clasificarRespuestaDeGoogle('gmail', 401, {})
  ok('un 401: permisos, con las instrucciones', noAutorizado.tipo === 'permisos' && noAutorizado.message === FRASE_DE_PERMISOS && noAutorizado.esGeneral)
  ok('un 500: problema de Google, es de red y no general', clasificarRespuestaDeGoogle('gmail', 503, null).tipo === 'red' && !clasificarRespuestaDeGoogle('gmail', 503, null).esGeneral)
  ok('lo raro: otro', clasificarRespuestaDeGoogle('gmail', 418, null).tipo === 'otro')
  ok('un cuerpo que no es un objeto no revienta', clasificarRespuestaDeGoogle('gmail', 403, 'texto').tipo === 'sin_acceso' && clasificarRespuestaDeGoogle('gmail', 403, undefined).tipo === 'sin_acceso')
  ok('es un Error de verdad (se puede lanzar y capturar)', apagada instanceof Error && apagada instanceof ErrorDeGoogle && apagada.name === 'ErrorDeGoogle')
  const larga = clasificarRespuestaDeGoogle('gmail', 403, { error: { message: `has not been used in project ${'x'.repeat(2000)}`, errors: [{ reason: 'accessNotConfigured' }] } })
  ok('un mensaje enorme se recorta', larga.message.length < 700)
}

console.log('\n=== el permiso de acceso (token) ===')
{
  const noAutorizado = clasificarFalloDeToken({ response: { status: 401, data: { error: 'unauthorized_client', error_description: 'Client is unauthorized to retrieve access tokens using this method, or client not authorized for any of the scopes requested.' } } })
  ok('unauthorized_client: faltan los permisos en Workspace, con las instrucciones', noAutorizado.tipo === 'permisos' && noAutorizado.message === FRASE_DE_PERMISOS && noAutorizado.esGeneral && noAutorizado.estado === 401)
  ok('invalid_scope, igual', clasificarFalloDeToken({ response: { data: { error: 'invalid_scope' } } }).tipo === 'permisos')
  const grant = clasificarFalloDeToken({ response: { status: 400, data: { error: 'invalid_grant', error_description: 'Invalid email or User ID' } } })
  ok('invalid_grant: dice que mire el usuario suplantado y la delegación', grant.tipo === 'permisos' && grant.message.includes('GOOGLE_IMPERSONATE_SUBJECT') && grant.message.includes('delegación'))
  ok('el mensaje de la librería también se mira (sin respuesta dentro)', clasificarFalloDeToken(new Error('unauthorized_client: ...')).tipo === 'permisos')
  ok('un corte de red, no es de permisos', clasificarFalloDeToken(new Error('getaddrinfo ENOTFOUND oauth2.googleapis.com')).tipo === 'red' && !clasificarFalloDeToken(new Error('ETIMEDOUT')).esGeneral)
  ok('lo desconocido: otro, con una frase genérica y sin el cuerpo', clasificarFalloDeToken({ message: 'algo con la clave privada' }).tipo === 'otro' && !clasificarFalloDeToken({ message: 'algo con la clave privada' }).message.includes('clave privada'))
  ok('null o un texto, sin reventar', clasificarFalloDeToken(null).tipo === 'otro' && clasificarFalloDeToken('x').tipo === 'otro')
}

console.log('\n=== fallos de red al pedir ===')
{
  ok('tardar demasiado', falloDeRed('docs', Object.assign(new Error('x'), { name: 'TimeoutError' })).message.includes('tardado demasiado'))
  ok('no conectar', falloDeRed('gmail', new Error('fetch failed')).message.includes('No se ha podido conectar con Gmail') && falloDeRed('gmail', new Error('x')).tipo === 'red')
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
