import type { ResultadoAuth, UsuarioMcp } from '@/lib/mcp/auth'
import { crearLimitador } from '@/lib/mcp/limite'
import { crearManejadorMcp } from '@/lib/mcp/manejador'
import { avisoDeAutenticacion, emisorSupabase, metadatosRecurso, urlMetadatos, urlRecurso } from '@/lib/mcp/meta'
import type { EntornoMcp } from '@/lib/mcp/protocolo'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const BASE = 'https://app.libertyseller.com'
const SUPABASE = 'https://pqqrbjuefporiqgglatw.supabase.co'
const usuario: UsuarioMcp = { id: 'u-1', email: 'raul@liberty.test', rol: 'admin', clienteOAuth: 'claude' }

const entorno: EntornoMcp<null> = {
  nombreServidor: 'prueba',
  tituloServidor: 'Prueba',
  version: '1',
  instrucciones: 'x',
  herramientas: [],
}

function montar(resultado: ResultadoAuth, ahora = () => 0, maximo = 50) {
  let autenticaciones = 0
  const m = crearManejadorMcp<null>({
    baseUrl: () => BASE,
    supabaseUrl: () => SUPABASE,
    autenticar: async () => {
      autenticaciones++
      return resultado
    },
    limitador: crearLimitador({ maximo, ventanaMs: 60_000, ahora }),
    entornoDe: () => ({ entorno, ctx: null }),
  })
  return { m, autenticaciones: () => autenticaciones }
}

