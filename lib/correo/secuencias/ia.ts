import OpenAI from 'openai'
import { MODELO_DE_IA_POR_DEFECTO, parametrosDeIa } from '../../ia/modelo'
import { motivoDelFallo, type ClienteDeCorreoIa } from '../ia-generar'
import { ESQUEMA_DE_CLASIFICACION, leerClasificacion, type Clasificacion } from './clasificar'
import {
  ESQUEMA_DE_REDACCION,
  ESQUEMA_REVISION,
  esquemaDeSeguimientos,
  leerRedaccion,
  leerRevision,
  leerSeguimientos,
  mensajeDeCorreccionDeRedaccion,
  mensajeDeCorreccionDeSeguimientos,
  revisarSeguimientos,
  validarRedaccion,
  validarRevision,
  type ProblemaDeSeguimiento,
  type Redaccion,
  type Revision,
} from './seguimientos'

/**
 * LAS TRES LLAMADAS A LA IA DE LAS SECUENCIAS — SOLO SERVIDOR.
 * ============================================================
 * Se comprueban con ia.prueba.ts, con un cliente falso: no llaman a OpenAI de verdad. El encargo ya viene construido (seguimientos.ts).
 *
 * NINGUNA LANZA. Sin clave, con la IA caída, sin saldo, pasada de tiempo o con una respuesta ilegible devuelven un `aviso` en español y quien
 * llama decide qué hacer: el cuadro de correo deja al comercial escribir los seguimientos a mano; el motor, ante un fallo, espera y reintenta
 * y, si no hay manera, deja la secuencia en pausa para que la mire una persona (un seguimiento que no sale cuesta poco).
 *
 * MODELO: `gpt-6-luna` (0,10 $ por millón de tokens de entrada y 0,50 de salida: una secuencia entera cuesta unas seis diezmilésimas de dólar).
 * Se cambia sin tocar código con SECUENCIAS_IA_MODELO (solo para esto) o con IA_MODELO (para todo el ERP). Cómo se pide un modelo que razona
 * (sin temperature, con max_completion_tokens y reasoning_effort) lo decide lib/ia/modelo.ts, igual que en las demás pantallas.
 */

export const TIEMPO_MAXIMO_DE_SEGUIMIENTOS_MS = 60_000
export const TIEMPO_MAXIMO_DE_REVISION_MS = 40_000
export const TIEMPO_MAXIMO_DE_REDACCION_MS = 60_000
export const TIEMPO_MAXIMO_DE_CLASIFICACION_MS = 40_000

/** Dólares por millón de tokens (entrada, salida) de `gpt-6-luna`, medidos el 23 oct 2026. Con otro modelo no se calcula: el registro dice «null» antes que inventar */
const PRECIO_DE_LUNA = { entrada: 0.1, salida: 0.5 }

export function costeAproximado(modelo: string, tokens: { entrada: number; salida: number } | null): number | null {
  if (!tokens || !/gpt-6-luna/.test(modelo)) return null
  return (tokens.entrada * PRECIO_DE_LUNA.entrada + tokens.salida * PRECIO_DE_LUNA.salida) / 1_000_000
}

/** El entorno con el modelo de las secuencias por delante, para que `parametrosDeIa` lo recoja */
function entornoDeSecuencias(): Record<string, string | undefined> {
  return { ...process.env, IA_MODELO: process.env.SECUENCIAS_IA_MODELO?.trim() || process.env.IA_MODELO }
}

export const modeloDeSecuencias = (): string => entornoDeSecuencias().IA_MODELO?.trim() || MODELO_DE_IA_POR_DEFECTO

export interface OpcionesDeIa {
  /** Para las pruebas */
  cliente?: ClienteDeCorreoIa
  tiempoMaximoMs?: number
}

function clienteDe(opciones: OpcionesDeIa): ClienteDeCorreoIa | null {
  if (opciones.cliente) return opciones.cliente
  const clave = process.env.OPENAI_API_KEY?.trim()
  return clave ? (new OpenAI({ apiKey: clave, maxRetries: 1 }) as unknown as ClienteDeCorreoIa) : null
}

type Gasto = { entrada: number; salida: number; hubo: boolean; llamadas: number }
const nuevoGasto = (): Gasto => ({ entrada: 0, salida: 0, hubo: false, llamadas: 0 })
const tokensDe = (g: Gasto): { entrada: number; salida: number } | null => (g.hubo ? { entrada: g.entrada, salida: g.salida } : null)

/** Del error solo se apunta el estado y el código: el cuerpo puede traer parte del encargo (datos de un lead) */
function apuntarFallo(donde: string, error: unknown): void {
  const e = error as { status?: number; code?: string; name?: string }
  console.error(`[secuencias-ia] fallo al ${donde}`, { estado: e?.status ?? null, codigo: e?.code ?? null, nombre: e?.name ?? null })
}

