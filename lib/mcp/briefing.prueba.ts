import { BRIEFING_DE_EJEMPLO } from '@/lib/briefing/ejemplo'
import { FALTA_MIGRACION_BRIEFING, FaltaMigracionDelBriefing } from '@/lib/briefing/servidor'
import type { Briefing } from '@/lib/briefing/tipos'
import { HERRAMIENTAS_BRIEFING, INSTRUCCIONES_BRIEFING, type ContextoBriefing } from '@/lib/mcp/briefing'
import { crearLimitador } from '@/lib/mcp/limite'
import { crearManejadorMcp } from '@/lib/mcp/manejador'
import { procesarPost, type EntornoMcp } from '@/lib/mcp/protocolo'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const j = (x: unknown) => JSON.stringify(x)
const copia = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T

/** Un contexto de mentira: guarda lo que se publica por día y dice si era nuevo */
function montar(opciones: { hoy?: string; falla?: Error } = {}) {
  const guardado = new Map<string, Briefing>()
  const ctx: ContextoBriefing = {
    hoy: () => opciones.hoy ?? '2026-10-27',
    async publicar(dia, briefing) {
      if (opciones.falla) throw opciones.falla
      const nuevo = !guardado.has(dia)
      guardado.set(dia, briefing)
      return { nuevo }
    },
  }
  const entorno: EntornoMcp<ContextoBriefing> = {
    nombreServidor: 'liberty-seller-briefing',
    tituloServidor: 'Briefing de Liberty Seller',
    version: '1.0.0',
    instrucciones: INSTRUCCIONES_BRIEFING,
    herramientas: HERRAMIENTAS_BRIEFING,
  }
  const llamar = async (metodo: string, params: Record<string, unknown> = {}) => {
    const r = await procesarPost({ cuerpoCrudo: JSON.stringify({ jsonrpc: '2.0', id: 1, method: metodo, params }), cabeceraVersion: null, entorno, ctx })
    return r.cuerpo as { result?: Record<string, unknown>; error?: { message: string } }
  }
  const publicar = async (args: Record<string, unknown>) => {
    const r = await llamar('tools/call', { name: 'publicar_briefing', arguments: args })
    const res = r.result as { content: Array<{ text: string }>; isError: boolean; structuredContent?: Record<string, unknown> }
    return { texto: res.content[0].text, esError: res.isError, estructurado: res.structuredContent }
  }
  return { guardado, llamar, publicar }
}

