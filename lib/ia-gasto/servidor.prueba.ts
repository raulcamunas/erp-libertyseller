import { ESPERA_ENTRE_ACTUALIZACIONES_MS, VIDA_DE_LA_CACHE_MS, gastoDeIa, vaciarLaCache } from '@/lib/ia-gasto/servidor'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const seg = (dia: string) => Date.parse(`${dia}T00:00:00Z`) / 1000
const json = (cuerpo: unknown, estado = 200) => new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json' } })
const cubo = (dia: string, valor: number) => ({ start_time: seg(dia), results: [{ amount: { value: valor, currency: 'usd' }, line_item: 'gpt-4o-2024-08-06, input', project_id: 'proj_a' }] })

const AHORA = Date.parse('2026-10-23T15:00:00Z')
const ENTORNO = { OPENAI_ADMIN_KEY: 'sk-admin-secreta' }

function mundo(responderCostes: (n: number) => Response) {
  const llamadas = { costes: 0, proyectos: 0 }
  const f = (async (url: string | URL | Request) => {
    const u = new URL(String(url))
    if (u.pathname.endsWith('/projects')) {
      llamadas.proyectos++
      return json({ data: [{ id: 'proj_a', name: 'ERP' }] })
    }
    llamadas.costes++
    return responderCostes(llamadas.costes)
  }) as typeof fetch
  return { llamadas, deps: { fetch: f } }
}

const run = async () => {
  console.log('\n=== sin la clave ===')
  {
    vaciarLaCache()
    const r = await gastoDeIa({ entorno: {}, ahora: () => AHORA })
    ok('dice qué falta y cómo se llama la variable', r.estado === 'sin_clave' && /OPENAI_ADMIN_KEY/.test(r.mensaje) && /Usage: Read/.test(r.mensaje))
    ok('la clave normal de OpenAI no cuenta', (await gastoDeIa({ entorno: { OPENAI_API_KEY: 'sk-proj-x' }, ahora: () => AHORA })).estado === 'sin_clave')
  }

  console.log('\n=== con la clave ===')
  {
    vaciarLaCache()
    const m = mundo(() => json({ data: [cubo('2026-10-22', 1), cubo('2026-10-23', 0.5)], has_more: false }))
    const r = await gastoDeIa({ entorno: ENTORNO, ahora: () => AHORA, deps: m.deps })
    ok('devuelve el resumen con la hora de la lectura', r.estado === 'ok' && r.desactualizado === false && r.resumen.esteMes === 1.5 && r.resumen.hoy === 0.5 && r.actualizadoAt === new Date(AHORA).toISOString())
    ok('pide los costes y los nombres de proyecto una vez cada uno', m.llamadas.costes === 1 && m.llamadas.proyectos === 1)

    const otra = await gastoDeIa({ entorno: ENTORNO, ahora: () => AHORA + 60_000, deps: m.deps })
    ok('un minuto después sale de la caché (sin volver a pedir a OpenAI)', otra.estado === 'ok' && m.llamadas.costes === 1)
    const tarde = await gastoDeIa({ entorno: ENTORNO, ahora: () => AHORA + VIDA_DE_LA_CACHE_MS + 1, deps: m.deps })
    ok('pasados los cinco minutos se vuelve a pedir', tarde.estado === 'ok' && m.llamadas.costes === 2)
  }

  console.log('\n=== «Actualizar» ===')
  {
    vaciarLaCache()
    const m = mundo(() => json({ data: [cubo('2026-10-23', 1)], has_more: false }))
    await gastoDeIa({ entorno: ENTORNO, ahora: () => AHORA, deps: m.deps })
    await gastoDeIa({ entorno: ENTORNO, refrescar: true, ahora: () => AHORA + 5_000, deps: m.deps })
    ok('pulsarlo a los 5 segundos no vuelve a pedir (no se machaca a OpenAI)', m.llamadas.costes === 1)
    await gastoDeIa({ entorno: ENTORNO, refrescar: true, ahora: () => AHORA + ESPERA_ENTRE_ACTUALIZACIONES_MS + 1, deps: m.deps })
    ok('pasados 20 segundos sí lee otra vez, aunque la caché no haya caducado', m.llamadas.costes === 2)
  }

  console.log('\n=== cuando OpenAI falla ===')
  {
    vaciarLaCache()
    const quieto = console.error
    const registros: string[] = []
    console.error = (...a: unknown[]) => registros.push(JSON.stringify(a))
    const m = mundo(() => json({ error: { message: 'Missing scopes: api.usage.read' } }, 403))
    const r = await gastoDeIa({ entorno: ENTORNO, ahora: () => AHORA, deps: m.deps })
    console.error = quieto
    ok('sin lectura anterior: un error con su código, su frase y el permiso que falta', r.estado === 'error' && r.codigo === 'sin_permiso' && /Usage: Read/.test(r.mensaje) && r.detalle === 'Falta el permiso api.usage.read')
    ok('el registro del servidor solo lleva código y estado', registros.length === 1 && /sin_permiso/.test(registros[0]) && !/sk-admin|Missing scopes/.test(registros[0]))
  }
  {
    vaciarLaCache()
    let n = 0
    const m = mundo(() => (++n === 1 ? json({ data: [cubo('2026-10-23', 2)], has_more: false }) : json({}, 500)))
    await gastoDeIa({ entorno: ENTORNO, ahora: () => AHORA, deps: m.deps })
    const quieto = console.error
    console.error = () => undefined
    const r = await gastoDeIa({ entorno: ENTORNO, ahora: () => AHORA + VIDA_DE_LA_CACHE_MS + 1, deps: m.deps })
    console.error = quieto
    ok('con una lectura anterior, se enseña ESA marcada como desactualizada y con el motivo (el contador no desaparece)', r.estado === 'ok' && r.desactualizado === true && r.resumen.esteMes === 2 && /OpenAI tiene un problema/.test(r.motivo) && r.actualizadoAt === new Date(AHORA).toISOString())
  }
  {
    vaciarLaCache()
    const m = mundo(() => json({ object: 'nada' }))
    const quieto = console.error
    console.error = () => undefined
    const r = await gastoDeIa({ entorno: ENTORNO, ahora: () => AHORA, deps: m.deps })
    console.error = quieto
    ok('una respuesta con otra forma es un error claro, no un gasto cero', r.estado === 'error' && r.codigo === 'respuesta')
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
