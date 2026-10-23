import type { ClienteDeCorreoIa } from '@/lib/correo/ia-generar'
import { costeAproximado, escribirSeguimientos, modeloDeSecuencias, revisarConIa } from '@/lib/correo/secuencias/ia'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

const MENSAJES = { system: 'sistema', usuario: 'usuario' }
const PRIMERO = 'Hola, he estado mirando vuestra tienda de decoración y creo que hay un par de cosas en vuestras fichas que merecen una mirada. ¿Te viene mejor una videollamada de 10 minutos esta semana o la próxima? Un saludo,'
const S1 = 'Hola, te escribí hace unos días sobre vuestro catálogo. Una idea distinta: revisar cómo aparecen vuestros productos más vendidos cuando alguien busca por estilo y no por nombre. Si te encaja, lo vemos en diez minutos. Un saludo,'
const S2 = 'Hola, no quiero ser pesado, así que este es mi último mensaje. Si ahora no es buen momento, dímelo con una palabra y lo dejamos para más adelante. Quedo a tu disposición. Un saludo,'
const BUENOS = { seguimiento_1: S1, seguimiento_2: S2 }
const CON_DINERO = { seguimiento_1: S1, seguimiento_2: 'Hola, vemos que facturáis unos 30.000 € al mes y por eso creemos que podemos ayudaros a crecer más con una videollamada corta. Un saludo,' }
const CON_HUECO = { seguimiento_1: 'Hola [Nombre], te escribí hace unos días sobre vuestro catálogo y quería saber si te interesa verlo con calma en una videollamada breve. Un saludo,', seguimiento_2: S2 }

interface Llamada {
  args: Record<string, unknown>
  opciones?: { signal?: AbortSignal }
}

type Respuesta = Record<string, unknown> | Error | { refusal: string } | { raw: string; corte?: boolean }

/** Un cliente falso que contesta lo que se le diga, en orden, y apunta con qué se le ha llamado */
function falso(respuestas: Respuesta[]): { cliente: ClienteDeCorreoIa; llamadas: Llamada[] } {
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
            if ('raw' in r) return { choices: [{ finish_reason: r.corte ? 'length' : 'stop', message: { content: r.raw as string } }] }
            return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(r) } }], usage: { prompt_tokens: 1500, completion_tokens: 300 } }
          },
        },
      },
    },
  }
}