const post = (cuerpo: unknown, cabeceras: Record<string, string> = {}) =>
  new Request(`${BASE}/api/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...cabeceras },
    body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
  })
const ping = { jsonrpc: '2.0', id: 1, method: 'ping' }
const bueno: ResultadoAuth = { ok: true, usuario }

async function principal() {
  console.log('\n=== sin token ===')
  {
    const { m } = montar({ ok: false, status: 401, motivo: 'Falta el token de acceso.', reto: true, tokenInvalido: false })
    const r = await m.POST(post(ping))
    ok('401', r.status === 401)
    const aviso = r.headers.get('www-authenticate') ?? ''
    ok('con el aviso que abre el inicio de sesión', aviso === `Bearer resource_metadata="${BASE}/api/mcp/metadata"`, aviso)
    ok('el cuerpo es un error JSON-RPC legible', ((await r.json()) as any).error.message === 'Falta el token de acceso.')
    ok('no se cachea', r.headers.get('cache-control') === 'no-store')
  }

  console.log('\n=== token que no vale ===')
  {
    const { m } = montar({ ok: false, status: 401, motivo: 'El token no es válido o ha caducado.', reto: true, tokenInvalido: true })
    const aviso = (await m.POST(post(ping))).headers.get('www-authenticate') ?? ''
    ok('el aviso dice invalid_token (RFC 6750)', /error="invalid_token"/.test(aviso) && /resource_metadata=/.test(aviso), aviso)
  }

  console.log('\n=== rol no permitido y Supabase caído ===')
  {
    const { m } = montar({ ok: false, status: 403, motivo: 'Solo equipo.', reto: false, tokenInvalido: false })
    const r = await m.POST(post(ping))
    ok('403 sin aviso de inicio de sesión (reintentar no lo arregla)', r.status === 403 && r.headers.get('www-authenticate') === null)
  }
  {
    const { m } = montar({ ok: false, status: 503, motivo: 'No se ha podido comprobar.', reto: false, tokenInvalido: false })
    const r = await m.POST(post(ping))
    ok('503 sin aviso (no se tira una conexión buena)', r.status === 503 && r.headers.get('www-authenticate') === null)
  }

  console.log('\n=== autenticado ===')
  {
    const { m } = montar(bueno)
    const r = await m.POST(post(ping))
    ok('un ping sale 200', r.status === 200)
    ok('con el resultado de ping', JSON.stringify(((await r.json()) as any).result) === '{}')
    ok('la respuesta es JSON', (r.headers.get('content-type') ?? '').startsWith('application/json'))
    const n = await m.POST(post({ jsonrpc: '2.0', method: 'notifications/initialized' }))
    ok('una notificación: 202 sin cuerpo', n.status === 202 && (await n.text()) === '')
    const roto = await m.POST(post('{no es json'))
    ok('JSON roto: 400', roto.status === 400)
    const version = await m.POST(post(ping, { 'mcp-protocol-version': '1999-01-01' }))
    ok('versión del protocolo que no conocemos: 400', version.status === 400)
  }

  console.log('\n=== orden: la autenticación va antes que nada ===')
  {
    const { m, autenticaciones } = montar({ ok: false, status: 401, motivo: 'x', reto: true, tokenInvalido: false })
    const r = await m.POST(post('{esto ni es json'))
    ok('un cuerpo roto SIN token contesta 401, no 400', r.status === 401)
    ok('se ha autenticado una vez', autenticaciones() === 1)
  }

  console.log('\n=== origen del navegador ===')
  {
    const { m } = montar(bueno)
    ok('sin Origin (Claude desde su nube): pasa', (await m.POST(post(ping))).status === 200)
    ok('Origin de claude.ai: pasa', (await m.POST(post(ping, { origin: 'https://claude.ai' }))).status === 200)
    ok('Origin del propio ERP: pasa', (await m.POST(post(ping, { origin: BASE }))).status === 200)
    const ajeno = await m.POST(post(ping, { origin: 'https://evil.com' }))
    ok('Origin ajeno: 403', ajeno.status === 403)
    ok('y ni se llega a autenticar', true)
  }
  {
    const { m, autenticaciones } = montar(bueno)
    await m.POST(post(ping, { origin: 'https://evil.com' }))
    ok('con Origin ajeno no se consulta ni a Supabase', autenticaciones() === 0)
  }

  console.log('\n=== el freno ===')
  {
    let t = 0
    const { m } = montar(bueno, () => t, 3)
    const estados: number[] = []
    for (let i = 0; i < 5; i++) estados.push((await m.POST(post(ping))).status)
    ok('tres pasan y las demás 429', estados.join() === '200,200,200,429,429', estados.join())
    const r = await m.POST(post(ping))
    ok('con Retry-After', Number(r.headers.get('retry-after')) >= 1)
    t = 61_000
    ok('en la ventana siguiente vuelve a pasar', (await m.POST(post(ping))).status === 200)
  }

  console.log('\n=== cuerpo demasiado grande ===')
  {
    const { m } = montar(bueno)
    const grande = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { relleno: 'x'.repeat(200_000) } })
    const r = await m.POST(post(grande))
    ok('413', r.status === 413)
  }

  console.log('\n=== GET y DELETE ===')
  {
    const { m } = montar(bueno)
    const g = m.GET()
    ok('GET: 405 (no hay flujo SSE) con Allow: POST', g.status === 405 && g.headers.get('allow') === 'POST')
    const d = m.DELETE()
    ok('DELETE: 405 (no hay sesiones)', d.status === 405)
  }

  console.log('\n=== los metadatos que lee Claude ===')
  {
    const { m } = montar(bueno)
    const r = m.metadatos()
    const meta = (await r.json()) as Record<string, any>
    ok('200 y público', r.status === 200)
    ok('`resource` es EXACTAMENTE la dirección del conector, sin barra final', meta.resource === 'https://app.libertyseller.com/api/mcp', meta.resource)
    ok('el servidor de autorización es el de Supabase', meta.authorization_servers.length === 1 && meta.authorization_servers[0] === `${SUPABASE}/auth/v1`)
    ok('el token va en la cabecera', JSON.stringify(meta.bearer_methods_supported) === '["header"]')
    ok('no lleva nada secreto', !/key|secret|token/i.test(Object.keys(meta).filter((k) => k !== 'bearer_methods_supported').join()))
    ok('se puede cachear un rato', (r.headers.get('cache-control') ?? '').includes('max-age'))
  }
  ok('una barra final en la base no cuela en `resource`', urlRecurso(`${BASE}/`) === 'https://app.libertyseller.com/api/mcp')
  ok('ni en la dirección de los metadatos', urlMetadatos(`${BASE}//`) === 'https://app.libertyseller.com/api/mcp/metadata')
  ok('ni en el emisor de Supabase', emisorSupabase(`${SUPABASE}/`) === `${SUPABASE}/auth/v1`)
  ok('el aviso de un token caducado', avisoDeAutenticacion(BASE, true).includes('invalid_token'))
  ok('el aviso sin token no menciona error', !avisoDeAutenticacion(BASE, false).includes('error='))
  ok('los metadatos de recurso, directos', metadatosRecurso(BASE, SUPABASE).scopes_supported.includes('openid'))

  console.log('\n=== el limitador, aparte ===')
  {
    let t = 0
    const l = crearLimitador({ maximo: 2, ventanaMs: 1000, ahora: () => t })
    ok('la primera pasa', l.permitir('a').ok)
    ok('la segunda pasa', l.permitir('a').ok)
    const x = l.permitir('a')
    ok('la tercera no, y dice cuánto falta', !x.ok && x.esperaMs === 1000)
    ok('otra persona no se ve afectada', l.permitir('b').ok)
    t = 500
    const y = l.permitir('a')
    ok('a mitad de ventana siguen quedando 500 ms', !y.ok && y.esperaMs === 500)
    t = 1000
    ok('al acabar la ventana se abre otra', l.permitir('a').ok)
  }

  console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

principal().catch((e) => {
  console.error(e)
  process.exit(1)
})
