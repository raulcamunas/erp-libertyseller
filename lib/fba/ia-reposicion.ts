import OpenAI from 'openai'
import { ESQUEMA_RESPUESTA, leerRespuesta } from './ia-prompt'
import type { RespuestaIa } from './reposicion'

/**
 * LA LLAMADA A LA IA PARA UNA PROPUESTA DE REPOSICIÓN.
 * ====================================================
 * SOLO SERVIDOR. Recibe el mensaje ya construido (lib/fba/ia-prompt.ts) y devuelve la
 * respuesta leída o, si algo falla, el motivo dicho para una persona.
 *
 *
 * ============ NUNCA TUMBA LA PROPUESTA ============
 *
 * Esta función no lanza. Sin clave, con la IA caída, sin saldo, pasada de tiempo o con una
 * respuesta ilegible devuelve `respuesta: null` y un `aviso` en español, y quien la llama
 * sigue con el cálculo base (lib/fba/reposicion.ts). Una propuesta que depende de que un
 * servicio externo conteste es una apuesta; con esta salida es una herramienta que, en el
 * peor día, avisa de que hoy no ha tenido segunda opinión.
 *
 *
 * ============ QUÉ IA Y POR QUÉ ESA ============
 *
 * La misma que ya usan el auditor, el generador de fichas y los informes de marketing:
 * OpenAI, con la clave `OPENAI_API_KEY` que el servidor ya tiene. No hay que dar de alta
 * nada nuevo para que esto funcione.
 *
 * El modelo es `gpt-5.5`, de los que razonan, y no el ligero que usan esas otras pantallas (lib/ia/modelo.ts: hoy
 * `gpt-6-luna`; entonces `gpt-4o`, y la medición de aquí es con él).
 * Medido con el inventario real de ShoesF, `gpt-4o` se limitaba a repetir los números del
 * mensaje: comentó 32 de 72 referencias, con motivos del tipo «agotado, vende 0,25 al día»,
 * no cambió ni una cantidad y su resumen no decía nada. Una propuesta con IA que no piensa no
 * es una propuesta con IA. El modelo y el esfuerzo de razonamiento se pueden cambiar sin
 * tocar código con las variables `FBA_IA_MODELO` y `FBA_IA_ESFUERZO` (low, medium, high).
 *
 * La respuesta se exige con un esquema JSON estricto. Lo que vuelve NO se da por bueno: lo
 * comprueba reposicion.ts (referencias que existan, topes por referencia).
 *
 * Los datos que salen hacia la IA son de UN cliente —referencia, stock, ventas, devoluciones—
 * y ninguno personal: no hay compradores, ni direcciones, ni nada de los pedidos, solo
 * unidades por SKU.
 */

export const MODELO_IA_POR_DEFECTO = 'gpt-5.5'
/** Un modelo que razona tarda más que uno de los de siempre: hasta dos minutos antes de rendirse */
export const TIEMPO_MAXIMO_MS = 120_000

/**
 * ¿Es un modelo de los que razonan (la serie gpt-5 y posteriores, la o1/o3)?
 *
 * Se piden de otra manera: NO admiten `temperature` —la API contesta 400 si se manda— y en
 * cambio tienen `reasoning_effort`, cuánto piensan antes de contestar. Los de siempre (gpt-4o,
 * gpt-4.1) se piden con temperatura baja y sin razonamiento.
 */
export const razona = (modelo: string): boolean => /^(gpt-[5-9]|gpt-\d{2}|o\d)/.test(modelo)

/** Lo mínimo del cliente de OpenAI que se usa. Existe para poder probar sin llamar de verdad */
export interface ClienteIa {
  chat: {
    completions: {
      create: (args: Record<string, unknown>, opciones?: { signal?: AbortSignal }) => Promise<{
        model?: string
        choices?: Array<{ finish_reason?: string | null; message?: { content?: string | null; refusal?: string | null } }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }>
    }
  }
}

export interface ResultadoIa {
  respuesta: RespuestaIa | null
  modelo: string
  /** Por qué no hay respuesta, o una advertencia sobre ella. null = todo bien */
  aviso: string | null
  tokens: { entrada: number; salida: number } | null
}

