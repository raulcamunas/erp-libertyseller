import { MENSAJE_DE_ERROR, causaDelError, consultarCreditos, interpretarRespuesta, motivoDelVeredicto, verificarEnElServicio, type RespuestaDelServicio } from './millionverifier'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** Una respuesta del servicio con lo que no cambia puesto */
const base = { email: 'info@email.com', free: false, role: false, didyoumean: '', credits: 0, executiontime: 0, error: '', livemode: false }

// LAS RESPUESTAS REALES: las de las claves de demostración públicas del servicio (capturadas el 27 oct 2026) y la de una dirección mala de verdad
const REAL = {
  ok: { ...base, quality: 'good', result: 'ok', resultcode: 1, subresult: 'ok' },
  catchAll: { ...base, quality: 'risky', result: 'catch_all', resultcode: 2, subresult: 'ok' },
  desconocida: { ...base, quality: 'risky', result: 'unknown', resultcode: 3, subresult: 'unknown' },
  invalida: { ...base, quality: 'bad', result: 'invalid', resultcode: 6, subresult: 'no_mailbox' },
  desechable: { ...base, quality: 'bad', result: 'disposable', resultcode: 5, subresult: 'disposable' },
  sinVerificar: { ...base, result: 'unverified', resultcode: 0, subresult: 'unverified' },
  // La captura de Raúl con su cuenta (modo real, 10.500 créditos)
  malDominio: { email: 'bademail@gmal.com', quality: 'bad', result: 'invalid', resultcode: 6, subresult: 'bad_domain', free: false, role: false, didyoumean: 'bademail@gmail.com', credits: 10500, executiontime: 28, error: '', livemode: true },
  // Las de error: resultcode 4 y el texto en `error`, y sin `quality`
  sinClave: { ...base, result: '', resultcode: 4, subresult: '', error: 'No apikey specified' },
  claveMala: { ...base, result: '', resultcode: 4, subresult: '', error: 'Apikey not found' },
  sinCreditos: { ...base, result: '', resultcode: 4, subresult: '', error: 'Insufficient credits' },
  ipBloqueada: { ...base, result: '', resultcode: 4, subresult: '', error: 'IP address blocked' },
  sinCorreo: { ...base, result: '', resultcode: 4, subresult: '', error: 'No email specified' },
  interno: { ...base, result: '', resultcode: 4, subresult: '', error: 'Internal error' },
  // La clave aleatoria de pruebas mezcla campos que no casan entre sí (quality risky, result unknown, resultcode 5)
  aleatoria: { ...base, quality: 'risky', result: 'unknown', resultcode: 5, subresult: 'mailbox_disabled' },
  // El ejemplo de su documentación: quality good con result invalid
  ejemploDeLaDocumentacion: { email: 'x@y.es', quality: 'good', result: 'invalid', resultcode: 6, subresult: 'unknown', free: false, role: false, didyoumean: 'z@y.es', credits: 3454, executiontime: 2, error: '', livemode: true },
}

const veredicto = (r: RespuestaDelServicio) => (r.tipo === 'veredicto' ? r : null)

console.log('\n=== lo que dice el servicio de una dirección ===')
{
  const buena = interpretarRespuesta(REAL.ok)
  ok('«ok» / good / 1 es buena', veredicto(buena)?.nivel === 'buena' && veredicto(buena)?.resultado === 'ok')
  ok('«catch_all» / risky / 2 es dudosa (el servidor acepta todo)', veredicto(interpretarRespuesta(REAL.catchAll))?.nivel === 'dudosa')
  ok('«unknown» / risky / 3 es dudosa', veredicto(interpretarRespuesta(REAL.desconocida))?.nivel === 'dudosa')
  const mala = veredicto(interpretarRespuesta(REAL.invalida))
  ok('«invalid» / bad / 6 es mala, con su detalle', mala?.nivel === 'mala' && mala.resultado === 'invalid' && mala.detalle === 'no_mailbox' && mala.calidad === 'bad')
  ok('«disposable» / bad / 5 es mala', veredicto(interpretarRespuesta(REAL.desechable))?.nivel === 'mala')
  const real = veredicto(interpretarRespuesta(REAL.malDominio))
  ok('la respuesta real de la captura de Raúl: mala, bad_domain, con los créditos que quedan y la corrección propuesta', real?.nivel === 'mala' && real.detalle === 'bad_domain' && real.creditos === 10500 && real.sugerencia === 'bademail@gmail.com')
  ok('sin corrección, null (y si «didyoumean» es la misma dirección, tampoco)', veredicto(buena)?.sugerencia === null && veredicto(interpretarRespuesta({ ...REAL.ok, didyoumean: 'INFO@email.com' }))?.sugerencia === null)
  ok('una contradicción entre campos NO bloquea: la clave aleatoria de pruebas da dudosa', veredicto(interpretarRespuesta(REAL.aleatoria))?.nivel === 'dudosa')
  ok('ni el ejemplo de la documentación (good + invalid): dudosa', veredicto(interpretarRespuesta(REAL.ejemploDeLaDocumentacion))?.nivel === 'dudosa')
  ok('mala solo si TODO lo dice: invalid con resultcode 3 es dudosa', veredicto(interpretarRespuesta({ ...REAL.invalida, resultcode: 3 }))?.nivel === 'dudosa')
  ok('buena solo si TODO lo dice: ok con quality risky es dudosa', veredicto(interpretarRespuesta({ ...REAL.ok, quality: 'risky' }))?.nivel === 'dudosa')
  ok('sin `quality` ni `resultcode` (otra versión del servicio) se juzga por `result`', veredicto(interpretarRespuesta({ result: 'invalid' }))?.nivel === 'mala' && veredicto(interpretarRespuesta({ result: 'ok' }))?.nivel === 'buena')
  ok('un `result` que no conoce nadie es dudosa, nunca mala', veredicto(interpretarRespuesta({ ...REAL.ok, result: 'raro', quality: 'good', resultcode: 1 }))?.nivel === 'dudosa')
  ok('mayúsculas no engañan', veredicto(interpretarRespuesta({ ...REAL.invalida, result: 'INVALID', quality: 'BAD' }))?.nivel === 'mala')
  ok('«unverified» no es ni buena ni mala', interpretarRespuesta(REAL.sinVerificar).tipo === 'sin_veredicto')
}

