import OpenAI from 'openai'
import { motivoDelFallo, type ClienteDeCorreoIa } from '@/lib/correo/ia-generar'
import { parametrosDeIa } from '@/lib/ia/modelo'
import { ESQUEMA_DE_WHATSAPP, leerMensajeDeWhatsapp, mensajeDeCorreccionDeWhatsapp, type MensajeEscrito } from './ia-prompt'
import { AVISO_DE_PROBLEMA, revisarMensajeDeWhatsapp, type ProblemaDeWhatsapp } from './ia-revision'

/**
 * LA LLAMADA A LA IA PARA ESCRIBIR UN WHATSAPP A UN LEAD — SOLO SERVIDOR.
 * =======================================================================
 * Recibe el encargo ya construido (lib/whatsapp/ia-prompt.ts) y devuelve el mensaje o, si algo falla, el motivo dicho para una persona. Se comprueba
 * con ia-generar.prueba.ts, con un cliente falso: no llama a OpenAI de verdad.
 *
 * NO LANZA. Sin clave, con la IA caída, sin saldo, pasada de tiempo o con una respuesta ilegible devuelve `mensaje: null` y un `aviso` en español, y el
 * comercial sigue con los mensajes de siempre en el desplegable: escribir con IA es una ayuda, nunca un paso obligatorio (igual que «Redactar con IA» del
 * correo, lib/correo/ia-generar.ts, del que viene la forma de hacerlo).
 *
 * LO QUE DEVUELVE SE REVISA (`revisarMensajeDeWhatsapp`): si habla de dinero, deja un hueco, se pasa de largo, lleva un enlace o repite un WhatsApp ya
 * enviado a ese lead, se le pide UNA vez más que lo corrija. Si a la segunda sigue hablando de dinero NO se enseña (la regla que no admite excepciones);
 * lo demás sí se enseña, con un aviso, porque el comercial lo ve y lo edita antes de abrir WhatsApp.
 *
 * MODELO: `gpt-5.6-terra`, el mismo que «Redactar con IA» del correo, salvo que el servidor diga otro con WHATSAPP_IA_MODELO. No se mira IA_MODELO (el de
 * todo el ERP, `gpt-6-luna`): igual que en el correo, un mensaje del que depende una conversación con un cliente no es donde ahorrar. Cómo se pide un modelo
 * que razona (sin temperature, con max_completion_tokens y reasoning_effort) lo decide lib/ia/modelo.ts, igual que en las demás pantallas.
 *
 * Por qué ése (probado el 25 oct 2026 con 10 leads de situaciones distintas, el mismo encargo y los dos modelos, midiendo lo que cobra OpenAI): los dos resisten una
 * nota que da órdenes a la IA, ninguno habla de dinero y los 10 mensajes de cada uno salieron limpios a la primera. `gpt-5.6-terra` (2 $ por millón de tokens de
 * entrada, 0,20 en caché, 12 de salida) contesta en 1,9 s de media con mensajes de 38 palabras y más variados; `gpt-6-luna` (0,10 / 0,01 / 0,50) tarda 4,1 s (hasta
 * 7 s: gasta 166 tokens de media en pensar, terra ninguno), escribe 42 palabras y abre casi siempre igual («Hola, soy Raúl de Liberty Seller.»). Coste MEDIDO por
 * mensaje, con unos 2.500 tokens de entrada (unos 2.000 en caché si se ha usado hace poco; a la primera tras un rato sin usarlo no hay caché): terra 0,0024 $ con la
 * caché caliente y 0,0061 $ sin ella; luna 0,0002 $ y 0,0004 $. Unas 11 a 16 veces más barato luna. A 200 mensajes al día en 22 días (4.400 al mes): terra de 11 a
 * 27 $, luna de 1 a 2 $. Si se prefiere lo barato, WHATSAPP_IA_MODELO=gpt-6-luna.
 */

export const MODELO_DE_WHATSAPP_POR_DEFECTO = 'gpt-5.6-terra'
/** Un WhatsApp cabe en unos segundos; más que esto es que algo va mal y el comercial prefiere seguir con los mensajes de siempre */
export const TIEMPO_MAXIMO_DE_WHATSAPP_MS = 45_000

/** El entorno con el modelo de WhatsApp por delante, para que `parametrosDeIa` lo recoja */
function entornoDeWhatsapp(): Record<string, string | undefined> {
  return { ...process.env, IA_MODELO: process.env.WHATSAPP_IA_MODELO?.trim() || MODELO_DE_WHATSAPP_POR_DEFECTO }
}

export const modeloDeWhatsapp = (): string => entornoDeWhatsapp().IA_MODELO?.trim() || MODELO_DE_WHATSAPP_POR_DEFECTO

export interface ResultadoDeWhatsappConIa {
  /** El mensaje escrito. null = no hay (el aviso dice por qué) */
  mensaje: MensajeEscrito | null
  modelo: string
  /** Por qué no hay mensaje, o una advertencia sobre él. null = todo bien */
  aviso: string | null
  /** Los problemas que seguían en el mensaje devuelto (vacío = limpio) */
  problemas: ProblemaDeWhatsapp[]
  tokens: { entrada: number; salida: number } | null
  /** Cuántas veces se ha llamado a la IA (2 si hubo que pedir una corrección) */
  llamadas: number
}

