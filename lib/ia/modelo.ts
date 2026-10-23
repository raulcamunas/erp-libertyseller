/**
 * EL MODELO DE LA IA «DE SIEMPRE» DEL ERP Y CÓMO SE PIDE.
 * =======================================================
 * PURO. Se comprueba con modelo.prueba.ts. Lo usan las pantallas que llaman a OpenAI desde hace tiempo: el auditor, el listing builder,
 * el optimizador de PPC (insights, informe y decisiones), el tracker, el validador de productos y el resumen de las citas.
 *
 * Todas pedían `gpt-4o` o `gpt-4o-mini`, que OpenAI APAGA el 14 ene 2027 (a partir de ese día cada llamada daría error). Ahora piden
 * `gpt-6-luna`, el que OpenAI recomienda en su lugar y el más barato de la familia: 0,10 / 0,50 $ por millón de tokens de entrada y
 * de salida, frente a 2,50 / 10 $ de gpt-4o.
 *
 * LO QUE CAMBIA AL PEDIRLO (probado con la API real el 23 oct 2026; por eso no basta con cambiar el nombre del modelo):
 *  - `temperature`: solo admite 1. Cualquier otro valor (0,4, 0,7…) es un error 400. Aquí no se manda.
 *  - `max_tokens`: también es un 400. Se llama `max_completion_tokens`, y el tope cuenta TAMBIÉN lo que el modelo «piensa» antes de
 *    contestar: hay que dejarle sitio de sobra o puede acabar sin escribir la respuesta.
 *  - `reasoning_effort`: admite none, low, medium, high y xhigh (minimal NO). Si no se pone, razona por su cuenta y tarda el doble que
 *    con `low` (10 s frente a 5 s en un encargo corto; con `none` son 3 s). Aquí se pone siempre.
 *
 * Se cambia en el servidor sin tocar código con IA_MODELO e IA_ESFUERZO (valen para todas las pantallas a la vez). Con un modelo de los
 * de siempre (sin razonamiento) se manda `temperature` y no `reasoning_effort`.
 */

export const MODELO_DE_IA_POR_DEFECTO = 'gpt-6-luna'

export const ESFUERZOS_DE_IA = ['none', 'low', 'medium', 'high', 'xhigh'] as const
export type EsfuerzoDeIa = (typeof ESFUERZOS_DE_IA)[number]

type Entorno = Record<string, string | undefined>

/** ¿Es un modelo de los que razonan? Se piden de otra manera: sin `temperature` y con `reasoning_effort` (igual que en lib/correo/ia-generar.ts) */
export const razona = (modelo: string): boolean => /^(gpt-[5-9]|gpt-\d{2}|o\d)/.test(modelo)

export function modeloDeIa(entorno: Entorno = process.env): string {
  return entorno.IA_MODELO?.trim() || MODELO_DE_IA_POR_DEFECTO
}

/** El esfuerzo que manda el servidor (IA_ESFUERZO) si es uno de los que existen; si no, el que pide cada pantalla */
export function esfuerzoDeIa(porDefecto: EsfuerzoDeIa, entorno: Entorno = process.env): EsfuerzoDeIa {
  const forzado = entorno.IA_ESFUERZO?.trim().toLowerCase()
  return ESFUERZOS_DE_IA.find((e) => e === forzado) ?? porDefecto
}

export interface PeticionDeIa {
  /** Cuánto piensa antes de contestar. `low` para casi todo; `none` si lo que importa es la rapidez. Por defecto `low` */
  esfuerzo?: EsfuerzoDeIa
  /** El tope de tokens de la respuesta; para un modelo que razona incluye lo que piensa, así que va holgado */
  maxSalida: number
  /** Solo para un modelo de los de siempre (IA_MODELO=gpt-4.1…): los que razonan no la admiten */
  temperatura?: number
}

export interface ParametrosDeModelo {
  model: string
  max_completion_tokens: number
  reasoning_effort?: EsfuerzoDeIa
  temperature?: number
}

/** Lo que cambia de un modelo a otro al pedir: el nombre, el tope de la respuesta y el esfuerzo (o la temperatura). El resto de la petición no cambia */
export function parametrosDeIa(peticion: PeticionDeIa, entorno: Entorno = process.env): ParametrosDeModelo {
  const model = modeloDeIa(entorno)
  return {
    model,
    max_completion_tokens: peticion.maxSalida,
    ...(razona(model) ? { reasoning_effort: esfuerzoDeIa(peticion.esfuerzo ?? 'low', entorno) } : { temperature: peticion.temperatura ?? 0.5 }),
  }
}
