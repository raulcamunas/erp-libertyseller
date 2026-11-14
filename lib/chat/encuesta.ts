/**
 * LAS ENCUESTAS — PURO. Una pregunta con entre 2 y 8 opciones, de una sola respuesta o de varias; quien la creó puede cerrarla.
 */

export interface EncuestaChat {
  pregunta: string
  opciones: string[]
  multiple: boolean
  cerrada: boolean
}

export const MIN_OPCIONES = 2
export const MAX_OPCIONES = 8
export const PREGUNTA_MAX = 200
export const OPCION_MAX = 80

export type ResultadoDeEncuesta = { ok: true; encuesta: EncuestaChat } | { ok: false; motivo: string }

/** Lo que llega de la pantalla, limpio: sin opciones vacías ni repetidas */
export function limpiarEncuesta(entrada: unknown): ResultadoDeEncuesta {
  if (!entrada || typeof entrada !== 'object') return { ok: false, motivo: 'Falta la encuesta.' }
  const e = entrada as Record<string, unknown>
  const pregunta = typeof e.pregunta === 'string' ? e.pregunta.replace(/\s+/g, ' ').trim().slice(0, PREGUNTA_MAX) : ''
  if (!pregunta) return { ok: false, motivo: 'Escribe la pregunta.' }
  const vistas = new Set<string>()
  const opciones: string[] = []
  for (const o of Array.isArray(e.opciones) ? e.opciones : []) {
    const t = typeof o === 'string' ? o.replace(/\s+/g, ' ').trim().slice(0, OPCION_MAX) : ''
    if (!t || vistas.has(t.toLowerCase())) continue
    vistas.add(t.toLowerCase())
    opciones.push(t)
  }
  if (opciones.length < MIN_OPCIONES) return { ok: false, motivo: `Pon al menos ${MIN_OPCIONES} opciones distintas.` }
  if (opciones.length > MAX_OPCIONES) return { ok: false, motivo: `Como mucho ${MAX_OPCIONES} opciones.` }
  return { ok: true, encuesta: { pregunta, opciones, multiple: e.multiple === true, cerrada: false } }
}

/** `votos[opción]` = quién la ha votado */
export type Votos = Record<number, string[]>

export interface Recuento {
  /** Por opción: cuántos votos y qué parte del total de votantes */
  opciones: Array<{ votos: number; porcentaje: number; mio: boolean }>
  /** Personas distintas que han votado */
  votantes: number
}

export function contarVotos(encuesta: Pick<EncuestaChat, 'opciones'>, votos: Votos, yo: string): Recuento {
  const votantes = new Set<string>()
  for (const [, quienes] of Object.entries(votos)) for (const q of quienes) votantes.add(q)
  const total = votantes.size
  return {
    votantes: total,
    opciones: encuesta.opciones.map((_, i) => {
      const quienes = votos[i] ?? []
      return { votos: quienes.length, porcentaje: total === 0 ? 0 : Math.round((quienes.length / total) * 100), mio: quienes.includes(yo) }
    }),
  }
}

/** Lo que pasa con los votos de una persona al pulsar una opción: en una encuesta de una sola respuesta sustituye; en una múltiple, alterna */
export function votosTrasPulsar(encuesta: Pick<EncuestaChat, 'multiple' | 'opciones'>, actuales: readonly number[], opcion: number): number[] {
  if (opcion < 0 || opcion >= encuesta.opciones.length) return [...actuales]
  const tiene = actuales.includes(opcion)
  if (encuesta.multiple) return tiene ? actuales.filter((o) => o !== opcion) : [...actuales, opcion].sort((a, b) => a - b)
  return tiene ? [] : [opcion]
}