/* ------------------------------------------------------------------ */
/* 1. Escribir los seguimientos                                        */
/* ------------------------------------------------------------------ */

export interface ResultadoDeSeguimientos {
  /** Los textos, uno por seguimiento. null = no hay (el aviso dice por qué) */
  textos: string[] | null
  modelo: string
  /** Por qué no hay textos, o una advertencia sobre ellos. null = todo bien */
  aviso: string | null
  /** Lo que seguía mal en cada texto devuelto (vacío = limpio) */
  problemas: ProblemaDeSeguimiento[][]
  tokens: { entrada: number; salida: number } | null
  /** Cuántas veces se ha llamado a la IA (2 si hubo que pedir una corrección) */
  llamadas: number
}

export async function escribirSeguimientos(
  mensajes: { system: string; usuario: string },
  n: number,
  primerCorreo: string,
  opciones: OpcionesDeIa = {}
): Promise<ResultadoDeSeguimientos> {
  const modelo = modeloDeSecuencias()
  const gasto = nuevoGasto()
  const sin = (aviso: string, problemas: ProblemaDeSeguimiento[][] = []): ResultadoDeSeguimientos => ({ textos: null, modelo, aviso, problemas, tokens: tokensDe(gasto), llamadas: gasto.llamadas })

  const cliente = clienteDe(opciones)
  if (!cliente) return sin('La IA no está configurada en el servidor (falta OPENAI_API_KEY).')

  const control = new AbortController()
  const temporizador = setTimeout(() => control.abort(), opciones.tiempoMaximoMs ?? TIEMPO_MAXIMO_DE_SEGUIMIENTOS_MS)
  try {
    const conversacion: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: mensajes.system },
      { role: 'user', content: mensajes.usuario },
    ]
    let ultimos: string[] | null = null
    let problemas: ProblemaDeSeguimiento[][] = []
    // Dos vueltas como mucho: la primera, y una de corrección si algún seguimiento no vale
    for (let vuelta = 0; vuelta < 2; vuelta++) {
      gasto.llamadas++
      const completion = await cliente.chat.completions.create(
        {
          ...parametrosDeIa({ esfuerzo: 'low', maxSalida: 8000 }, entornoDeSecuencias()),
          response_format: { type: 'json_schema', json_schema: { name: 'seguimientos_para_un_lead', strict: true, schema: esquemaDeSeguimientos(n) } },
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
      if (eleccion?.message?.refusal) return sin('La IA se ha negado a escribir los seguimientos.')
      const textos = leerSeguimientos(eleccion?.message?.content, n)
      if (!textos) return sin(eleccion?.finish_reason === 'length' ? 'La respuesta de la IA se ha cortado. Vuelve a probar.' : 'La IA ha devuelto algo que no se entiende. Vuelve a probar.')

      ultimos = textos
      problemas = revisarSeguimientos(textos, primerCorreo)
      if (problemas.every((p) => p.length === 0)) break
      if (vuelta === 0) {
        conversacion.push(
          { role: 'assistant', content: JSON.stringify(Object.fromEntries(textos.map((t, i) => [`seguimiento_${i + 1}`, t]))) },
          { role: 'user', content: mensajeDeCorreccionDeSeguimientos(problemas) }
        )
      }
    }

    if (!ultimos) return sin('La IA no ha devuelto nada.')
    // Hablar de dinero NO se enseña, ni siquiera a un comercial que lo vaya a editar: es la única regla que no admite excepciones
    if (problemas.some((p) => p.includes('dinero'))) return sin('La IA ha mencionado cifras de dinero en un seguimiento y se ha descartado. Vuelve a probar.', problemas)
    const faltas = [...new Set(problemas.flat())]
    const aviso =
      faltas.length === 0
        ? null
        : faltas.includes('hueco')
          ? 'Algún seguimiento deja un hueco por rellenar: revísalo antes de programarlos.'
          : faltas.includes('repite')
            ? 'Algún seguimiento se parece demasiado a otro correo: conviene cambiarlo.'
            : faltas.includes('largo')
              ? 'Algún seguimiento ha salido largo: conviene acortarlo.'
              : 'Algún seguimiento ha salido muy corto: revísalo.'
    return { textos: ultimos, modelo, aviso, problemas, tokens: tokensDe(gasto), llamadas: gasto.llamadas }
  } catch (error) {
    apuntarFallo('escribir los seguimientos', error)
    return sin(motivoDelFallo(error))
  } finally {
    clearTimeout(temporizador)
  }
}

/* ------------------------------------------------------------------ */
/* 2. Revisar un seguimiento antes de que salga                        */
/* ------------------------------------------------------------------ */

