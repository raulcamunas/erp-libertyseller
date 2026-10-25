import type { ClienteDeCorreoIa } from '@/lib/correo/ia-generar'
import { MODELO_DE_WHATSAPP_POR_DEFECTO, TIEMPO_MAXIMO_DE_WHATSAPP_MS, escribirWhatsappConIa } from '@/lib/whatsapp/ia-generar'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const MENSAJES = { system: 'sistema', usuario: 'usuario' }
const BUENO = { mensaje: 'Hola, soy Raúl de Liberty Seller. Estuve viendo vuestra cerámica y creo que en Amazon hay un hueco claro para piezas así, sin que tengáis que ocuparos del alta. ¿Te cuento cómo lo haríamos en diez minutos?', base: 'Que vende cerámica y no está en Amazon' }
const CON_DINERO = { ...BUENO, mensaje: `${BUENO.mensaje} Sé que facturáis unos 20.000 € al mes.` }
const CON_HUECO = { ...BUENO, mensaje: BUENO.mensaje.replace('Raúl', '[Nombre]') }
const CON_ENLACE = { ...BUENO, mensaje: `${BUENO.mensaje} Mira www.libertyseller.com` }
const OTRO = { mensaje: 'Hola, te escribí el otro día y no quería dejarlo así: tengo una idea concreta para vuestras fichas que te puede interesar. ¿Cuándo te viene bien que te llame un momento?', base: 'Que ya se le escribió' }

interface Llamada {
  args: Record<string, unknown>
  opciones?: { signal?: AbortSignal }
}

/** Un cliente falso que contesta lo que se le diga, en orden, y apunta con qué se le ha llamado */
function falso(respuestas: Array<Record<string, unknown> | Error | { refusal: string } | { raw: string; finish?: string } | { cuelga: true }>): { cliente: ClienteDeCorreoIa; llamadas: Llamada[] } {
  const llamadas: Llamada[] = []
  let i = 0
  return {
    llamadas,
    cliente: {
      chat: {
        completions: {
          create: async (args, opciones) => {
            llamadas.push({ args, opciones })
            const r = respuestas[Math.min(i++, respuestas.length - 1)]
            if (r instanceof Error) throw r
            if ('cuelga' in r) {
              // No contesta nunca, salvo que se le aborte
              return new Promise((_resolve, rechazar) => {
                opciones?.signal?.addEventListener('abort', () => rechazar(Object.assign(new Error('abortado'), { name: 'AbortError' })))
              })
            }
            if ('refusal' in r) return { choices: [{ finish_reason: 'stop', message: { content: null, refusal: r.refusal as string } }] }
            if ('raw' in r) return { choices: [{ finish_reason: (r.finish as string | undefined) ?? 'stop', message: { content: r.raw as string } }] }
            return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(r) } }], usage: { prompt_tokens: 1000, completion_tokens: 200 } }
          },
        },
      },
    },
  }
}