console.log('\n=== los fallos del servicio ===')
{
  const causa = (r: RespuestaDelServicio) => (r.tipo === 'error' ? r.causa : null)
  ok('«Apikey not found» y «No apikey specified»: la clave', causa(interpretarRespuesta(REAL.claveMala)) === 'clave' && causa(interpretarRespuesta(REAL.sinClave)) === 'clave')
  ok('«Insufficient credits»: sin créditos', causa(interpretarRespuesta(REAL.sinCreditos)) === 'sin_creditos')
  ok('«IP address blocked»: la IP', causa(interpretarRespuesta(REAL.ipBloqueada)) === 'ip')
  ok('«Internal error»: fallo interno (pasajero)', causa(interpretarRespuesta(REAL.interno)) === 'interno')
  ok('«No email specified»: otro (es un fallo nuestro, no de la clave)', causa(interpretarRespuesta(REAL.sinCorreo)) === 'otro')
  ok('un resultcode 4 sin texto, también es un fallo', causa(interpretarRespuesta({ ...base, result: '', resultcode: 4 })) === 'otro')
  ok('un `result: error` sin código, también', causa(interpretarRespuesta({ result: 'error', error: '' })) === 'otro')
  ok('lo que no es un objeto no se entiende y es un fallo, no una excepción', causa(interpretarRespuesta('hola')) === 'otro' && causa(interpretarRespuesta(null)) === 'otro' && causa(interpretarRespuesta([])) === 'otro')
  ok('un objeto vacío tampoco se toma por una dirección buena', causa(interpretarRespuesta({})) === 'otro')
  const e = interpretarRespuesta(REAL.sinCreditos)
  ok('la frase para la persona nunca lleva el texto crudo del servicio', e.tipo === 'error' && e.mensaje === MENSAJE_DE_ERROR.sin_creditos && !/Insufficient/.test(e.mensaje))
  ok('causaDelError también entiende el texto de la consulta de créditos', causaDelError('apikey_not_found') === 'clave')
}

console.log('\n=== la frase de cada veredicto ===')
{
  ok('buena', /existe y recibe/.test(motivoDelVeredicto({ nivel: 'buena', resultado: 'ok', detalle: 'ok' })))
  ok('mala por dominio', /dominio no existe/.test(motivoDelVeredicto({ nivel: 'mala', resultado: 'invalid', detalle: 'bad_domain' })))
  ok('mala por buzón', /buzón no existe/.test(motivoDelVeredicto({ nivel: 'mala', resultado: 'invalid', detalle: 'no_mailbox' })))
  ok('desechable', /desechable/.test(motivoDelVeredicto({ nivel: 'mala', resultado: 'disposable', detalle: 'disposable' })))
  ok('mala sin detalle conocido', /no existe/.test(motivoDelVeredicto({ nivel: 'mala', resultado: 'invalid', detalle: 'algo_nuevo' })))
  ok('dudosa por catch_all y por unknown', /acepta cualquier dirección/.test(motivoDelVeredicto({ nivel: 'dudosa', resultado: 'catch_all', detalle: 'ok' })) && /no ha dejado comprobar/.test(motivoDelVeredicto({ nivel: 'dudosa', resultado: 'unknown', detalle: 'unknown' })))
}