export interface ResultadoDeRevisionConIa {
  /** La decisión ya validada. null = no se ha podido decidir (el aviso dice por qué) y quien llama espera y reintenta */
  revision: Revision | null
  modelo: string
  aviso: string | null
  tokens: { entrada: number; salida: number } | null
}

/**
 * Una sola llamada: la IA decide enviar, adaptar o pausar. Si dice «adaptar» y el texto no pasa la revisión de siempre (dinero, huecos…) la
 * decisión se convierte en una PAUSA, no en un envío: nada raro sale sin que lo mire una persona.
 */
export async function revisarConIa(
  mensajes: { system: string; usuario: string },
  original: string,
  opciones: OpcionesDeIa = {}
): Promise<ResultadoDeRevisionConIa> {
  const modelo = modeloDeSecuencias()
  const gasto = nuevoGasto()
  const sin = (aviso: string): ResultadoDeRevisionConIa => ({ revision: null, modelo, aviso, tokens: tokensDe(gasto) })

  const cliente = clienteDe(opciones)
  if (!cliente) return sin('La IA no está configurada en el servidor (falta OPENAI_API_KEY).')

  const control = new AbortController()
  const temporizador = setTimeout(() => control.abort(), opciones.tiempoMaximoMs ?? TIEMPO_MAXIMO_DE_REVISION_MS)
  try {
    gasto.llamadas++
    const completion = await cliente.chat.completions.create(
      {
        ...parametrosDeIa({ esfuerzo: 'low', maxSalida: 6000 }, entornoDeSecuencias()),
        response_format: { type: 'json_schema', json_schema: { name: 'revision_de_un_seguimiento', strict: true, schema: ESQUEMA_REVISION } },
        messages: [
          { role: 'system', content: mensajes.system },
          { role: 'user', content: mensajes.usuario },
        ],
      },
      { signal: control.signal }
    )
    if (completion.usage) {
      gasto.hubo = true
      gasto.entrada += completion.usage.prompt_tokens ?? 0
      gasto.salida += completion.usage.completion_tokens ?? 0
    }
    const eleccion = completion.choices?.[0]
    if (eleccion?.message?.refusal) return sin('La IA se ha negado a revisar el seguimiento.')
    const leida = leerRevision(eleccion?.message?.content)
    if (!leida) return sin('La IA ha devuelto algo que no se entiende.')
    const validada = validarRevision(leida, original)
    const revision: Revision = validada.ok ? validada.revision : { decision: 'pausar', motivo: validada.motivo, texto: '' }
    return { revision, modelo, aviso: null, tokens: tokensDe(gasto) }
  } catch (error) {
    apuntarFallo('revisar un seguimiento', error)
    return sin(motivoDelFallo(error))
  } finally {
    clearTimeout(temporizador)
  }
}

/* ------------------------------------------------------------------ */
/* 2 bis. Escribir un seguimiento justo antes de que salga             */
/* ------------------------------------------------------------------ */

export interface ResultadoDeRedaccionConIa {
  /** Lo que ha decidido la IA, ya comprobado. null = no se ha podido (el aviso dice por qué) y quien llama espera y reintenta */
  redaccion: Redaccion | null
  modelo: string
  aviso: string | null
  tokens: { entrada: number; salida: number } | null
  /** Cuántas veces se ha llamado a la IA (2 si hubo que pedir una corrección) */
  llamadas: number
}

/**
 * La IA escribe el seguimiento que va a salir leyendo todo el historial del lead, o dice que hay que pausar. Dos vueltas como mucho: si lo escrito
 * habla de dinero, deja huecos, es muy largo o muy corto o repite lo ya enviado, se le pide UNA corrección; si sigue sin valer, no hay redacción
 * (null) y el motor decide: esperar y reintentar o, si no hay manera, mandar el borrador de siempre o pausar.
 */
