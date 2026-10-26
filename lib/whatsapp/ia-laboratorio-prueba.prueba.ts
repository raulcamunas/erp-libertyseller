import type { ClienteDeCorreoIa } from '@/lib/correo/ia-generar'
import { CASOS_DE_PRUEBA, casosPedidos } from '@/lib/whatsapp/ia-casos'
import { conLimite, probarEnLote } from '@/lib/whatsapp/ia-laboratorio-prueba'
import { PERFIL_DE_SERIE, copiaDelPerfil } from '@/lib/whatsapp/ia-perfil'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const AHORA = Date.UTC(2026, 9, 26, 10, 0)
const MENSAJE = { mensaje: 'Hola, soy Raúl de Liberty Seller. Vuestro catálogo puede ganar visibilidad en Amazon sin cargar de trabajo a vuestro equipo. ¿Cuándo te viene bien que te llame?', base: 'Que vende y no está en Amazon' }

/** Un cliente falso que cuenta cuántas llamadas hay a la vez y apunta lo que se le ha mandado */
function falso(opciones: { retrasoMs?: number; fallaEn?: (usuario: string) => boolean } = {}) {
  const enVuelo = { ahora: 0, maximo: 0 }
  const peticiones: Array<{ sistema: string; usuario: string; args: Record<string, unknown> }> = []
  const cliente: ClienteDeCorreoIa = {
    chat: {
      completions: {
        create: async (args) => {
          const mensajes = args.messages as Array<{ role: string; content: string }>
          peticiones.push({ sistema: mensajes[0].content, usuario: mensajes[1].content, args })
          enVuelo.ahora++
          enVuelo.maximo = Math.max(enVuelo.maximo, enVuelo.ahora)
          await new Promise((r) => setTimeout(r, opciones.retrasoMs ?? 5))
          enVuelo.ahora--
          if (opciones.fallaEn?.(mensajes[1].content)) throw Object.assign(new Error('x'), { status: 503 })
          return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(MENSAJE) } }], usage: { prompt_tokens: 2500, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 2000 } } }
        },
      },
    },
  }
  return { cliente, enVuelo, peticiones }
}

