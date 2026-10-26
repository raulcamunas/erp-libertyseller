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

/** Quién dice un turno de la transcripción entera. Son dos lados: Liberty Seller y la empresa a la que se llama (aunque en ella hablen varias personas) */
export type QuienDelTurno = 'comercial' | 'cliente'

/**
 * Un turno de palabra de la transcripción entera: lo que dice una persona hasta que habla la otra. La IA decide quién es quién por lo que se dice (la voz
 * no trae esa información), así que puede equivocarse, sobre todo en llamadas muy cortas o cortadas.
 */
export interface TurnoDeLaLlamada {
  quien: QuienDelTurno
  texto: string
}

/**
 * Lo que el cliente pidió sobre volver a llamarle («llámame el jueves a las 10»), tal como lo entendió la IA. Sin comprobar todavía: antes de tocar la ficha
 * del lead se comprueba (rellamada.ts) que la frase esté de verdad en la llamada y que el día cuadre.
 */
export interface PeticionDeRellamada {
  /** El día en que pidió que se le llame, AAAA-MM-DD */
  fecha: string
  /** La hora, HH:MM, si la dijo */
  hora: string | null
  /** Sus palabras, copiadas de la transcripción, en que se apoya la IA */
  frase: string
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
  /** Si el cliente pidió o aceptó que se le vuelva a llamar un día concreto. null si no (casi siempre) */
  rellamada?: PeticionDeRellamada | null
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