async function main() {
  console.log('\n=== a la primera ===')
  {
    const { cliente, llamadas } = falso([BUENO])
    const r = await escribirWhatsappConIa(MENSAJES, [], { cliente, entorno: { IA_MODELO: 'gpt-6-luna' } })
    ok('devuelve el mensaje y en qué se apoya', r.mensaje?.mensaje === BUENO.mensaje && r.mensaje?.base === BUENO.base && r.aviso === null && r.problemas.length === 0)
    ok('una sola llamada', r.llamadas === 1 && llamadas.length === 1)
    ok('cuenta los tokens', r.tokens?.entrada === 1000 && r.tokens?.salida === 200)
    const a = llamadas[0].args
    ok('pide JSON con esquema estricto', (a.response_format as { type: string; json_schema: { strict: boolean; name: string } }).type === 'json_schema' && (a.response_format as { json_schema: { strict: boolean } }).json_schema.strict === true)
    ok('un modelo que razona lleva esfuerzo, tope de salida y NO temperatura', a.reasoning_effort === 'low' && typeof a.max_completion_tokens === 'number' && !('temperature' in a) && !('max_tokens' in a), JSON.stringify(a))
    ok('manda el sistema y el usuario', JSON.stringify(a.messages) === JSON.stringify([{ role: 'system', content: 'sistema' }, { role: 'user', content: 'usuario' }]))
    ok('lleva una señal para poder cortar la espera', llamadas[0].opciones?.signal instanceof AbortSignal)
    ok('el modelo de serie es el mismo que el de redactar correos con IA', MODELO_DE_WHATSAPP_POR_DEFECTO === 'gpt-5.6-terra')

    const clasico = falso([BUENO])
    await escribirWhatsappConIa(MENSAJES, [], { cliente: clasico.cliente, entorno: { IA_MODELO: 'gpt-4.1' } })
    ok('un modelo de los de siempre lleva temperatura y NO esfuerzo', 'temperature' in clasico.llamadas[0].args && !('reasoning_effort' in clasico.llamadas[0].args))
    const otro = falso([BUENO])
    const r2 = await escribirWhatsappConIa(MENSAJES, [], { cliente: otro.cliente, entorno: { IA_MODELO: 'gpt-5.6-terra' } })
    ok('se puede cambiar de modelo desde el servidor', otro.llamadas[0].args.model === 'gpt-5.6-terra' && r2.modelo === 'gpt-5.6-terra')
    const forzado = falso([BUENO])
    await escribirWhatsappConIa(MENSAJES, [], { cliente: forzado.cliente, entorno: { IA_MODELO: 'gpt-6-luna', IA_ESFUERZO: 'none' } })
    ok('el esfuerzo que manda el servidor se respeta', forzado.llamadas[0].args.reasoning_effort === 'none')
  }

  console.log('\n=== si habla de dinero ===')
  {
    const a = falso([CON_DINERO, BUENO])
    const r = await escribirWhatsappConIa(MENSAJES, [], { cliente: a.cliente })
    ok('se le pide una corrección y se queda con la buena', r.mensaje?.mensaje === BUENO.mensaje && r.llamadas === 2, JSON.stringify(r.problemas))
    const segunda = a.llamadas[1].args.messages as Array<{ role: string; content: string }>
    ok('la corrección lleva lo que escribió y por qué no vale', segunda.length === 4 && segunda[2].role === 'assistant' && segunda[2].content.includes('facturáis') && segunda[3].content.includes('facturación'))
    ok('suma los tokens de las dos llamadas', r.tokens?.entrada === 2000 && r.tokens?.salida === 400)

    const b = falso([CON_DINERO, CON_DINERO])
    const r2 = await escribirWhatsappConIa(MENSAJES, [], { cliente: b.cliente })
    ok('si a la segunda sigue hablando de dinero NO se enseña', r2.mensaje === null && r2.problemas.includes('dinero') && /dinero/.test(r2.aviso ?? ''), JSON.stringify(r2))
    ok('no pide una tercera', b.llamadas.length === 2)
  }

  console.log('\n=== si deja un hueco o lleva un enlace ===')
  {
    const a = falso([CON_HUECO, BUENO])
    const r = await escribirWhatsappConIa(MENSAJES, [], { cliente: a.cliente })
    ok('se corrige a la segunda', r.mensaje?.mensaje === BUENO.mensaje && r.llamadas === 2)
    const b = falso([CON_HUECO, CON_HUECO])
    const r2 = await escribirWhatsappConIa(MENSAJES, [], { cliente: b.cliente })
    ok('si a la segunda sigue el hueco SÍ se enseña, con un aviso (el comercial lo ve y lo edita)', r2.mensaje?.mensaje === CON_HUECO.mensaje && /hueco/i.test(r2.aviso ?? '') && r2.problemas.includes('hueco'), JSON.stringify(r2.aviso))
    const c = falso([CON_ENLACE, CON_ENLACE])
    const r3 = await escribirWhatsappConIa(MENSAJES, [], { cliente: c.cliente })
    ok('un enlace que no se quita se enseña con su aviso', r3.mensaje !== null && /enlace/i.test(r3.aviso ?? ''))
    const d = falso([{ ...BUENO, mensaje: 'Hola, soy Raúl de Liberty Seller.' }, { ...BUENO, mensaje: 'Hola, soy Raúl de Liberty Seller.' }])
    const r4 = await escribirWhatsappConIa(MENSAJES, [], { cliente: d.cliente })
    ok('un mensaje que casi no dice nada se corrige una vez y, si sigue igual, sale con su aviso', r4.llamadas === 2 && r4.mensaje !== null && /corto/.test(r4.aviso ?? ''), JSON.stringify(r4.aviso))
    const e = falso([{ ...BUENO, mensaje: 'Hola, soy Raúl.' }, BUENO])
    const r5 = await escribirWhatsappConIa(MENSAJES, [], { cliente: e.cliente })
    ok('uno de una frase suelta no se considera un mensaje: no se enseña y no se gasta una corrección', r5.mensaje === null && r5.llamadas === 1 && /no se entiende/.test(r5.aviso ?? ''))
  }

  console.log('\n=== si repite un WhatsApp anterior ===')
  {
    const a = falso([BUENO, OTRO])
    const r = await escribirWhatsappConIa(MENSAJES, [BUENO.mensaje], { cliente: a.cliente })
    ok('se le pide otro distinto y se queda con él', r.mensaje?.mensaje === OTRO.mensaje && r.llamadas === 2 && r.aviso === null, JSON.stringify(r.problemas))
    ok('la corrección dice que ya se le escribió', ((a.llamadas[1].args.messages as Array<{ content: string }>)[3].content).includes('ya se le escribió'))
    const b = falso([BUENO, BUENO])
    const r2 = await escribirWhatsappConIa(MENSAJES, [BUENO.mensaje], { cliente: b.cliente })
    ok('si lo repite igualmente, se enseña con el aviso de que se parece a uno anterior', r2.mensaje !== null && /ya se le escribió|parece/i.test(r2.aviso ?? ''), JSON.stringify(r2.aviso))
  }

  console.log('\n=== cuando la IA no puede ===')
  {
    const sinClave = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    const r = await escribirWhatsappConIa(MENSAJES, [])
    ok('sin clave: avisa y no lanza', r.mensaje === null && /OPENAI_API_KEY/.test(r.aviso ?? '') && r.llamadas === 0)
    if (sinClave !== undefined) process.env.OPENAI_API_KEY = sinClave

    const rechazo = await escribirWhatsappConIa(MENSAJES, [], { cliente: falso([{ refusal: 'no' }]).cliente })
    ok('si se niega', rechazo.mensaje === null && /negado/.test(rechazo.aviso ?? ''))
    const ilegible = await escribirWhatsappConIa(MENSAJES, [], { cliente: falso([{ raw: 'esto no es json' }]).cliente })
    ok('una respuesta ilegible', ilegible.mensaje === null && /no se entiende/.test(ilegible.aviso ?? ''))
    const cortada = await escribirWhatsappConIa(MENSAJES, [], { cliente: falso([{ raw: '{"mensaje":"Hola, soy', finish: 'length' }]).cliente })
    ok('una respuesta cortada por el tope', cortada.mensaje === null && /cortado|cortada/.test(cortada.aviso ?? ''))

    for (const [estado, texto] of [
      [401, /clave/],
      [402, /saldo/],
      [429, /saturada/],
      [503, /problema/],
    ] as Array<[number, RegExp]>) {
      const r = await escribirWhatsappConIa(MENSAJES, [], { cliente: falso([Object.assign(new Error('x'), { status: estado })]).cliente })
      ok(`error ${estado}: lo dice con una frase ya escrita`, r.mensaje === null && texto.test(r.aviso ?? ''), r.aviso ?? '')
    }
    const raro = await escribirWhatsappConIa(MENSAJES, [], { cliente: falso([Object.assign(new Error('secreto: el cuerpo del lead'), { status: 400 })]).cliente })
    ok('un error raro no filtra su texto a la pantalla', raro.mensaje === null && !/secreto/.test(raro.aviso ?? '') && /No se ha podido hablar con la IA/.test(raro.aviso ?? ''))

    const lenta = falso([{ cuelga: true }])
    const t0 = Date.now()
    const r2 = await escribirWhatsappConIa(MENSAJES, [], { cliente: lenta.cliente, tiempoMaximoMs: 60 })
    ok('si tarda demasiado se corta y se dice', r2.mensaje === null && /tardado demasiado/.test(r2.aviso ?? '') && Date.now() - t0 < 2000)
    ok('el tiempo máximo normal da para razonar y es menor que el de la ruta (60 s)', TIEMPO_MAXIMO_DE_WHATSAPP_MS >= 20_000 && TIEMPO_MAXIMO_DE_WHATSAPP_MS < 60_000)
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