async function main() {
  console.log('\n=== lanzar con un límite ===')
  {
    let vivos = 0
    let maximo = 0
    const r = await conLimite([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4, async (n) => {
      vivos++
      maximo = Math.max(maximo, vivos)
      await new Promise((res) => setTimeout(res, 5 + (n % 3) * 3))
      vivos--
      return n * 2
    })
    ok('devuelve los resultados en el mismo orden', r.join() === '2,4,6,8,10,12,14,16,18,20')
    ok('nunca hay más de cuatro a la vez, y se llega a cuatro', maximo === 4, String(maximo))
    ok('con menos elementos que el límite, solo los que hay', (await conLimite([1, 2], 4, async (n) => n)).join() === '1,2' && (await conLimite([], 4, async (n) => n)).length === 0)
  }

  console.log('\n=== probar los diez casos ===')
  {
    const f = falso()
    const r = await probarEnLote({ perfil: PERFIL_DE_SERIE, casos: CASOS_DE_PRUEBA, miNombre: 'Raúl', indicaciones: null, anterior: null, ahora: AHORA }, { cliente: f.cliente, entorno: {} })
    ok('un resultado por caso, en el orden del banco', r.resultados.length === 10 && r.resultados.map((x) => x.id).join() === CASOS_DE_PRUEBA.map((c) => c.id).join())
    ok('todos con mensaje, palabras contadas y la etiqueta del caso', r.resultados.every((x) => x.ok && x.mensaje === MENSAJE.mensaje && x.palabras > 10 && x.etiqueta.length > 5 && !x.real && x.error === null))
    ok('cada uno con su momento: el de su caso', r.resultados.find((x) => x.id === 'interes_alto')?.situacion === 'tras_hablar' && r.resultados.find((x) => x.id === 'ceramica')?.situacion === 'primer_contacto' && r.resultados.find((x) => x.id === 'seguimiento')?.situacion === 'no_contesta')
    ok('con coste, tokens y modelo', r.resultados.every((x) => x.coste !== null && x.costeMaximo !== null && x.costeMaximo > x.coste && x.tokens?.cache === 2000 && x.modelo === 'gpt-6-luna' && x.llamadas === 1))
    ok('lanzados de cuatro en cuatro', f.enVuelo.maximo <= 4 && f.enVuelo.maximo >= 2, String(f.enVuelo.maximo))
    ok('las instrucciones salen una sola vez, en bloques, y son las que recibió la IA', r.sistema.length > 8 && r.sistema.every((b) => b.en === 'sistema') && r.sistema.map((b) => b.texto).join('\n\n') === f.peticiones[0].sistema)
    ok('y los resultados traen solo los bloques del encargo (datos del lead, momento…)', r.resultados.every((x) => x.encargo.length >= 4 && x.encargo.every((b) => b.en === 'encargo') && x.encargo.some((b) => b.id === 'contexto')))
    ok('cada uno recibió su caso: el contexto lleva su empresa', r.resultados.find((x) => x.id === 'audio')?.encargo.find((b) => b.id === 'contexto')?.texto.includes('www.audiomax.es') === true)
    ok('la trampa llegó a la IA como dato, sin el teléfono', (() => {
      const t = r.resultados.find((x) => x.id === 'trampa')!
      const c = t.encargo.find((b) => b.id === 'contexto')!.texto
      return /IGNORA TODAS LAS INSTRUCCIONES/.test(c) && !c.includes('600111222')
    })())
    ok('el caso que pide algo lleva su petición; el resto, ninguna', r.resultados.find((x) => x.id === 'con_indicacion')?.encargo.find((b) => b.id === 'indicaciones')?.texto.includes('muy corto') === true && r.resultados.find((x) => x.id === 'ceramica')?.encargo.find((b) => b.id === 'indicaciones')?.texto.includes('Ninguna.') === true)
  }

  console.log('\n=== una petición común, un lead real y un caso que falla ===')
  {
    const f = falso()
    const real = { id: 'lead-1', etiqueta: 'Mi lead real', lead: { store_name: 'Tienda Real', status: 'programado', category: 'Moda' }, notas: [], llamadas: [] }
    const r = await probarEnLote({ perfil: PERFIL_DE_SERIE, casos: casosPedidos(['ceramica']), real, miNombre: null, indicaciones: 'Más corto', anterior: null, ahora: AHORA }, { cliente: f.cliente, entorno: {} })
    ok('el lead real va después de los casos y se marca como real', r.resultados.length === 2 && r.resultados[1].real && r.resultados[1].id === 'lead-1' && r.resultados[1].etiqueta === 'Mi lead real')
    ok('el momento del lead real sale de su estado (programado = después de hablar)', r.resultados[1].situacion === 'tras_hablar')
    ok('la petición común llega a todos', r.resultados.every((x) => x.encargo.find((b) => b.id === 'indicaciones')?.texto.includes('Más corto')))
    ok('con un momento fijado para el lead real, se respeta', (await probarEnLote({ perfil: PERFIL_DE_SERIE, casos: [], real, situacion: 'no_contesta', miNombre: null, indicaciones: null, anterior: null, ahora: AHORA }, { cliente: falso().cliente, entorno: {} })).resultados[0].situacion === 'no_contesta')

    const g = falso({ fallaEn: (u) => u.includes('Casa Luz') })
    const r2 = await probarEnLote({ perfil: PERFIL_DE_SERIE, casos: casosPedidos(['ceramica', 'no_contesta_hoy', 'audio']), miNombre: 'Raúl', indicaciones: null, anterior: null, ahora: AHORA }, { cliente: g.cliente, entorno: {} })
    const roto = r2.resultados.find((x) => x.id === 'no_contesta_hoy')!
    ok('un caso que falla lo dice y no tumba a los demás', !roto.ok && roto.mensaje === null && /problema|IA/.test(roto.error ?? '') && r2.resultados.filter((x) => x.ok).length === 2, JSON.stringify(roto.error))
    ok('el que falla conserva lo que recibió la IA (se puede mirar por qué)', roto.encargo.length >= 4)
  }

  console.log('\n=== con otro perfil ===')
  {
    const p = copiaDelPerfil(PERFIL_DE_SERIE)
    p.ajustes.tono = 'formal'
    p.ajustes.longitud = 'muy_corto'
    p.modelo = 'gpt-6-sol'
    p.esfuerzo = 'low'
    const f = falso()
    const r = await probarEnLote({ perfil: p, casos: casosPedidos(['ceramica']), miNombre: 'Raúl', indicaciones: null, anterior: null, ahora: AHORA }, { cliente: f.cliente, entorno: {} })
    ok('el perfil probado manda: el trato, la longitud, el modelo y el razonamiento', r.sistema.some((b) => b.texto.includes('TONO FORMAL')) && r.sistema.some((b) => b.texto.includes('entre 15 y 30 palabras')) && r.resultados[0].modelo === 'gpt-6-sol' && f.peticiones[0].args.reasoning_effort === 'low')
    ok('el tope de palabras es el de su longitud', r.resultados[0].maxPalabras === 50)
    ok('y el coste, el del precio de ese modelo', r.resultados[0].coste !== null && Math.abs((r.resultados[0].coste as number) - (500 * 2 + 2000 * 0.2 + 100 * 10) / 1e6) < 1e-12)
  }

  console.log('\n=== sin clave ===')
  {
    const clave = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    const r = await probarEnLote({ perfil: PERFIL_DE_SERIE, casos: casosPedidos(['ceramica', 'audio']), miNombre: 'Raúl', indicaciones: null, anterior: null, ahora: AHORA }, { entorno: {} })
    if (clave !== undefined) process.env.OPENAI_API_KEY = clave
    ok('cada caso dice por qué no hay mensaje, y las instrucciones se enseñan igualmente', r.resultados.every((x) => !x.ok && /OPENAI_API_KEY/.test(x.error ?? '') && x.coste === null) && r.sistema.length > 8)
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
