/**
 * LAS FORMAS DE LA TRANSCRIPCIÓN DE UNA LLAMADA.
 * ==============================================
 * Solo tipos y textos: nada que importe Supabase, OpenAI ni el servidor, así que lo usan igual el motor (servidor) y la ficha (navegador).
 *
 * Cada llamada contestada de Rinkel con grabación y lead acaba teniendo una fila en `rinkel_transcripciones` (migración 244) con lo que
 * se oyó (la transcripción) y lo que se entendió (resumen, línea de la conversación, siguiente paso e interés).
 */

/** Qué fue la llamada: una conversación de dos personas, un buzón de voz o mensaje automático, o nada aprovechable */
export type TipoDeLlamada = 'conversacion' | 'buzon_de_voz' | 'sin_contenido'

/** Cuánto interés mostró el cliente en lo que se le contó */
export type InteresDeLlamada = 'alto' | 'medio' | 'bajo' | 'ninguno' | 'no_claro'

/** Quién dice algo en la línea de la conversación. La transcripción no distingue voces: lo deduce la IA por lo que se dice */
export type QuienHabla = 'comercial' | 'cliente' | 'los_dos'

export interface MomentoDeLaLlamada {
  quien: QuienHabla
  texto: string
}

/** Lo que la IA entiende de una transcripción */
export interface ResumenGenerado {
  tipo: TipoDeLlamada
  resumen: string
  /** Los momentos de la llamada en el orden en que ocurrieron. Vacía si no fue una conversación */
  linea: MomentoDeLaLlamada[]
  /** Lo que se acordó hacer, tal como se dijo («llamar el jueves a las 10»), o null si no se acordó nada */
  siguiente_paso: string | null
  interes: InteresDeLlamada
}

export type EstadoDeTranscripcion = 'procesando' | 'hecha' | 'fallida' | 'omitida'

/** Una fila de rinkel_transcripciones, SIN la transcripción entera (que es larga y se pide solo cuando se quiere leer) */
export interface ResumenDeLlamadaGuardado {
  llamada_id: string
  estado: EstadoDeTranscripcion
  motivo: string | null
  intentos: number
  tipo: TipoDeLlamada | null
  resumen: string | null
  linea: MomentoDeLaLlamada[] | null
  siguiente_paso: string | null
  interes: InteresDeLlamada | null
}

/** Las columnas que se piden para pintar el resumen en la ficha (la transcripción NO está: se pide aparte) */
export const CAMPOS_DEL_RESUMEN = 'llamada_id, estado, motivo, intentos, tipo, resumen, linea, siguiente_paso, interes'

export const ETIQUETA_DE_INTERES: Record<InteresDeLlamada, string> = {
  alto: 'Interés alto',
  medio: 'Interés medio',
  bajo: 'Interés bajo',
  ninguno: 'Sin interés',
  no_claro: 'Interés sin determinar',
}

export const ETIQUETA_DE_QUIEN: Record<QuienHabla, string> = {
  comercial: 'Comercial',
  cliente: 'Cliente',
  los_dos: 'Los dos',
}

/** Mismo mínimo que la regla del motor (reglas.ts): por debajo de esto una llamada «contestada» es casi siempre un buzón de voz */
export const SEGUNDOS_MINIMOS_DE_CONVERSACION = 20