export interface OpcionesDeWhatsappIa {
  tiempoMaximoMs?: number
  /** Para las pruebas */
  cliente?: ClienteDeCorreoIa
  /** Para las pruebas: el entorno del que se saca el modelo */
  entorno?: Record<string, string | undefined>
}

/** El orden en que se le cuenta a la persona qué le pasa al mensaje cuando se le enseña igualmente */
const ORDEN_DE_AVISOS: readonly ProblemaDeWhatsapp[] = ['hueco', 'repite', 'enlace', 'largo', 'corto']

export async function escribirWhatsappConIa(mensajes: { system: string; usuario: string }, anteriores: readonly string[], opciones: OpcionesDeWhatsappIa = {}): Promise<ResultadoDeWhatsappConIa> {
  const entorno = opciones.entorno ?? entornoDeWhatsapp()
  const modelo = entorno.IA_MODELO?.trim() || MODELO_DE_WHATSAPP_POR_DEFECTO
  // Lo gastado se suma en un objeto: una variable que se reasigna dentro del bucle y se lee en una función hace que TypeScript la dé por `null`
  const gasto = { entrada: 0, salida: 0, hubo: false, llamadas: 0 }
  const tokensGastados = (): ResultadoDeWhatsappConIa['tokens'] => (gasto.hubo ? { entrada: gasto.entrada, salida: gasto.salida } : null)
  const sin = (aviso: string, problemas: ProblemaDeWhatsapp[] = []): ResultadoDeWhatsappConIa => ({ mensaje: null, modelo, aviso, problemas, tokens: tokensGastados(), llamadas: gasto.llamadas })

  let cliente = opciones.cliente
  if (!cliente) {
    const clave = process.env.OPENAI_API_KEY?.trim()
    if (!clave) return sin('La IA no está configurada en el servidor (falta OPENAI_API_KEY).')
    cliente = new OpenAI({ apiKey: clave, maxRetries: 1 }) as unknown as ClienteDeCorreoIa
  }

  const control = new AbortController()
  const temporizador = setTimeout(() => control.abort(), opciones.tiempoMaximoMs ?? TIEMPO_MAXIMO_DE_WHATSAPP_MS)
  try {
    const conversacion: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: mensajes.system },
      { role: 'user', content: mensajes.usuario },
    ]

    let ultimo: MensajeEscrito | null = null
    let problemas: ProblemaDeWhatsapp[] = []
    // Dos vueltas como mucho: la primera, y una de corrección si lo devuelto no vale
    for (let vuelta = 0; vuelta < 2; vuelta++) {
      gasto.llamadas++
      const completion = await cliente.chat.completions.create(
        {
          // Lo que razona no se ve pero cuenta para el tope: sitio de sobra para el razonamiento y para un mensaje de 60 palabras
          ...parametrosDeIa({ esfuerzo: 'low', maxSalida: 6000 }, entorno),
          response_format: { type: 'json_schema', json_schema: { name: 'whatsapp_para_un_lead', strict: true, schema: ESQUEMA_DE_WHATSAPP } },
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
      if (eleccion?.message?.refusal) return sin('La IA se ha negado a escribir este mensaje.')
      const leido = leerMensajeDeWhatsapp(eleccion?.message?.content)
      if (!leido) {
        return sin(eleccion?.finish_reason === 'length' ? 'La respuesta de la IA se ha cortado. Vuelve a probar.' : 'La IA ha devuelto algo que no se entiende. Vuelve a probar.')
      }

      ultimo = leido
      problemas = revisarMensajeDeWhatsapp(leido.mensaje, anteriores)
      if (problemas.length === 0) break
      if (vuelta === 0) {
        conversacion.push({ role: 'assistant', content: JSON.stringify({ mensaje: leido.mensaje, base: leido.base }) }, { role: 'user', content: mensajeDeCorreccionDeWhatsapp(problemas) })
      }
    }

    if (!ultimo) return sin('La IA no ha devuelto nada.')
    // Hablar de dinero NO se enseña, ni siquiera a un comercial que lo vaya a editar: es la única regla que no admite excepciones
    if (problemas.includes('dinero')) return sin('La IA ha mencionado cifras de dinero y se ha descartado. Vuelve a probar.', problemas)
    const aviso = ORDEN_DE_AVISOS.find((p) => problemas.includes(p))
    return { mensaje: ultimo, modelo, aviso: aviso ? AVISO_DE_PROBLEMA[aviso] : null, problemas, tokens: tokensGastados(), llamadas: gasto.llamadas }
  } catch (error) {
    // Del error solo se apunta el estado y el código: el cuerpo puede traer parte del encargo (datos de un lead)
    const e = error as { status?: number; code?: string; name?: string }
    console.error('[whatsapp-ia] fallo al escribir', { estado: e?.status ?? null, codigo: e?.code ?? null, nombre: e?.name ?? null })
    return sin(motivoDelFallo(error))
  } finally {
    clearTimeout(temporizador)
  }
}
