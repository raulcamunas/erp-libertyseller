import { MODELO_IA_POR_DEFECTO, pedirPropuestaIa, razona, type ClienteIa } from '@/lib/fba/ia-reposicion'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * LA LLAMADA A LA IA, SIN LLAMAR A NINGUNA.
 *
 * Un cliente falso que contesta lo que se le diga permite comprobar lo que de verdad importa:
 * qué se pide (el modelo, el esquema estricto, sin `temperature` si razona) y, sobre todo, que
 * NUNCA lanza —sea cual sea el fallo— y que de un error solo sale una frase para una persona.
 */

const MENSAJES = { system: 'instrucciones', usuario: '{"contexto":{},"referencias":[]}' }
const BUENA = JSON.stringify({
  resumen: 'Mandar lo urgente.',
  estrategia: 'Cubrir 60 días.',
  lineas: [{ sku: 'A', unidades: 40, prioridad: 'alta', confianza: 'media', motivo: 'Se agota.' }],
  descartadas: [],
  riesgos: [],
  dudas: [],
})

type Respuesta = Awaited<ReturnType<ClienteIa['chat']['completions']['create']>>

/** Un cliente que apunta lo que le piden y contesta lo que se le dice */
function falso(contesta: Respuesta | ((args: Record<string, unknown>, signal?: AbortSignal) => Promise<Respuesta>)) {
  const peticiones: Array<Record<string, unknown>> = []
  const cliente: ClienteIa = {
    chat: {
      completions: {
        create: async (args, opciones) => {
          peticiones.push(args)
          return typeof contesta === 'function' ? contesta(args, opciones?.signal) : contesta
        },
      },
    },
  }
  return { cliente, peticiones }
}

const buenaRespuesta = (extra: Partial<Respuesta> = {}): Respuesta => ({
  model: 'gpt-5.5-2026-xx',
  choices: [{ finish_reason: 'stop', message: { content: BUENA } }],
  usage: { prompt_tokens: 15000, completion_tokens: 3000 },
  ...extra,
})

async function conEntorno<T>(vars: Record<string, string | undefined>, f: () => Promise<T>): Promise<T> {
  const antes: Record<string, string | undefined> = {}
  for (const k of Object.keys(vars)) {
    antes[k] = process.env[k]
    if (vars[k] === undefined) delete process.env[k]
    else process.env[k] = vars[k]
  }
  try {
    return await f()
  } finally {
    for (const k of Object.keys(vars)) {
      if (antes[k] === undefined) delete process.env[k]
      else process.env[k] = antes[k]
    }
  }
}

