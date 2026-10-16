import { ROLES_PERMITIDOS, autenticar, extraerBearer, leerClaims, type DepsAuth } from '@/lib/mcp/auth'
import { destinoTrasLogin, identificadorValido, redireccionPermitida } from '@/lib/mcp/consentimiento'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** Un JWT con la forma de verdad (la firma da igual: la comprueba Supabase, no esto) */
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (claims: Record<string, unknown>) => `${b64({ alg: 'ES256', typ: 'JWT' })}.${b64(claims)}.firma`
const RAUL = '11111111-1111-4111-8111-111111111111'
const tokenOk = jwt({ sub: RAUL, client_id: 'abc-claude', aud: 'authenticated', exp: 9999999999 })

const deps = (extra: Partial<DepsAuth> & { rol?: string | null } = {}): DepsAuth & { llamadas: string[] } => {
  const llamadas: string[] = []
  return {
    llamadas,
    verificarToken: extra.verificarToken ?? (async () => { llamadas.push('token'); return { id: RAUL, email: 'raul@liberty.test' } }),
    leerRol: extra.leerRol ?? (async () => { llamadas.push('rol'); return extra.rol === undefined ? 'admin' : extra.rol }),
  }
}

async function principal() {
  console.log('\n=== el token Bearer ===')
  ok('extrae el token', extraerBearer('Bearer abc.def.ghi') === 'abc.def.ghi')
  ok('no distingue mayúsculas en «Bearer»', extraerBearer('bearer abc') === 'abc')
  ok('sin cabecera', extraerBearer(null) === null)
  ok('otro esquema (Basic) no vale', extraerBearer('Basic dXNlcjpwYXNz') === null)
  ok('«Bearer» sin token', extraerBearer('Bearer ') === null)
  ok('con espacios de más dentro: no vale', extraerBearer('Bearer a b') === null)

  console.log('\n=== las afirmaciones del JWT ===')
  ok('lee las afirmaciones', leerClaims(tokenOk)?.client_id === 'abc-claude')
  ok('un texto cualquiera no es un JWT', leerClaims('hola') === null)
  ok('un JWT con la carga rota', leerClaims('a.%%%.c') === null)
  ok('una carga que no es un objeto', leerClaims(`a.${Buffer.from('[1,2]').toString('base64url')}.c`) === null)

  console.log('\n=== quién entra ===')
  {
    const d = deps()
    const r = await autenticar(`Bearer ${tokenOk}`, d)
    ok('un administrador con un token de OAuth entra', r.ok === true)
    ok('con su identidad y el cliente OAuth', r.ok && r.usuario.id === RAUL && r.usuario.rol === 'admin' && r.usuario.clienteOAuth === 'abc-claude')
    ok('se ha preguntado a Supabase y a la base', d.llamadas.join() === 'token,rol')
  }
  {
    const r = await autenticar(null, deps())
    ok('sin token: 401 con el aviso que abre el inicio de sesión', !r.ok && r.status === 401 && r.reto === true && r.tokenInvalido === false)
  }
  {
    const d = deps()
    const r = await autenticar('Bearer basura', d)
    ok('un token que no es un JWT: 401 «token inválido»', !r.ok && r.status === 401 && r.tokenInvalido === true)
    ok('ni siquiera se pregunta a Supabase', d.llamadas.length === 0)
  }
  {
    const r = await autenticar(`Bearer ${tokenOk}`, deps({ verificarToken: async () => null }))
    ok('Supabase dice que no vale: 401 «token inválido»', !r.ok && r.status === 401 && r.tokenInvalido === true && r.reto === true)
  }
  {
    const r = await autenticar(`Bearer ${tokenOk}`, deps({ verificarToken: async () => { throw new Error('red caída') } }))
    ok('Supabase no contesta: 503, NO 401 (no se tira una conexión buena)', !r.ok && r.status === 503 && r.reto === false)
  }
  {
    const r = await autenticar(`Bearer ${jwt({ sub: 'otra-persona', client_id: 'x' })}`, deps())
    ok('el `sub` del token no coincide con quien dice Supabase: 401', !r.ok && r.status === 401)
  }
  {
    const d = deps()
    const r = await autenticar(`Bearer ${jwt({ sub: RAUL, aud: 'authenticated' })}`, d)
    ok('un token sin client_id (sesión normal del navegador): 403', !r.ok && r.status === 403 && r.reto === false)
    ok('y no se llega a mirar el rol', !d.llamadas.includes('rol'))
  }
  for (const rol of ['cliente', 'employee', 'partner']) {
    const r = await autenticar(`Bearer ${tokenOk}`, deps({ rol }))
    ok(`el rol «${rol}» NO entra: 403`, !r.ok && r.status === 403 && r.reto === false)
  }
  {
    const r = await autenticar(`Bearer ${tokenOk}`, deps({ rol: null }))
    ok('sin perfil: 403', !r.ok && r.status === 403)
  }
  {
    const r = await autenticar(`Bearer ${tokenOk}`, deps({ leerRol: async () => { throw new Error('base caída') } }))
    ok('no se puede leer el rol: 503 (nunca se deja pasar por defecto)', !r.ok && r.status === 503)
  }
  ok('el único rol permitido es admin', ROLES_PERMITIDOS.length === 1 && ROLES_PERMITIDOS[0] === 'admin')
  ok('el motivo nunca lleva el token', await (async () => {
    const r = await autenticar(`Bearer ${tokenOk}`, deps({ rol: 'cliente' }))
    return !r.ok && !r.motivo.includes(tokenOk)
  })())

  console.log('\n=== a dónde puede volver Claude ===')
  const v = (u: string, c = false) => redireccionPermitida(u, { conConsulta: c })
  ok('claude.ai, la dirección de siempre', v('https://claude.ai/api/mcp/auth_callback').permitida)
  ok('claude.com, el mismo camino', v('https://claude.com/api/mcp/auth_callback').permitida)
  ok('Claude Code: localhost con puerto', v('http://localhost:3118/callback').permitida)
  ok('Claude Code: 127.0.0.1 con otro puerto', v('http://127.0.0.1:54321/callback').permitida)
  ok('Claude Code: sin puerto', v('http://localhost/callback').permitida)
  ok('una web cualquiera NO', !v('https://evil.com/api/mcp/auth_callback').permitida)
  ok('un subdominio que lo imita NO', !v('https://claude.ai.evil.com/api/mcp/auth_callback').permitida)
  ok('otro camino en claude.ai NO', !v('https://claude.ai/otra/cosa').permitida)
  ok('claude.ai por http NO', !v('http://claude.ai/api/mcp/auth_callback').permitida)
  ok('localhost con otro camino NO', !v('http://localhost:3000/robar').permitida)
  ok('localhost por https NO (Claude Code usa http)', !v('https://localhost:3000/callback').permitida)
  ok('un puerto privilegiado NO', !v('http://localhost:443/callback').permitida)
  ok('el puerto 80 explícito es lo mismo que sin puerto (la URL lo normaliza) y también es de este ordenador', v('http://localhost:80/callback').permitida)
  ok('con usuario y contraseña NO', !v('https://user:pass@claude.ai/api/mcp/auth_callback').permitida)
  ok('con fragmento NO', !v('https://claude.ai/api/mcp/auth_callback#x').permitida)
  ok('la registrada con consulta NO', !v('https://claude.ai/api/mcp/auth_callback?a=1').permitida)
  ok('la final con código y estado SÍ', v('https://claude.ai/api/mcp/auth_callback?code=abc&state=xyz', true).permitida)
  ok('la final de Claude Code SÍ', v('http://localhost:3118/callback?code=abc&state=xyz', true).permitida)
  ok('la final hacia una web ajena NO', !v('https://evil.com/cb?code=abc', true).permitida)
  ok('vacía NO', !v('').permitida && !redireccionPermitida(null).permitida)
  ok('una cadena que no es una dirección NO', !v('esto no es una url').permitida)
  ok('esquema javascript NO', !v('javascript:alert(1)').permitida)
  ok('al permitir dice a dónde se vuelve', (() => { const r = v('https://claude.ai/api/mcp/auth_callback'); return r.permitida && r.destino === 'claude.ai' })())

  console.log('\n=== la vuelta tras iniciar sesión ===')
  const ID = 'a1b2c3d4-e5f6-4789-8abc-def012345678'
  ok('vuelve a la pantalla de consentimiento', destinoTrasLogin(`/auth/consent?authorization_id=${ID}`) === `/auth/consent?authorization_id=${ID}`)
  ok('sin nada: escritorio', destinoTrasLogin(null) === '/dashboard' && destinoTrasLogin(undefined) === '/dashboard' && destinoTrasLogin('') === '/dashboard')
  ok('una web externa NO', destinoTrasLogin('https://evil.com') === '/dashboard')
  ok('//evil.com NO', destinoTrasLogin('//evil.com') === '/dashboard')
  ok('otra ruta del ERP NO', destinoTrasLogin('/dashboard/tesoreria') === '/dashboard')
  ok('la consentimiento con algo más pegado NO', destinoTrasLogin(`/auth/consent?authorization_id=${ID}&x=https://evil.com`) === '/dashboard')
  ok('la consentimiento con un identificador raro NO', destinoTrasLogin('/auth/consent?authorization_id=../../etc') === '/dashboard')
  ok('barras invertidas NO', destinoTrasLogin('/\\evil.com') === '/dashboard')
  ok('el identificador de autorización válido', identificadorValido(ID) === ID && identificadorValido([ID, 'x']) === ID)
  ok('el identificador roto', identificadorValido('x') === null && identificadorValido(undefined) === null && identificadorValido('a b c d e f g h') === null)

  console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

principal().catch((e) => {
  console.error(e)
  process.exit(1)
})