export interface OpcionesLlamada {
  modelo?: string
  tiempoMaximoMs?: number
  /** Para las pruebas */
  cliente?: ClienteIa
}

/** Un error de la API, reducido a lo que se le puede contar a quien usa la pantalla */
function motivoDe(error: unknown): string {
  const e = error as { status?: number; name?: string; code?: string; message?: string }
  if (e?.name === 'AbortError' || e?.name === 'APIConnectionTimeoutError' || /timed? ?out|timeout/i.test(e?.message ?? '')) {
    return 'La IA ha tardado demasiado en contestar.'
  }
  if (e?.status === 401) return 'La clave de la IA no es válida: hay que revisar OPENAI_API_KEY en el servidor.'
  if (e?.status === 402 || e?.code === 'insufficient_quota') return 'La cuenta de la IA se ha quedado sin saldo.'
  if (e?.status === 429) return 'La IA está saturada o ha llegado a su límite: prueba dentro de un minuto.'
  if (typeof e?.status === 'number' && e.status >= 500) return 'La IA tiene un problema ahora mismo.'
  return 'No se ha podido hablar con la IA.'
}

export async function pedirPropuestaIa(mensajes: { system: string; usuario: string }, opciones: OpcionesLlamada = {}): Promise<ResultadoIa> {
  const modelo = opciones.modelo ?? (process.env.FBA_IA_MODELO?.trim() || MODELO_IA_POR_DEFECTO)
  // Cuánto piensa antes de contestar. «low» tarda 40 s con 72 referencias y razona bien; «medium»
  // tarda 70 s por una propuesta algo más prudente. Se puede subir sin tocar código.
  const esfuerzo = process.env.FBA_IA_ESFUERZO?.trim() || 'low'
  const sinRespuesta = (aviso: string, tokens: ResultadoIa['tokens'] = null): ResultadoIa => ({ respuesta: null, modelo, aviso, tokens })

  let cliente = opciones.cliente
  if (!cliente) {
    const clave = process.env.OPENAI_API_KEY?.trim()
    if (!clave) return sinRespuesta('La IA no está configurada en el servidor (falta OPENAI_API_KEY).')
    // El SDK reintenta él solo una vez los fallos de red y los 429/5xx
    cliente = new OpenAI({ apiKey: clave, maxRetries: 1 }) as unknown as ClienteIa
  }

  const control = new AbortController()
  const temporizador = setTimeout(() => control.abort(), opciones.tiempoMaximoMs ?? TIEMPO_MAXIMO_MS)
  try {
    const completion = await cliente.chat.completions.create(
      {
        model: modelo,
        // Lo que razona no se ve pero cuenta para el tope de tokens: hay que dejar sitio para las dos cosas
        max_completion_tokens: 40000,
        ...(razona(modelo) ? { reasoning_effort: esfuerzo } : { temperature: 0.2 }),
        response_format: { type: 'json_schema', json_schema: { name: 'propuesta_de_reposicion', strict: true, schema: ESQUEMA_RESPUESTA } },
        messages: [
          { role: 'system', content: mensajes.system },
          { role: 'user', content: mensajes.usuario },
        ],
      },
      { signal: control.signal }
    )

    const tokens = completion.usage ? { entrada: completion.usage.prompt_tokens ?? 0, salida: completion.usage.completion_tokens ?? 0 } : null
    const eleccion = completion.choices?.[0]
    if (eleccion?.message?.refusal) return sinRespuesta('La IA se ha negado a contestar.', tokens)

    const respuesta = leerRespuesta(eleccion?.message?.content)
    if (!respuesta) {
      return sinRespuesta(
        eleccion?.finish_reason === 'length'
          ? 'La respuesta de la IA era demasiado larga y se ha cortado: prueba con menos referencias o un tope de unidades.'
          : 'La IA ha devuelto algo que no se entiende.',
        tokens
      )
    }
    return { respuesta, modelo: completion.model ?? modelo, aviso: null, tokens }
  } catch (error) {
    // Del error solo sale una frase: la clave y el cuerpo de la petición no se cuentan a nadie
    return sinRespuesta(motivoDe(error))
  } finally {
    clearTimeout(temporizador)
  }
}
