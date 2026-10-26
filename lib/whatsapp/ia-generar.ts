import OpenAI from 'openai'
import { motivoDelFallo, type ClienteDeCorreoIa } from '@/lib/correo/ia-generar'
import { parametrosDeIa } from '@/lib/ia/modelo'
import { PALABRAS_POR_LONGITUD, type PerfilDeWhatsapp } from './ia-perfil'
import { esquemaDeWhatsapp, leerMensajeDeWhatsapp, mensajeDeCorreccionDeWhatsapp, type MensajeEscrito } from './ia-prompt'
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
 * MODELO: `gpt-6-luna` SIN razonar (esfuerzo `none`), salvo que el servidor diga otro con WHATSAPP_IA_MODELO (solo para esto) o con IA_ESFUERZO (para todo el ERP).
 * No se mira IA_MODELO (el de todo el ERP). Cómo se pide un modelo que razona (sin temperature, con max_completion_tokens y reasoning_effort) lo decide
 * lib/ia/modelo.ts, igual que en las demás pantallas.
 *
 * Por qué ése (medido el 25 y el 26 oct 2026 con 10 leads de situaciones distintas y el mismo encargo, con los tokens reales y los precios de la página
 * oficial de OpenAI; por mensaje, con unos 2.500 tokens de entrada, de los que unos 1.800-2.000 van en caché si se ha usado hace poco y ninguno a la primera tras
 * un rato sin usarlo):
 *
 *                        tiempo    palabras   caché caliente / fría
 *   gpt-6-luna · none     2,1 s       46       0,00014 $ / 0,00030 $     ← el de ahora
 *   gpt-6-luna · low      4,0 s       44       0,00023 $ / 0,00040 $     (piensa ~200 tokens antes de escribir)
 *   gpt-5.6-terra · low   1,8 s       38       0,0024 $  / 0,0061 $      (2 $ de entrada y 12 de salida por millón: 10 a 20 veces más)
 *
 * Los tres escribieron 10 de 10 mensajes limpios a la primera, sin hablar de dinero y sin dejarse engañar por una nota que daba órdenes. `terra` varía más las
 * aperturas y suena algo más natural; `luna` sin razonar es casi igual de bueno por una décima parte del precio y en el doble de tiempo que con `low`. A 200
 * mensajes al día en 22 días (4.400 al mes): luna·none 1 a 1,5 $, terra 11 a 27 $. Si se prefiere lo más natural, WHATSAPP_IA_MODELO=gpt-5.6-terra. */

export const MODELO_DE_WHATSAPP_POR_DEFECTO = 'gpt-6-luna'
/** Escribir 40 palabras con unos datos delante no necesita pensar: sin razonar tarda la mitad y cuesta menos, con la misma calidad (medido, ver arriba) */
export const ESFUERZO_DE_WHATSAPP_POR_DEFECTO = 'none'
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
  /** Lo gastado: tokens de entrada (todos), de ellos cuántos iban en caché, y de salida. null = no consta (no se llegó a llamar) */
  tokens: { entrada: number; salida: number; cache: number } | null
  /** Cuántas veces se ha llamado a la IA (2 si hubo que pedir una corrección) */
  llamadas: number
}

export interface OpcionesDeWhatsappIa {
  /**
   * El perfil con el que se escribe (ia-perfil.ts). De él salen el modelo y el razonamiento (si los fija), la longitud que se pide y el tope de palabras que se
   * revisa. Sin perfil, lo de serie
   */
  perfil?: Pick<PerfilDeWhatsapp, 'modelo' | 'esfuerzo' | 'ajustes'>
  tiempoMaximoMs?: number
  /** Para las pruebas */
  cliente?: ClienteDeCorreoIa
  /** Para las pruebas: el entorno del que se saca el modelo */
  entorno?: Record<string, string | undefined>
}

/** El orden en que se le cuenta a la persona qué le pasa al mensaje cuando se le enseña igualmente */
const ORDEN_DE_AVISOS: readonly ProblemaDeWhatsapp[] = ['hueco', 'repite', 'enlace', 'largo', 'corto']

export async function escribirWhatsappConIa(mensajes: { system: string; usuario: string }, anteriores: readonly string[], opciones: OpcionesDeWhatsappIa = {}): Promise<ResultadoDeWhatsappConIa> {
  const perfil = opciones.perfil
  // El modelo: el del perfil si fija uno; si no, WHATSAPP_IA_MODELO del servidor; si no, el de siempre
  const entorno = { ...(opciones.entorno ?? entornoDeWhatsapp()), ...(perfil?.modelo ? { IA_MODELO: perfil.modelo } : {}) }
  const modelo = entorno.IA_MODELO?.trim() || MODELO_DE_WHATSAPP_POR_DEFECTO
  const longitud = perfil?.ajustes.longitud ?? 'corto'
  const palabras = PALABRAS_POR_LONGITUD[longitud]
  // Lo gastado se suma en un objeto: una variable que se reasigna dentro del bucle y se lee en una función hace que TypeScript la dé por `null`
  const gasto = { entrada: 0, salida: 0, cache: 0, hubo: false, llamadas: 0 }
  const tokensGastados = (): ResultadoDeWhatsappConIa['tokens'] => (gasto.hubo ? { entrada: gasto.entrada, salida: gasto.salida, cache: gasto.cache } : null)
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
          ...parametrosDeIa({ esfuerzo: perfil?.esfuerzo ?? ESFUERZO_DE_WHATSAPP_POR_DEFECTO, maxSalida: 6000 }, entorno),
          response_format: { type: 'json_schema', json_schema: { name: 'whatsapp_para_un_lead', strict: true, schema: esquemaDeWhatsapp(longitud) } },
          messages: conversacion,
        },
        { signal: control.signal }
      )
      if (completion.usage) {
        gasto.hubo = true
        gasto.entrada += completion.usage.prompt_tokens ?? 0
        gasto.salida += completion.usage.completion_tokens ?? 0
        gasto.cache += completion.usage.prompt_tokens_details?.cached_tokens ?? 0
      }
      const eleccion = completion.choices?.[0]
      if (eleccion?.message?.refusal) return sin('La IA se ha negado a escribir este mensaje.')
      const leido = leerMensajeDeWhatsapp(eleccion?.message?.content)
      if (!leido) {
        return sin(eleccion?.finish_reason === 'length' ? 'La respuesta de la IA se ha cortado. Vuelve a probar.' : 'La IA ha devuelto algo que no se entiende. Vuelve a probar.')
      }

      ultimo = leido
      problemas = revisarMensajeDeWhatsapp(leido.mensaje, anteriores, { maxPalabras: palabras.limite })
      if (problemas.length === 0) break
      if (vuelta === 0) {
        conversacion.push({ role: 'assistant', content: JSON.stringify({ mensaje: leido.mensaje, base: leido.base }) }, { role: 'user', content: mensajeDeCorreccionDeWhatsapp(problemas, palabras.maximo) })
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