async function main() {
  delete process.env.SECUENCIAS_IA_MODELO
  delete process.env.IA_MODELO

  console.log('\n=== escribir los seguimientos: a la primera ===')
  {
    const { cliente, llamadas } = falso([BUENOS])
    const r = await escribirSeguimientos(MENSAJES, 2, PRIMERO, { cliente })
    ok('devuelve los dos textos y ningún aviso', r.textos?.length === 2 && r.textos[0] === S1 && r.aviso === null && r.problemas.every((p) => p.length === 0))
    ok('una sola llamada', r.llamadas === 1 && llamadas.length === 1)
    ok('cuenta los tokens y el modelo es luna', r.tokens?.entrada === 1500 && r.tokens?.salida === 300 && r.modelo === 'gpt-6-luna')
    const a = llamadas[0].args
    ok('pide luna con esfuerzo bajo, sin temperatura ni max_tokens', a.model === 'gpt-6-luna' && a.reasoning_effort === 'low' && !('temperature' in a) && !('max_tokens' in a) && typeof a.max_completion_tokens === 'number')
    const formato = a.response_format as { type: string; json_schema: { strict: boolean; schema: { required: string[] } } }
    ok('pide JSON estricto con un campo por seguimiento', formato.type === 'json_schema' && formato.json_schema.strict === true && formato.json_schema.schema.required.join() === 'seguimiento_1,seguimiento_2')
    ok('manda el sistema y el usuario', JSON.stringify(a.messages) === JSON.stringify([{ role: 'system', content: 'sistema' }, { role: 'user', content: 'usuario' }]))
    ok('el coste de luna es una fracción de céntimo', Math.abs((costeAproximado(r.modelo, r.tokens) ?? 0) - 0.0003) < 0.0001, String(costeAproximado(r.modelo, r.tokens)))
    ok('con otro modelo no se inventa el coste', costeAproximado('gpt-5.5', r.tokens) === null && costeAproximado('gpt-6-luna', null) === null)
  }

  console.log('\n=== el modelo se cambia por el entorno ===')
  {
    process.env.SECUENCIAS_IA_MODELO = 'gpt-5.6-terra'
    const { cliente, llamadas } = falso([BUENOS])
    const r = await escribirSeguimientos(MENSAJES, 2, PRIMERO, { cliente })
    ok('SECUENCIAS_IA_MODELO manda', llamadas[0].args.model === 'gpt-5.6-terra' && r.modelo === 'gpt-5.6-terra' && modeloDeSecuencias() === 'gpt-5.6-terra')
    delete process.env.SECUENCIAS_IA_MODELO
    process.env.IA_MODELO = 'gpt-4.1'
    const b = falso([BUENOS])
    await escribirSeguimientos(MENSAJES, 2, PRIMERO, { cliente: b.cliente })
    ok('IA_MODELO también, y con un modelo de los de siempre va con temperatura y sin esfuerzo', b.llamadas[0].args.model === 'gpt-4.1' && 'temperature' in b.llamadas[0].args && !('reasoning_effort' in b.llamadas[0].args))
    delete process.env.IA_MODELO
  }

  console.log('\n=== si habla de dinero ===')
  {
    const a = falso([CON_DINERO, BUENOS])
    const r = await escribirSeguimientos(MENSAJES, 2, PRIMERO, { cliente: a.cliente })
    ok('se pide una corrección y se queda con los buenos', r.textos?.[1] === S2 && r.llamadas === 2 && r.aviso === null)
    const segunda = a.llamadas[1].args.messages as Array<{ role: string; content: string }>
    ok('la corrección lleva lo que escribió y por qué no vale', segunda.length === 4 && segunda[2].role === 'assistant' && segunda[3].content.includes('seguimiento 2') && segunda[3].content.includes('cifra de dinero'))
    ok('suma los tokens de las dos llamadas', r.tokens?.entrada === 3000)
    const b = falso([CON_DINERO, CON_DINERO])
    const r2 = await escribirSeguimientos(MENSAJES, 2, PRIMERO, { cliente: b.cliente })
    ok('si a la segunda sigue hablando de dinero NO se enseña', r2.textos === null && /dinero/.test(r2.aviso ?? '') && r2.problemas[1].includes('dinero'))
    ok('no pide una tercera', b.llamadas.length === 2)
  }

  console.log('\n=== si deja un hueco o repite ===')
  {
    const a = falso([CON_HUECO, BUENOS])
    const r = await escribirSeguimientos(MENSAJES, 2, PRIMERO, { cliente: a.cliente })
    ok('se corrige a la segunda', r.textos?.[0] === S1 && r.llamadas === 2)
    const b = falso([CON_HUECO, CON_HUECO])
    const r2 = await escribirSeguimientos(MENSAJES, 2, PRIMERO, { cliente: b.cliente })
    ok('si sigue el hueco, se enseña con un aviso para que el comercial lo vea', r2.textos?.length === 2 && /hueco/.test(r2.aviso ?? ''))
    const igual = falso([{ seguimiento_1: S1, seguimiento_2: S1 }])
    const r3 = await escribirSeguimientos(MENSAJES, 2, PRIMERO, { cliente: igual.cliente })
    ok('dos seguimientos iguales: se pide cambiarlos, y si sigue igual se avisa', r3.llamadas === 2 && /parece/.test(r3.aviso ?? ''))
  }

  console.log('\n=== lo que sale mal ===')
  {
    const rechazo = await escribirSeguimientos(MENSAJES, 2, PRIMERO, { cliente: falso([{ refusal: 'no' }]).cliente })
    ok('si se niega', rechazo.textos === null && /negado/.test(rechazo.aviso ?? ''))
    const basura = await escribirSeguimientos(MENSAJES, 2, PRIMERO, { cliente: falso([{ raw: 'no es json' }]).cliente })
    ok('si devuelve algo ilegible', basura.textos === null && /no se entiende/.test(basura.aviso ?? ''))
    const cortada = await escribirSeguimientos(MENSAJES, 2, PRIMERO, { cliente: falso([{ raw: '{"seguimiento_1": "Ho', corte: true }]).cliente })
    ok('si la respuesta se corta por el tope', cortada.textos === null && /cortado/.test(cortada.aviso ?? ''))
    const sinSaldo = await escribirSeguimientos(MENSAJES, 2, PRIMERO, { cliente: falso([Object.assign(new Error('x'), { status: 402 })]).cliente })
    ok('sin saldo', sinSaldo.textos === null && /saldo/.test(sinSaldo.aviso ?? ''))
    const saturada = await escribirSeguimientos(MENSAJES, 2, PRIMERO, { cliente: falso([Object.assign(new Error('x'), { status: 429 })]).cliente })
    ok('saturada', saturada.textos === null && /saturada/.test(saturada.aviso ?? ''))
    const sinClave = (() => {
      const antes = process.env.OPENAI_API_KEY
      delete process.env.OPENAI_API_KEY
      return escribirSeguimientos(MENSAJES, 2, PRIMERO).finally(() => {
        if (antes !== undefined) process.env.OPENAI_API_KEY = antes
      })
    })()
    const r = await sinClave
    ok('sin clave en el servidor, lo dice y no lanza', r.textos === null && /OPENAI_API_KEY/.test(r.aviso ?? '') && r.llamadas === 0)
    const lenta: ClienteDeCorreoIa = { chat: { completions: { create: (_a, o) => new Promise((_res, rej) => o?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))) } } }
    const tarda = await escribirSeguimientos(MENSAJES, 2, PRIMERO, { cliente: lenta, tiempoMaximoMs: 30 })
    ok('si la IA tarda demasiado, se corta', tarda.textos === null && /tardado demasiado/.test(tarda.aviso ?? ''))
  }

  console.log('\n=== revisar antes de enviar ===')
  {
    const enviar = falso([{ decision: 'enviar', motivo: 'Solo es una llamada sin respuesta.', texto: '' }])
    const r = await revisarConIa(MENSAJES, S2, { cliente: enviar.cliente })
    ok('«enviar»', r.revision?.decision === 'enviar' && r.aviso === null && r.tokens?.entrada === 1500)
    ok('una sola llamada, esquema estricto, luna', enviar.llamadas.length === 1 && enviar.llamadas[0].args.model === 'gpt-6-luna' && (enviar.llamadas[0].args.response_format as { json_schema: { name: string; strict: boolean } }).json_schema.strict === true)

    const adaptado = S2.replace('Quedo a tu disposición.', 'Ayer intenté llamarte sin suerte.')
    const ada = await revisarConIa(MENSAJES, S2, { cliente: falso([{ decision: 'adaptar', motivo: 'Se intentó llamar.', texto: adaptado }]).cliente })
    ok('«adaptar» con un texto bueno se respeta', ada.revision?.decision === 'adaptar' && ada.revision.texto === adaptado)

    const conDinero = await revisarConIa(MENSAJES, S2, { cliente: falso([{ decision: 'adaptar', motivo: 'Mejor así.', texto: 'Hola, vemos que facturáis más de 100.000 € al año y podemos ayudaros a crecer mucho más con una videollamada. Un saludo,' }]).cliente })
    ok('«adaptar» con dinero se convierte en PAUSA, nunca en envío', conDinero.revision?.decision === 'pausar' && /dinero/.test(conDinero.revision.motivo))

    const pausa = await revisarConIa(MENSAJES, S2, { cliente: falso([{ decision: 'pausar', motivo: 'Pidió esperar hasta noviembre.', texto: '' }]).cliente })
    ok('«pausar»', pausa.revision?.decision === 'pausar' && pausa.revision.motivo.includes('noviembre'))

    const mal = await revisarConIa(MENSAJES, S2, { cliente: falso([{ raw: 'quizá' }]).cliente })
    ok('algo ilegible: no hay decisión (quien llama espera y reintenta)', mal.revision === null && /no se entiende/.test(mal.aviso ?? ''))
    const caida = await revisarConIa(MENSAJES, S2, { cliente: falso([Object.assign(new Error('x'), { status: 503 })]).cliente })
    ok('IA caída: no hay decisión', caida.revision === null && /problema/.test(caida.aviso ?? ''))
    const rechazo = await revisarConIa(MENSAJES, S2, { cliente: falso([{ refusal: 'no' }]).cliente })
    ok('si se niega: no hay decisión', rechazo.revision === null)
  }

  console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
