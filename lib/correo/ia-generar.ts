import OpenAI from 'openai'
import { ESQUEMA_BORRADOR, leerBorrador, mensajeDeCorreccion, revisarBorrador, type Borrador, type ProblemaDeBorrador } from './ia-prompt'

/**
 * LA LLAMADA A LA IA PARA REDACTAR UN CORREO A UN LEAD.
 * =====================================================
 * SOLO SERVIDOR. Recibe el encargo ya construido (lib/correo/ia-prompt.ts) y devuelve el borrador o, si algo falla, el motivo dicho para
 * una persona. Se comprueba con ia-generar.prueba.ts, con un cliente falso: no llama a OpenAI de verdad.
 *
 * NO LANZA. Sin clave, con la IA caída, sin saldo, pasada de tiempo o con una respuesta ilegible devuelve `borrador: null` y un `aviso` en
 * español, y el comercial sigue con el cuadro de correo en blanco como antes: redactar con IA es una ayuda, nunca un paso obligatorio.
 *
 * LO QUE DEVUELVE SE REVISA (`revisarBorrador`): si habla de dinero, deja un hueco por rellenar o se pasa de largo, se le pide UNA vez
 * más que lo corrija. Si a la segunda sigue hablando de dinero NO se enseña (la regla que más importa es que no diga nada de facturación)
 * y el aviso lo explica. Un hueco o un exceso de largo en la segunda vez sí se enseña: el comercial lo ve y lo edita.
 *
 * MODELO: `gpt-5.6-terra`, de los que razonan (la clave OPENAI_API_KEY del servidor ya sirve: nada nuevo que dar de alta). Se cambia sin
 * tocar código con CORREO_IA_MODELO y CORREO_IA_ESFUERZO (low, medium, high).
 *
 * Por qué ése (probado el 23 oct 2026 con los mismos leads reales y el mismo encargo, precios de rastreadores de terceros):
 *
 *   gpt-5.5          0,022 $ por correo   el mejor, y el que se usó al principio
 *   gpt-5.6-terra    0,009 $              casi igual de bueno: 2,6 veces más barato
 *   gpt-5.6-luna     0,001 $              también bueno, 20 veces más barato; algo más genérico
 *   gpt-5.4-mini     0,004 $              más jerga y más largo
 *   gpt-5-mini       0,002 $              frases confusas y cuenta el tramo exacto del catálogo
 *   gpt-5.4-nano     0,001 $              suelta jerga interna («cita cualificada») al cliente
 *
 * En 12 leads al azar ni 5.5, ni terra ni luna se inventaron un correo ni una conversación previos, ni hablaron de dinero. Entre terra y
 * luna se eligió terra: ahorrar los ~25 $ al mes que separan a luna de terra (con 150 correos al día: 28 $ frente a 3 $) no compensa ningún matiz de redacción
 * en un correo del que depende una cita. Si se quiere lo más barato posible, luna es la segunda opción.
 */

export const MODELO_DE_CORREO_POR_DEFECTO = 'gpt-5.6-terra'
/** Un correo cabe en menos de un minuto incluso razonando; más que esto es que algo va mal y el comercial prefiere seguir a mano */
export const TIEMPO_MAXIMO_DEL_CORREO_MS = 75_000

/** ¿Es un modelo de los que razonan? Se piden de otra manera: sin `temperature` y con `reasoning_effort` */
const razona = (modelo: string): boolean => /^(gpt-[5-9]|gpt-\d{2}|o\d)/.test(modelo)

export interface ClienteDeCorreoIa {
  chat: {
    completions: {
      create: (
        args: Record<string, unknown>,
        opciones?: { signal?: AbortSignal }
      ) => Promise<{
        choices?: Array<{ finish_reason?: string | null; message?: { content?: string | null; refusal?: string | null } }>
        usage?: { prompt_tokens?: number; completion_tokens?: number }
      }>
    }
  }
}

export interface ResultadoDelBorrador {
  borrador: Borrador | null
  modelo: string
  /** Por qué no hay borrador, o una advertencia sobre él. null = todo bien */
  aviso: string | null
  /** Los problemas que seguían en el borrador devuelto (vacío = limpio) */
  problemas: ProblemaDeBorrador[]
  tokens: { entrada: number; salida: number } | null
  /** Cuántas veces se ha llamado a la IA (2 si hubo que pedirle una corrección) */
  llamadas: number
}

export interface OpcionesDelBorrador {
  modelo?: string
  tiempoMaximoMs?: number
  /** Para las pruebas */
  cliente?: ClienteDeCorreoIa
}

/** Un error de la API, reducido a lo que se le puede contar a quien usa la pantalla */
export function motivoDelFallo(error: unknown): string {
  const e = error as { status?: number; name?: string; code?: string; message?: string }
  if (e?.name === 'AbortError' || e?.name === 'APIConnectionTimeoutError' || /timed? ?out|timeout/i.test(e?.message ?? '')) return 'La IA ha tardado demasiado en contestar. Vuelve a probar.'
  if (e?.status === 401) return 'La clave de la IA no es válida: hay que revisar OPENAI_API_KEY en el servidor.'
  if (e?.status === 402 || e?.code === 'insufficient_quota') return 'La cuenta de la IA se ha quedado sin saldo.'
  if (e?.status === 429) return 'La IA está saturada o ha llegado a su límite: prueba dentro de un minuto.'
  if (typeof e?.status === 'number' && e.status >= 500) return 'La IA tiene un problema ahora mismo. Vuelve a probar en un momento.'
  return 'No se ha podido hablar con la IA.'
}