async function main() {
  console.log('\n=== qué modelos razonan ===')
  {
    ok('gpt-5.5, gpt-5, gpt-5.5-mini y o3 razonan', razona('gpt-5.5') && razona('gpt-5') && razona('gpt-5.5-mini') && razona('o3') && razona('o1'))
    ok('gpt-4o y gpt-4.1 no', !razona('gpt-4o') && !razona('gpt-4.1') && !razona('gpt-4o-mini'))
    ok('un nombre cualquiera tampoco', !razona('omni') && !razona('claude'))
    ok('el de siempre es gpt-5.5', MODELO_IA_POR_DEFECTO === 'gpt-5.5')
  }

  console.log('\n=== lo que se pide ===')
  await conEntorno({ FBA_IA_MODELO: undefined, FBA_IA_ESFUERZO: undefined }, async () => {
    const { cliente, peticiones } = falso(buenaRespuesta())
    const r = await pedirPropuestaIa(MENSAJES, { cliente })
    const p = peticiones[0]
    ok('una sola llamada', peticiones.length === 1)
    ok('con el modelo de siempre', p.model === 'gpt-5.5')
    ok('un modelo que razona NO lleva temperature (la API contesta 400 si la lleva)', !('temperature' in p))
    ok('y lleva el esfuerzo de razonamiento «low»', p.reasoning_effort === 'low')
    const f = p.response_format as { type: string; json_schema: { name: string; strict: boolean; schema: { required: string[] } } }
    ok('exige un esquema JSON estricto', f.type === 'json_schema' && f.json_schema.strict === true && f.json_schema.schema.required.includes('lineas'))
    ok('deja sitio al razonamiento en el tope de tokens', (p.max_completion_tokens as number) >= 20000)
    const msgs = p.messages as Array<{ role: string; content: string }>
    ok('manda las instrucciones y los datos, en ese orden', msgs.length === 2 && msgs[0].role === 'system' && msgs[0].content === 'instrucciones' && msgs[1].role === 'user' && msgs[1].content === MENSAJES.usuario)
    ok('devuelve la respuesta leída', r.respuesta?.lineas[0].sku === 'A' && r.respuesta.lineas[0].unidades === 40)
    ok('sin aviso cuando todo va bien', r.aviso === null)
    ok('el modelo que ha contestado, que puede ser una versión fechada', r.modelo === 'gpt-5.5-2026-xx')
    ok('y los tokens, para saber lo que cuesta', r.tokens?.entrada === 15000 && r.tokens.salida === 3000, JSON.stringify(r.tokens))
  })

  await conEntorno({ FBA_IA_MODELO: 'gpt-4o', FBA_IA_ESFUERZO: 'high' }, async () => {
    const { cliente, peticiones } = falso(buenaRespuesta())
    await pedirPropuestaIa(MENSAJES, { cliente })
    const p = peticiones[0]
    ok('FBA_IA_MODELO cambia el modelo sin tocar código', p.model === 'gpt-4o')
    ok('uno de los de siempre se pide con temperatura baja', p.temperature === 0.2)
    ok('y sin esfuerzo de razonamiento, que no lo entiende', !('reasoning_effort' in p))
  })

  await conEntorno({ FBA_IA_MODELO: '  gpt-5.5-mini  ', FBA_IA_ESFUERZO: ' medium ' }, async () => {
    const { cliente, peticiones } = falso(buenaRespuesta())
    await pedirPropuestaIa(MENSAJES, { cliente })
    ok('las variables se leen sin los espacios', peticiones[0].model === 'gpt-5.5-mini' && peticiones[0].reasoning_effort === 'medium')
  })

  await conEntorno({ FBA_IA_MODELO: 'gpt-5.5', FBA_IA_ESFUERZO: undefined }, async () => {
    const { cliente, peticiones } = falso(buenaRespuesta())
    await pedirPropuestaIa(MENSAJES, { cliente, modelo: 'o3' })
    ok('el modelo que se pasa a la función gana a la variable', peticiones[0].model === 'o3')
  })

  console.log('\n=== cuando la IA no da lo que se esperaba: nunca lanza ===')
  await conEntorno({ FBA_IA_MODELO: undefined, FBA_IA_ESFUERZO: undefined }, async () => {
    const sinRespuesta = async (nombre: string, contesta: Parameters<typeof falso>[0], esperado: RegExp, opciones: { tiempoMaximoMs?: number } = {}) => {
      const { cliente } = falso(contesta)
      let r: Awaited<ReturnType<typeof pedirPropuestaIa>> | null = null
      let lanzo = false
      try {
        r = await pedirPropuestaIa(MENSAJES, { cliente, ...opciones })
      } catch {
        lanzo = true
      }
      ok(`${nombre}: no lanza`, !lanzo)
      ok(`${nombre}: sin respuesta y con el motivo dicho para una persona`, !!r && r.respuesta === null && !!r.aviso && esperado.test(r.aviso), r?.aviso ?? 'sin resultado')
      return r
    }

    const err = (props: Record<string, unknown>, message = 'fallo') => () => Promise.reject(Object.assign(new Error(message), props))

    await sinRespuesta('se niega', { choices: [{ finish_reason: 'stop', message: { content: null, refusal: 'No puedo ayudar con eso' } }] }, /negado/)
    await sinRespuesta('contesta algo que no es JSON', { choices: [{ finish_reason: 'stop', message: { content: 'Aquí tienes la propuesta…' } }] }, /no se entiende/)
    await sinRespuesta('contesta vacío', { choices: [{ finish_reason: 'stop', message: { content: '' } }] }, /no se entiende/)
    await sinRespuesta('no trae opciones', { choices: [] }, /no se entiende/)
    await sinRespuesta('se corta por longitud', { choices: [{ finish_reason: 'length', message: { content: BUENA.slice(0, 80) } }] }, /demasiado larga/)
    await sinRespuesta('clave no válida (401)', err({ status: 401 }), /OPENAI_API_KEY/)
    await sinRespuesta('sin saldo (402)', err({ status: 402 }), /sin saldo/)
    await sinRespuesta('sin saldo (insufficient_quota)', err({ status: 429, code: 'insufficient_quota' }), /429|saturada|saldo/)
    await sinRespuesta('saturada (429)', err({ status: 429 }), /saturada/)
    await sinRespuesta('se cae (500)', err({ status: 503 }), /problema/)
    await sinRespuesta('error de red', err({}, 'ECONNRESET'), /No se ha podido hablar/)
    await sinRespuesta('error con «timeout» en el mensaje', err({}, 'Request timed out.'), /tardado demasiado/)
    await sinRespuesta('se cancela', err({ name: 'AbortError' }), /tardado demasiado/)
    await sinRespuesta('no contesta a tiempo', (_a, signal) => new Promise((_, rechaza) => signal?.addEventListener('abort', () => rechaza(Object.assign(new Error('Aborted'), { name: 'AbortError' })))), /tardado demasiado/, { tiempoMaximoMs: 30 })

    // La clave y el cuerpo de la petición no se cuentan a nadie
    const filtrado = await sinRespuesta('error con un secreto dentro', err({ status: 400 }, 'Bad request: Incorrect API key provided: sk-proj-SECRETO123'), /No se ha podido hablar/)
    ok('el secreto del error no sale en el aviso', !!filtrado && !filtrado.aviso!.includes('SECRETO') && !filtrado.aviso!.includes('sk-'))

    const conTokens = await sinRespuesta('se niega pero cuesta tokens', { choices: [{ message: { refusal: 'no' } }], usage: { prompt_tokens: 100, completion_tokens: 5 } }, /negado/)
    ok('aunque falle, se cuentan los tokens gastados', conTokens?.tokens?.entrada === 100 && conTokens.tokens.salida === 5)

    // Una respuesta sin «usage» ni «model»: se sigue adelante
    const { cliente } = falso({ choices: [{ finish_reason: 'stop', message: { content: BUENA } }] })
    const r = await pedirPropuestaIa(MENSAJES, { cliente })
    ok('sin «model» en la respuesta se usa el pedido; sin «usage», sin tokens', r.respuesta !== null && r.modelo === 'gpt-5.5' && r.tokens === null)
  })

  console.log('\n=== sin clave ===')
  await conEntorno({ OPENAI_API_KEY: undefined }, async () => {
    const r = await pedirPropuestaIa(MENSAJES)
    ok('sin OPENAI_API_KEY no hay respuesta y el aviso lo dice', r.respuesta === null && /falta OPENAI_API_KEY/.test(r.aviso ?? ''), r.aviso ?? '')
    ok('y no lanza', true)
  })
  await conEntorno({ OPENAI_API_KEY: '   ' }, async () => {
    const r = await pedirPropuestaIa(MENSAJES)
    ok('una clave en blanco es como no tenerla', r.respuesta === null && /falta OPENAI_API_KEY/.test(r.aviso ?? ''))
  })

  console.log(fallos === 0 ? '\nTODO BIEN\n' : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
