import { ErrorDeGasto, MENSAJE_DE_GASTO, claveDeAdministrador, leerCostes, leerProyectos } from '@/lib/ia-gasto/openai'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const seg = (dia: string) => Date.parse(`${dia}T00:00:00Z`) / 1000
const json = (cuerpo: unknown, estado = 200) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json' } })
const cubo = (dia: string, valor: number, concepto = 'gpt-4o-2024-08-06, input') => ({ object: 'bucket', start_time: seg(dia), end_time: seg(dia) + 86_400, results: [{ object: 'organization.costs.result', amount: { value: valor, currency: 'usd' }, line_item: concepto, project_id: 'proj_a' }] })

interface Peticion {
  url: URL
  init: RequestInit
}
function falso(responder: (n: number, p: Peticion) => Response | Promise<Response>): { fetch: typeof fetch; peticiones: Peticion[] } {
  const peticiones: Peticion[] = []
  return {
    peticiones,
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      const p = { url: new URL(String(url)), init: init ?? {} }
      peticiones.push(p)
      return responder(peticiones.length, p)
    }) as typeof fetch,
  }
}

const run = async () => {
  console.log('\n=== la clave ===')
  {
    ok('OPENAI_ADMIN_KEY', claveDeAdministrador({ OPENAI_ADMIN_KEY: '  sk-admin-abc ' }) === 'sk-admin-abc')
    ok('el otro nombre también vale', claveDeAdministrador({ OPENAI_ADMIN_API_KEY: 'sk-admin-def' }) === 'sk-admin-def')
    ok('la clave normal de la IA NO vale (no puede leer el gasto)', claveDeAdministrador({ OPENAI_API_KEY: 'sk-proj-xyz' }) === null)
    ok('vacía o sin poner: null', claveDeAdministrador({ OPENAI_ADMIN_KEY: '   ' }) === null && claveDeAdministrador({}) === null)
  }

  console.log('\n=== la petición de costes ===')
  {
    const f = falso(() => json({ object: 'page', data: [cubo('2026-10-22', 0.5), cubo('2026-10-23', 0.25)], has_more: false, next_page: null }))
    const filas = await leerCostes('sk-admin-secreta', seg('2026-01-01'), { fetch: f.fetch })
    const p = f.peticiones[0]
    ok('va a /v1/organization/costs con GET y la clave en la cabecera', p.url.origin === 'https://api.openai.com' && p.url.pathname === '/v1/organization/costs' && p.init.method === 'GET' && (p.init.headers as Record<string, string>).Authorization === 'Bearer sk-admin-secreta')
    ok('pide días, 180 cubos y desde la fecha dada (en segundos)', p.url.searchParams.get('bucket_width') === '1d' && p.url.searchParams.get('limit') === '180' && p.url.searchParams.get('start_time') === String(seg('2026-01-01')))
    ok('desglosa por proyecto y por concepto con la forma de lista del SDK de OpenAI (group_by[])', JSON.stringify(p.url.searchParams.getAll('group_by[]')) === JSON.stringify(['project_id', 'line_item']))
    ok('la clave NO va en la dirección', !p.url.toString().includes('sk-admin'))
    ok('devuelve las filas de los dos días', filas.length === 2 && filas[0].dia === '2026-10-22' && filas[1].dolares === 0.25)
  }
  {
    // Varias páginas: la siguiente se pide con `page`
    const f = falso((n) => (n === 1 ? json({ data: [cubo('2026-10-21', 1)], has_more: true, next_page: 'pag_2' }) : n === 2 ? json({ data: [cubo('2026-10-22', 2)], has_more: true, next_page: 'pag_3' }) : json({ data: [cubo('2026-10-23', 3)], has_more: false, next_page: null })))
    const filas = await leerCostes('k', seg('2026-01-01'), { fetch: f.fetch })
    ok('sigue por las páginas hasta que no hay más', f.peticiones.length === 3 && filas.length === 3 && filas.map((x) => x.dolares).join() === '1,2,3')
    ok('la primera sin `page` y las demás con el cursor que dio OpenAI', f.peticiones[0].url.searchParams.get('page') === null && f.peticiones[1].url.searchParams.get('page') === 'pag_2' && f.peticiones[2].url.searchParams.get('page') === 'pag_3')
  }
  {
    // Una página que dice «hay más» sin dar la siguiente no se queda dando vueltas
    const f = falso(() => json({ data: [cubo('2026-10-21', 1)], has_more: true, next_page: null }))
    const filas = await leerCostes('k', seg('2026-01-01'), { fetch: f.fetch })
    ok('«hay más» sin cursor: se para (una sola petición)', f.peticiones.length === 1 && filas.length === 1)
  }
  {
    // Un servidor que siempre dice «hay más»: tope de páginas
    const f = falso((n) => json({ data: [cubo('2026-10-21', 1)], has_more: true, next_page: `pag_${n + 1}` }))
    const filas = await leerCostes('k', seg('2026-01-01'), { fetch: f.fetch })
    ok('con un servidor que nunca acaba se corta en 5 páginas', f.peticiones.length === 5 && filas.length === 5)
  }

  console.log('\n=== los fallos ===')
  const falla = async (n: string, responder: () => Response | Promise<Response>, codigo: string, extra?: (e: ErrorDeGasto) => boolean) => {
    const f = falso(responder)
    try {
      await leerCostes('sk-admin-secreta', seg('2026-01-01'), { fetch: f.fetch })
      ok(n, false, 'no ha fallado')
    } catch (e) {
      const bien = e instanceof ErrorDeGasto && e.codigo === codigo && e.message === MENSAJE_DE_GASTO[e.codigo] && (extra ? extra(e) : true)
      ok(n, bien, e instanceof ErrorDeGasto ? `${e.codigo}: ${e.message}` : String(e))
    }
  }
  await falla('401: la clave no vale (y no se enseña el cuerpo, que repite parte de la clave)', () => json({ error: { message: 'Incorrect API key provided: sk-admin-abc***xyz1.' } }, 401), 'clave_invalida', (e) => e.detalle === null && !e.message.includes('abc***'))
  await falla(
    '403: falta el permiso, y se enseña SOLO la frase del permiso',
    () => json({ error: { message: 'You have insufficient permissions for this operation. Missing scopes: api.usage.read. Check that you have the correct role in your organization.' } }, 403),
    'sin_permiso',
    (e) => e.detalle === 'Falta el permiso api.usage.read'
  )
  await falla('403 con varios permisos: los nombra todos', () => json({ error: { message: 'Missing scopes: api.usage.read, api.billing.read. Contact your admin.' } }, 403), 'sin_permiso', (e) => e.detalle === 'Falta el permiso api.usage.read, api.billing.read')
  await falla('403 sin esa frase: sin detalle', () => json({ error: { message: 'Forbidden' } }, 403), 'sin_permiso', (e) => e.detalle === null)
  await falla('403 con el cuerpo roto: sin detalle y sin reventar', () => new Response('<html>', { status: 403 }), 'sin_permiso', (e) => e.detalle === null)
  await falla('404: no es una clave de administrador', () => new Response('', { status: 404 }), 'no_encontrada')
  await falla('429: demasiadas peticiones', () => json({}, 429), 'limite')
  await falla('500', () => json({}, 500), 'servidor')
  await falla('503', () => json({}, 503), 'servidor')
  await falla('200 que no es JSON', () => new Response('hola', { status: 200 }), 'respuesta')
  await falla('200 sin la forma de una página de costes', () => json({ object: 'error' }), 'respuesta')
  await falla('un fallo de red', () => {
    throw new Error('ECONNRESET sk-admin-secreta')
  }, 'red', (e) => !e.message.includes('sk-admin'))
  {
    // Un fallo en la segunda página no se disimula: mejor un error que una cifra incompleta que parezca entera
    const f = falso((n) => (n === 1 ? json({ data: [cubo('2026-10-21', 1)], has_more: true, next_page: 'p2' }) : json({}, 500)))
    try {
      await leerCostes('k', seg('2026-01-01'), { fetch: f.fetch })
      ok('un fallo en la segunda página', false, 'no ha fallado')
    } catch (e) {
      ok('un fallo en la segunda página hace fallar todo (no se enseña una cifra a medias)', e instanceof ErrorDeGasto && e.codigo === 'servidor')
    }
  }

  console.log('\n=== los nombres de los proyectos ===')
  {
    const f = falso(() => json({ data: [{ id: 'proj_a', name: ' ERP ' }, { id: 'proj_b', name: 'Traductor' }, { id: 'proj_c' }, null], has_more: false }))
    const m = await leerProyectos('k', { fetch: f.fetch })
    ok('lee id y nombre y salta lo que no tiene nombre', m.size === 2 && m.get('proj_a') === 'ERP' && m.get('proj_b') === 'Traductor')
    ok('pide /v1/organization/projects', f.peticiones[0].url.pathname === '/v1/organization/projects')
    const mal = await leerProyectos('k', { fetch: falso(() => json({}, 403)).fetch })
    ok('si no se puede leer, un mapa vacío (solo servía para enseñar el nombre)', mal.size === 0)
    const raro = await leerProyectos('k', { fetch: falso(() => json({ data: 'x' })).fetch })
    ok('con una respuesta rara, también vacío', raro.size === 0)
  }
}

run().then(
  () => {
    console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
    if (fallos > 0) process.exit(1)
  },
  (e) => {
    console.error('Explotó la prueba:', e)
    process.exit(1)
  }
)