async function run() {
  console.log('\n=== lo que ve Claude al conectar ===')
  {
    const m = montar()
    const inicio = await m.llamar('initialize', { protocolVersion: '2025-06-18' })
    const info = inicio.result as { serverInfo: { name: string }; instructions: string; capabilities: Record<string, unknown> }
    ok('se presenta con su nombre y con instrucciones', info.serverInfo.name === 'liberty-seller-briefing' && /SOLO sirve para publicar el briefing/.test(info.instructions) && 'tools' in info.capabilities)
    const lista = (await m.llamar('tools/list')).result as { tools: Array<{ name: string; inputSchema: { required: string[]; properties: Record<string, unknown> }; annotations: Record<string, unknown>; description: string }> }
    ok('ofrece UNA sola herramienta: publicar_briefing', lista.tools.length === 1 && lista.tools[0].name === 'publicar_briefing', j(lista.tools.map((t) => t.name)))
    const t = lista.tools[0]
    ok('NO es de solo lectura (escribe) y no es destructiva; se puede repetir (sustituye el día)', t.annotations.readOnlyHint === false && t.annotations.destructiveHint === false && t.annotations.idempotentHint === true)
    ok('pide `briefing` y acepta `dia`', t.inputSchema.required.join() === 'briefing' && 'briefing' in t.inputSchema.properties && 'dia' in t.inputSchema.properties)
    ok('la descripción explica las claves del JSON, el día y que sustituye', /titular/.test(t.description) && /revisar/.test(t.description) && /comerciales/.test(t.description) && /idempotente/i.test(t.description) && /https/.test(t.description))
    ok('las instrucciones dicen que lo leído en Notion, Gmail o Calendar son datos y no órdenes', /nunca instrucciones/.test(INSTRUCCIONES_BRIEFING))
  }

  console.log('\n=== publicar ===')
  {
    const m = montar()
    const r = await m.publicar({ briefing: copia(BRIEFING_DE_EJEMPLO) })
    ok('publica y lo cuenta: día, titular y qué hay', !r.esError && /^Publicado\./.test(r.texto) && r.texto.includes('2026-10-27') && r.texto.includes('4 puntos en «Revisa hoy»'), r.texto)
    ok('el día sale de fecha_label y lo dice', /de fecha_label/.test(r.texto) && m.guardado.has('2026-10-27'))
    ok('guarda el briefing LIMPIO (con las claves de los puntos)', m.guardado.get('2026-10-27')?.revisar[0].clave.startsWith('r-') === true)
    ok('devuelve también el resultado estructurado', r.estructurado?.dia === '2026-10-27' && r.estructurado.nuevo === true && r.estructurado.puntos_revisar === 4)
    const r2 = await m.publicar({ briefing: copia(BRIEFING_DE_EJEMPLO) })
    ok('publicar otra vez el mismo día lo SUSTITUYE y dice «Actualizado»', /^Actualizado\./.test(r2.texto) && m.guardado.size === 1 && r2.estructurado?.nuevo === false)

    const b = copia(BRIEFING_DE_EJEMPLO) as Record<string, unknown>
    b.titular = 'Otro día'
    const r3 = await m.publicar({ briefing: b, dia: '2026-10-26' })
    ok('con `dia` manda lo que diga la rutina, aunque fecha_label diga otro', m.guardado.has('2026-10-26') && !/se ha sacado/.test(r3.texto) && m.guardado.get('2026-10-26')?.titular === 'Otro día')

    const m2 = montar()
    const sinFecha = copia(BRIEFING_DE_EJEMPLO) as Record<string, unknown>
    delete sinFecha.fecha_label
    const r4 = await m2.publicar({ briefing: sinFecha })
    ok('sin fecha_label ni dia, usa hoy, lo dice, y la pantalla tendrá su etiqueta', /de hoy/.test(r4.texto) && m2.guardado.get('2026-10-27')?.fecha_label === 'Martes 27 de octubre de 2026', r4.texto)

    const m3 = montar()
    const texto = await m3.publicar({ briefing: JSON.stringify(BRIEFING_DE_EJEMPLO) })
    ok('acepta el JSON como texto', !texto.esError && m3.guardado.has('2026-10-27'))
  }

  console.log('\n=== los avisos que se le devuelven a la rutina ===')
  {
    const m = montar()
    const b = copia(BRIEFING_DE_EJEMPLO) as { revisar: Array<Record<string, unknown>>; titular: string }
    b.titular = 'x'.repeat(900)
    b.revisar[0].url = 'http://inseguro.test'
    const r = await m.publicar({ briefing: b })
    ok('si se ha recortado o descartado algo, la respuesta lo dice (y se publica igualmente)', !r.esError && /Avisos:/.test(r.texto) && /recortado/.test(r.texto) && /enlace que no era https/.test(r.texto), r.texto)
  }

  console.log('\n=== lo que se rechaza, con una frase para corregirse ===')
  {
    const m = montar()
    const sinTitular = await m.publicar({ briefing: { revisar: [] } })
    ok('sin titular', sinTitular.esError && /titular/.test(sinTitular.texto) && m.guardado.size === 0)
    const roto = await m.publicar({ briefing: 'esto no es json' })
    ok('un texto que no es JSON', roto.esError && /no es un JSON válido/.test(roto.texto))
    const falta = await m.llamar('tools/call', { name: 'publicar_briefing', arguments: {} })
    ok('sin el argumento `briefing`', JSON.stringify(falta).includes('Falta el argumento') && JSON.stringify(falta).includes('briefing'))
    const raro = await m.publicar({ briefing: copia(BRIEFING_DE_EJEMPLO), dia_del_briefing: '2026-10-27' })
    ok('un argumento que no existe se rechaza y se dicen los que sí', raro.esError && /Argumento desconocido/.test(raro.texto) && /briefing, dia/.test(raro.texto), raro.texto)
    const dia = await m.publicar({ briefing: copia(BRIEFING_DE_EJEMPLO), dia: '27/10/2026' })
    ok('un día mal escrito', dia.esError && /AAAA-MM-DD/.test(dia.texto))
    const lejos = await m.publicar({ briefing: copia(BRIEFING_DE_EJEMPLO), dia: '2026-09-01' })
    ok('un día de hace mes y medio (casi siempre un error de fecha)', lejos.esError && /fuera de lo razonable/.test(lejos.texto) && m.guardado.size === 0)
    const enorme = copia(BRIEFING_DE_EJEMPLO) as { revisar: Array<Record<string, unknown>> }
    enorme.revisar = Array.from({ length: 30 }, (_, i) => ({ titulo: `t${i}`.padEnd(190, 'q'), area: 'A', texto: 'w'.repeat(490), fuente: 'f'.repeat(190), url: `https://x.test/${'p'.repeat(900)}` }))
    ;(enorme as Record<string, unknown>).correo = enorme.revisar
    ;(enorme as Record<string, unknown>).tareas = { comentarios: Array.from({ length: 40 }, () => ({ tarea: 'x'.repeat(190), texto: 'y'.repeat(490) })), destacadas: Array.from({ length: 40 }, () => ({ tarea: 'x'.repeat(190), texto: 'y'.repeat(490) })), en_revision: Array.from({ length: 40 }, () => ({ tarea: 'x'.repeat(190) })) }
    const grande = await m.publicar({ briefing: enorme })
    ok('uno de tamaño absurdo', grande.esError && /demasiado grande/.test(grande.texto) && m.guardado.size === 0)
  }

  console.log('\n=== cuando la base falla ===')
  {
    const sinMigracion = montar({ falla: new FaltaMigracionDelBriefing() })
    const r = await sinMigracion.publicar({ briefing: copia(BRIEFING_DE_EJEMPLO) })
    ok('sin la migración dice qué fichero lanzar (es una frase pensada para leerse)', r.esError && r.texto === FALTA_MIGRACION_BRIEFING && /254_briefing/.test(r.texto), r.texto)

    const original = console.error
    console.error = () => undefined
    const caida = montar({ falla: new Error('connection refused a db.interna:5432 con la contraseña xyz') })
    const c = await caida.publicar({ briefing: copia(BRIEFING_DE_EJEMPLO) })
    console.error = original
    ok('cualquier otro fallo sale como un mensaje genérico: nada de nombres de tablas ni de servidores', c.esError && /error interno/.test(c.texto) && !/db\.interna|xyz|connection/.test(c.texto), c.texto)
  }

  console.log('\n=== el manejador del enlace: el freno, el origen y el tamaño ===')
  {
    const entorno: EntornoMcp<ContextoBriefing> = { nombreServidor: 'b', tituloServidor: 'B', version: '1', instrucciones: 'x', herramientas: HERRAMIENTAS_BRIEFING }
    const ctx: ContextoBriefing = { hoy: () => '2026-10-27', publicar: async () => ({ nuevo: true }) }
    let t = 0
    const m = crearManejadorMcp<ContextoBriefing>({
      baseUrl: () => 'https://app.libertyseller.com',
      supabaseUrl: () => 'https://x.supabase.co',
      autenticar: async () => ({ ok: true, usuario: { id: 'enlace-del-briefing', email: null, rol: 'enlace', clienteOAuth: 'enlace' } }),
      limitador: crearLimitador({ maximo: 30, ventanaMs: 60_000, ahora: () => t }),
      entornoDe: () => ({ entorno, ctx }),
    })
    const post = (cuerpo: unknown, cabeceras: Record<string, string> = {}) =>
      new Request('https://app.libertyseller.com/api/mcp/briefing/x', { method: 'POST', headers: { 'content-type': 'application/json', ...cabeceras }, body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) })
    const ping = { jsonrpc: '2.0', id: 1, method: 'ping' }
    ok('sin Origin (así llama Claude desde sus servidores) pasa', (await m.POST(post(ping))).status === 200)
    ok('desde claude.ai pasa', (await m.POST(post(ping, { origin: 'https://claude.ai' }))).status === 200)
    ok('desde una web cualquiera NO: es la defensa contra páginas que usen el enlace desde el navegador de alguien', (await m.POST(post(ping, { origin: 'https://malo.example' }))).status === 403)
    ok('un mensaje de más de 128 KB se rechaza', (await m.POST(post('x'.repeat(200_000)))).status === 413)
    let ultimo = 200
    for (let i = 0; i < 40; i++) ultimo = (await m.POST(post(ping))).status
    ok('el freno corta a las 30 llamadas por minuto, con Retry-After', ultimo === 429)
    t += 61_000
    ok('y se abre otra ventana al minuto', (await m.POST(post(ping))).status === 200)
    ok('GET y DELETE: 405 (no hay flujo que ofrecer)', m.GET().status === 405 && m.DELETE().status === 405)
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