console.log('\n=== la llamada ===')
async function main() {
  const llamadas: Array<{ url: string; init: RequestInit | undefined }> = []
  const servicio = (cuerpo: unknown, estado = 200): typeof fetch =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      llamadas.push({ url: String(url), init })
      return new Response(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch

  {
    llamadas.length = 0
    const r = await verificarEnElServicio('CLAVE_SECRETA_123', 'Ana+ventas@Tienda.es', { fetch: servicio(REAL.ok), esperaDelServicioS: 7 })
    const u = new URL(llamadas[0].url)
    ok('pide a la dirección del servicio, con la clave, la dirección bien codificada y la espera', u.origin + u.pathname === 'https://api.millionverifier.com/api/v3/' && u.searchParams.get('api') === 'CLAVE_SECRETA_123' && u.searchParams.get('email') === 'Ana+ventas@Tienda.es' && u.searchParams.get('timeout') === '7')
    ok('es un GET sin caché', llamadas[0].init?.method === 'GET' && llamadas[0].init?.cache === 'no-store')
    ok('devuelve lo interpretado', r.tipo === 'veredicto' && r.nivel === 'buena')
    llamadas.length = 0
    await verificarEnElServicio('k', 'a@b.es', { fetch: servicio(REAL.ok), esperaDelServicioS: 500 })
    ok('la espera del servicio nunca pasa de 60 s ni baja de 2', new URL(llamadas[0].url).searchParams.get('timeout') === '60')
    llamadas.length = 0
    await verificarEnElServicio('k', 'a@b.es', { fetch: servicio(REAL.ok), esperaDelServicioS: 0 })
    ok('…ni baja de 2', new URL(llamadas[0].url).searchParams.get('timeout') === '2')
    llamadas.length = 0
    await verificarEnElServicio('k', 'a@b.es', { fetch: servicio(REAL.ok) })
    ok('por defecto espera 10 s', new URL(llamadas[0].url).searchParams.get('timeout') === '10')
  }
  {
    const r = await verificarEnElServicio('k', 'a@b.es', { fetch: servicio(REAL.sinCreditos) })
    ok('un fallo del servicio llega como fallo, con su causa', r.tipo === 'error' && r.causa === 'sin_creditos')
    const http = await verificarEnElServicio('CLAVE_SECRETA_123', 'a@b.es', { fetch: servicio('<html>', 502) })
    ok('un 502 es un fallo de red, y su frase no lleva la clave', http.tipo === 'red' && /502/.test(http.mensaje) && !/CLAVE_SECRETA/.test(http.mensaje))
    const noJson = await verificarEnElServicio('k', 'a@b.es', { fetch: servicio('esto no es json') })
    ok('algo que no es JSON es un fallo de red', noJson.tipo === 'red' && /no se entiende/.test(noJson.mensaje))
    const lanza = await verificarEnElServicio('CLAVE_SECRETA_123', 'a@b.es', { fetch: (async () => { throw new Error('connect ECONNREFUSED https://api.millionverifier.com/api/v3/?api=CLAVE_SECRETA_123') }) as typeof fetch })
    ok('si el fetch lanza, la frase NO arrastra la dirección de la consulta (lleva la clave)', lanza.tipo === 'red' && !/CLAVE_SECRETA|ECONNREFUSED|api=/.test(lanza.mensaje), JSON.stringify(lanza))
    const lenta = await verificarEnElServicio('k', 'a@b.es', {
      esperaMaximaMs: 40,
      fetch: ((_url: string, init?: RequestInit) => new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' }))))) as unknown as typeof fetch,
    })
    ok('si el servicio no contesta a tiempo, se rinde con su frase (y no se queda colgado)', lenta.tipo === 'red' && /tardado demasiado/.test(lenta.mensaje))
  }

  console.log('\n=== los créditos ===')
  {
    llamadas.length = 0
    const c = await consultarCreditos('CLAVE_SECRETA_123', { fetch: servicio({ credits: 10500, bulk_credits: 10500, renewing_credits: 0, plan: 4 }) })
    const u = new URL(llamadas[0].url)
    ok('pide a /credits con la clave', u.pathname === '/api/v3/credits' && u.searchParams.get('api') === 'CLAVE_SECRETA_123')
    ok('devuelve los créditos y el plan', c.tipo === 'creditos' && c.creditos === 10500 && c.plan === 4)
    const sin = await consultarCreditos('k', { fetch: servicio({ credits: 0 }) })
    ok('cero créditos es un número, no un fallo', sin.tipo === 'creditos' && sin.creditos === 0)
    const mala = await consultarCreditos('k', { fetch: servicio({ result: 'error', error: 'apikey_not_found' }) })
    ok('una clave que no existe: fallo de clave', mala.tipo === 'error' && mala.causa === 'clave' && mala.mensaje === MENSAJE_DE_ERROR.clave)
    const raro = await consultarCreditos('k', { fetch: servicio({ nada: 1 }) })
    ok('una respuesta sin créditos no se toma por cero', raro.tipo === 'error')
    const red = await consultarCreditos('k', { fetch: servicio('x', 500) })
    ok('un 500 es un fallo de red', red.tipo === 'red')
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