export async function redactarConIa(mensajes: { system: string; usuario: string }, anteriores: readonly string[], opciones: OpcionesDeIa = {}): Promise<ResultadoDeRedaccionConIa> {
  const modelo = modeloDeSecuencias()
  const gasto = nuevoGasto()
  const sin = (aviso: string): ResultadoDeRedaccionConIa => ({ redaccion: null, modelo, aviso, tokens: tokensDe(gasto), llamadas: gasto.llamadas })

  const cliente = clienteDe(opciones)
  if (!cliente) return sin('La IA no está configurada en el servidor (falta OPENAI_API_KEY).')

  const control = new AbortController()
  const temporizador = setTimeout(() => control.abort(), opciones.tiempoMaximoMs ?? TIEMPO_MAXIMO_DE_REDACCION_MS)
  try {
    const conversacion: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: mensajes.system },
      { role: 'user', content: mensajes.usuario },
    ]
    let problemasDeLaUltima: ProblemaDeSeguimiento[] = []
    for (let vuelta = 0; vuelta < 2; vuelta++) {
      gasto.llamadas++
      const completion = await cliente.chat.completions.create(
        {
          ...parametrosDeIa({ esfuerzo: 'low', maxSalida: 6000 }, entornoDeSecuencias()),
          response_format: { type: 'json_schema', json_schema: { name: 'seguimiento_escrito_para_un_lead', strict: true, schema: ESQUEMA_DE_REDACCION } },
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
      if (eleccion?.message?.refusal) return sin('La IA se ha negado a escribir el seguimiento.')
      const leida = leerRedaccion(eleccion?.message?.content)
      if (!leida) return sin(eleccion?.finish_reason === 'length' ? 'La respuesta de la IA se ha cortado.' : 'La IA ha devuelto algo que no se entiende.')
      const validada = validarRedaccion(leida, anteriores)
      if (validada.ok) return { redaccion: validada.redaccion, modelo, aviso: null, tokens: tokensDe(gasto), llamadas: gasto.llamadas }
      problemasDeLaUltima = validada.problemas
      // Hablar de dinero no se corrige dos veces: es la regla que no admite excepciones
      if (vuelta === 0) {
        conversacion.push({ role: 'assistant', content: JSON.stringify({ decision: leida.decision, motivo: leida.motivo, texto: leida.texto }) }, { role: 'user', content: mensajeDeCorreccionDeRedaccion(validada.problemas) })
      }
    }
    return sin(`El texto que ha escrito la IA no pasa la revisión (${problemasDeLaUltima.join(', ')}).`)
  } catch (error) {
    apuntarFallo('escribir un seguimiento', error)
    return sin(motivoDelFallo(error))
  } finally {
    clearTimeout(temporizador)
  }
}

/* ------------------------------------------------------------------ */
/* 3. Leer la respuesta de un lead                                     */
/* ------------------------------------------------------------------ */

export interface ResultadoDeClasificacionConIa {
  /** Lo que ha entendido la IA, SIN comprobar todavía (clasificar.ts lo comprueba antes de actuar). null = no se ha podido: el aviso dice por qué y quien llama reintenta */
  clasificacion: Clasificacion | null
  modelo: string
  aviso: string | null
  tokens: { entrada: number; salida: number } | null
}

/**
 * Una sola llamada: la IA clasifica lo que ha contestado un lead (interesado, no le interesa, escríbeme en enero…). El texto de la respuesta es de un
 * tercero: el encargo (clasificar.ts) le dice a la IA que no son órdenes, y aun así lo que devuelve se comprueba antes de tocar nada.
 */
export async function clasificarRespuestaConIa(mensajes: { system: string; usuario: string }, opciones: OpcionesDeIa = {}): Promise<ResultadoDeClasificacionConIa> {
  const modelo = modeloDeSecuencias()
  const gasto = nuevoGasto()
  const sin = (aviso: string): ResultadoDeClasificacionConIa => ({ clasificacion: null, modelo, aviso, tokens: tokensDe(gasto) })

  const cliente = clienteDe(opciones)
  if (!cliente) return sin('La IA no está configurada en el servidor (falta OPENAI_API_KEY).')

  const control = new AbortController()
  const temporizador = setTimeout(() => control.abort(), opciones.tiempoMaximoMs ?? TIEMPO_MAXIMO_DE_CLASIFICACION_MS)
  try {
    gasto.llamadas++
    const completion = await cliente.chat.completions.create(
      {
        ...parametrosDeIa({ esfuerzo: 'low', maxSalida: 4000 }, entornoDeSecuencias()),
        response_format: { type: 'json_schema', json_schema: { name: 'clasificacion_de_una_respuesta', strict: true, schema: ESQUEMA_DE_CLASIFICACION } },
        messages: [
          { role: 'system', content: mensajes.system },
          { role: 'user', content: mensajes.usuario },
        ],
      },
      { signal: control.signal }
    )
    if (completion.usage) {
      gasto.hubo = true
      gasto.entrada += completion.usage.prompt_tokens ?? 0
      gasto.salida += completion.usage.completion_tokens ?? 0
    }
    const eleccion = completion.choices?.[0]
    if (eleccion?.message?.refusal) return sin('La IA se ha negado a leer la respuesta.')
    const leida = leerClasificacion(eleccion?.message?.content)
    if (!leida) return sin(eleccion?.finish_reason === 'length' ? 'La respuesta de la IA se ha cortado.' : 'La IA ha devuelto algo que no se entiende.')
    return { clasificacion: leida, modelo, aviso: null, tokens: tokensDe(gasto) }
  } catch (error) {
    apuntarFallo('leer la respuesta de un lead', error)
    return sin(motivoDelFallo(error))
  } finally {
    clearTimeout(temporizador)
  }
}