export async function redactarConIa(mensajes: { system: string; usuario: string }, opciones: OpcionesDelBorrador = {}): Promise<ResultadoDelBorrador> {
  const modelo = opciones.modelo ?? (process.env.CORREO_IA_MODELO?.trim() || MODELO_DE_CORREO_POR_DEFECTO)
  const esfuerzo = process.env.CORREO_IA_ESFUERZO?.trim() || 'low'
  // Lo gastado se suma en un objeto: una variable que se reasigna dentro del bucle y se lee en una función hace que TypeScript la dé por `null`
  const gasto = { entrada: 0, salida: 0, hubo: false, llamadas: 0 }
  const tokensGastados = (): ResultadoDelBorrador['tokens'] => (gasto.hubo ? { entrada: gasto.entrada, salida: gasto.salida } : null)
  const sin = (aviso: string, problemas: ProblemaDeBorrador[] = []): ResultadoDelBorrador => ({ borrador: null, modelo, aviso, problemas, tokens: tokensGastados(), llamadas: gasto.llamadas })

  let cliente = opciones.cliente
  if (!cliente) {
    const clave = process.env.OPENAI_API_KEY?.trim()
    if (!clave) return sin('La IA no está configurada en el servidor (falta OPENAI_API_KEY).')
    cliente = new OpenAI({ apiKey: clave, maxRetries: 1 }) as unknown as ClienteDeCorreoIa
  }

  const control = new AbortController()
  const temporizador = setTimeout(() => control.abort(), opciones.tiempoMaximoMs ?? TIEMPO_MAXIMO_DEL_CORREO_MS)
  try {
    const conversacion: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: mensajes.system },
      { role: 'user', content: mensajes.usuario },
    ]

    let ultimo: Borrador | null = null
    let problemas: ProblemaDeBorrador[] = []
    // Dos vueltas como mucho: la primera, y una de corrección si lo devuelto no vale
    for (let vuelta = 0; vuelta < 2; vuelta++) {
      gasto.llamadas++
      const completion = await cliente.chat.completions.create(
        {
          model: modelo,
          // Lo que razona no se ve pero cuenta para el tope: sitio de sobra para el razonamiento y para un correo de 200 palabras
          max_completion_tokens: 12000,
          ...(razona(modelo) ? { reasoning_effort: esfuerzo } : { temperature: 0.7 }),
          response_format: { type: 'json_schema', json_schema: { name: 'correo_para_un_lead', strict: true, schema: ESQUEMA_BORRADOR } },
          messages: conversacion,
        },
        { signal: control.signal }
      )
      if (completion.usage) {
        gasto.hubo = true
        gasto.entrada += completion.usage.prompt_tokens ?? 0
        gasto.salida += completion.usage.completion_tokens ?? 0
      }
      const eleccion = completion.choices?.[0]
      if (eleccion?.message?.refusal) return sin('La IA se ha negado a redactar este correo.')
      const borrador = leerBorrador(eleccion?.message?.content)
      if (!borrador) {
        return sin(eleccion?.finish_reason === 'length' ? 'La respuesta de la IA se ha cortado. Vuelve a probar.' : 'La IA ha devuelto algo que no se entiende. Vuelve a probar.')
      }

      ultimo = borrador
      problemas = revisarBorrador(borrador)
      if (problemas.length === 0) break
      if (vuelta === 0) {
        conversacion.push({ role: 'assistant', content: JSON.stringify(borrador) }, { role: 'user', content: mensajeDeCorreccion(problemas) })
      }
    }

    if (!ultimo) return sin('La IA no ha devuelto nada.')
    // Hablar de dinero NO se enseña, ni siquiera a un comercial que lo vaya a editar: es la única regla que no admite excepciones
    if (problemas.includes('dinero')) return sin('La IA ha mencionado cifras de dinero y se ha descartado. Vuelve a probar.', problemas)
    return {
      borrador: ultimo,
      modelo,
      aviso: problemas.includes('hueco') ? 'El borrador deja algún hueco por rellenar: revísalo antes de enviar.' : problemas.includes('largo') ? 'El borrador ha salido largo: conviene acortarlo.' : null,
      problemas,
      tokens: tokensGastados(),
      llamadas: gasto.llamadas,
    }
  } catch (error) {
    // Del error solo se apunta el estado y el código: el cuerpo puede traer parte del encargo (datos de un lead)
    const e = error as { status?: number; code?: string; name?: string }
    console.error('[correo-ia] fallo al redactar', { estado: e?.status ?? null, codigo: e?.code ?? null, nombre: e?.name ?? null })
    return sin(motivoDelFallo(error))
  } finally {
    clearTimeout(temporizador)
  }
}
