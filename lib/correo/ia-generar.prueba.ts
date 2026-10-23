import { redactarConIa, motivoDelFallo, type ClienteDeCorreoIa } from '@/lib/correo/ia-generar'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const MENSAJES = { system: 'sistema', usuario: 'usuario' }
const BUENO = { asunto: 'Amazon para Acme', texto: 'Hola,\n\nTe escribo porque hemos revisado vuestra tienda y vemos una oportunidad clara de ordenar las fichas y la publicidad en Amazon, sin cargar a vuestro equipo.\n\n¿Te encaja una videollamada breve de 10-15 minutos? ¿Qué día te viene mejor?\n\nUn saludo,', angulo: 'mejorar_cuenta' }
const CON_DINERO = { ...BUENO, texto: `${BUENO.texto}\n\nSabemos que facturáis unos 20.000 € al mes.` }
const CON_HUECO = { ...BUENO, texto: `Hola [Nombre],\n\n${BUENO.texto}` }

interface Llamada {
  args: Record<string, unknown>
  opciones?: { signal?: AbortSignal }
}

/** Un cliente falso que contesta lo que se le diga, en orden, y apunta con qué se le ha llamado */
function falso(respuestas: Array<Record<string, unknown> | Error | { refusal: string } | { raw: string }>): { cliente: ClienteDeCorreoIa; llamadas: Llamada[] } {
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
            if ('refusal' in r) return { choices: [{ finish_reason: 'stop', message: { content: null, refusal: r.refusal as string } }] }
            if ('raw' in r) return { choices: [{ finish_reason: 'stop', message: { content: r.raw as string } }] }
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
    const r = await redactarConIa(MENSAJES, { cliente, modelo: 'gpt-5.5' })
    ok('devuelve el borrador', r.borrador?.asunto === 'Amazon para Acme' && r.aviso === null && r.problemas.length === 0)
    ok('una sola llamada', r.llamadas === 1 && llamadas.length === 1)
    ok('cuenta los tokens', r.tokens?.entrada === 1000 && r.tokens?.salida === 200)
    const a = llamadas[0].args
    ok('pide JSON con esquema estricto', (a.response_format as { type: string; json_schema: { strict: boolean } }).type === 'json_schema' && (a.response_format as { json_schema: { strict: boolean } }).json_schema.strict === true)
    ok('un modelo que razona lleva esfuerzo y NO temperatura', a.reasoning_effort === 'low' && !('temperature' in a))
    ok('manda el sistema y el usuario', JSON.stringify(a.messages) === JSON.stringify([{ role: 'system', content: 'sistema' }, { role: 'user', content: 'usuario' }]))
    const clasico = falso([BUENO])
    await redactarConIa(MENSAJES, { cliente: clasico.cliente, modelo: 'gpt-4o' })
    ok('un modelo de los de siempre lleva temperatura y NO esfuerzo', 'temperature' in clasico.llamadas[0].args && !('reasoning_effort' in clasico.llamadas[0].args))
  }

  console.log('\n=== si habla de dinero ===')
  {
    const a = falso([CON_DINERO, BUENO])
    const r = await redactarConIa(MENSAJES, { cliente: a.cliente })
    ok('se le pide una corrección y se queda con la buena', r.borrador?.texto === BUENO.texto && r.llamadas === 2, JSON.stringify(r.problemas))
    const segunda = a.llamadas[1].args.messages as Array<{ role: string; content: string }>
    ok('la corrección lleva lo que escribió y por qué no vale', segunda.length === 4 && segunda[2].role === 'assistant' && segunda[3].content.includes('facturación'))
    ok('suma los tokens de las dos llamadas', r.tokens?.entrada === 2000)

    const b = falso([CON_DINERO, CON_DINERO])
    const r2 = await redactarConIa(MENSAJES, { cliente: b.cliente })
    ok('si a la segunda sigue hablando de dinero NO se enseña', r2.borrador === null && r2.problemas.includes('dinero') && /dinero/.test(r2.aviso ?? ''), JSON.stringify(r2))
    ok('no pide una tercera', b.llamadas.length === 2)
  }

  console.log('\n=== si deja un hueco ===')
  {
    const a = falso([CON_HUECO, BUENO])
    const r = await redactarConIa(MENSAJES, { cliente: a.cliente })
    ok('se corrige a la segunda', r.borrador?.texto === BUENO.texto && r.llamadas === 2)
    const b = falso([CON_HUECO, CON_HUECO])
    const r2 = await redactarConIa(MENSAJES, { cliente: b.cliente })
    ok('si a la segunda sigue el hueco SÍ se enseña, con un aviso', r2.borrador !== null && r2.problemas.includes('hueco') && /hueco/.test(r2.aviso ?? ''))
  }

  console.log('\n=== lo que falla ===')
  {
    const sinClave = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY
    const r = await redactarConIa(MENSAJES, {})
    ok('sin clave: aviso y nada más', r.borrador === null && /OPENAI_API_KEY/.test(r.aviso ?? ''))
    if (sinClave) process.env.OPENAI_API_KEY = sinClave

    const rechazo = await redactarConIa(MENSAJES, { cliente: falso([{ refusal: 'no puedo' }]).cliente })
    ok('si se niega', rechazo.borrador === null && /negado/.test(rechazo.aviso ?? ''))
    const basura = await redactarConIa(MENSAJES, { cliente: falso([{ raw: 'esto no es json' }]).cliente })
    ok('si devuelve algo ilegible', basura.borrador === null && /no se entiende/.test(basura.aviso ?? ''))
    const e429 = Object.assign(new Error('rate limit'), { status: 429 })
    const saturada = await redactarConIa(MENSAJES, { cliente: falso([e429]).cliente })
    ok('429: dice que está saturada', saturada.borrador === null && /saturada/.test(saturada.aviso ?? ''))
    const e401 = Object.assign(new Error('x'), { status: 401 })
    ok('401: dice que la clave no vale', /clave de la IA no es válida/.test(motivoDelFallo(e401)))
    ok('402: sin saldo', /sin saldo/.test(motivoDelFallo(Object.assign(new Error('x'), { status: 402 }))))
    ok('500: la IA tiene un problema', /problema/.test(motivoDelFallo(Object.assign(new Error('x'), { status: 502 }))))
    ok('un error raro: frase genérica', motivoDelFallo(new Error('algo con datos de un lead')) === 'No se ha podido hablar con la IA.')
    ok('el motivo NO lleva el texto del error original', !motivoDelFallo(new Error('algo con datos de un lead')).includes('lead'))

    // Tiempo agotado: un cliente que no contesta hasta que se aborta
    const lento: ClienteDeCorreoIa = {
      chat: {
        completions: {
          create: (_args, opciones) =>
            new Promise((_res, rej) => {
              opciones?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('Request was aborted.'), { name: 'AbortError' })))
            }),
        },
      },
    }
    const t0 = Date.now()
    const tarde = await redactarConIa(MENSAJES, { cliente: lento, tiempoMaximoMs: 60 })
    ok('si tarda demasiado se corta y lo dice', tarde.borrador === null && /tardado demasiado/.test(tarde.aviso ?? '') && Date.now() - t0 < 2000)
  }

  console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
