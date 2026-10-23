/**
 * CUÁNTO CUESTA TRANSCRIBIR Y RESUMIR UNA LLAMADA.
 * ================================================
 * PURO. Se comprueba con precios.prueba.ts. Los precios son los de la página de precios de OpenAI el 23 oct 2026
 * (developers.openai.com/api/docs/pricing); si cambian, se cambian aquí.
 *
 * El número que sale NO es lo que cobra OpenAI al céntimo: es la cuenta que hace el ERP para vigilar el tope diario y para decir en
 * Sistema cuánto se lleva gastado. Un modelo que no está en la lista se cuenta al precio MÁS ALTO conocido, a propósito: equivocarse
 * hacia arriba hace saltar el tope antes, no después.
 */

/** Dólares por MINUTO de audio */
export const PRECIO_DE_VOZ_POR_MINUTO: Readonly<Record<string, number>> = {
  'gpt-transcribe': 0.0045,
  'gpt-4o-mini-transcribe': 0.003,
  'gpt-4o-transcribe': 0.006,
  'gpt-4o-transcribe-diarize': 0.006,
  'whisper-1': 0.006,
}

/** Dólares por MILLÓN de tokens: [entrada, salida] */
export const PRECIO_DE_TEXTO_POR_MILLON: Readonly<Record<string, readonly [number, number]>> = {
  'gpt-6-luna': [0.1, 0.5],
  'gpt-5.6-luna': [0.2, 1.2],
  'gpt-5.4-nano': [0.2, 1.25],
  'gpt-5.4-mini': [0.75, 4.5],
  'gpt-6-sol': [2, 10],
  'gpt-5.6-terra': [2, 12],
  'gpt-5.5': [5, 30],
}

const VOZ_MAS_CARA = Math.max(...Object.values(PRECIO_DE_VOZ_POR_MINUTO))
const TEXTO_MAS_CARO: readonly [number, number] = [5, 30]

export function costeDeVoz(modelo: string, segundos: number): number {
  const porMinuto = PRECIO_DE_VOZ_POR_MINUTO[modelo] ?? VOZ_MAS_CARA
  return (Math.max(0, segundos) / 60) * porMinuto
}

export function costeDeTexto(modelo: string, tokensDeEntrada: number, tokensDeSalida: number): number {
  const [entrada, salida] = PRECIO_DE_TEXTO_POR_MILLON[modelo] ?? TEXTO_MAS_CARO
  return (Math.max(0, tokensDeEntrada) * entrada + Math.max(0, tokensDeSalida) * salida) / 1_000_000
}

/** «0,03 $», «0,0004 $»: pocos decimales cuando es grande, los justos para no decir «0,00 $» cuando es pequeño */
export function enDolares(cantidad: number): string {
  const n = Math.max(0, cantidad)
  const decimales = n >= 0.1 ? 2 : n >= 0.01 ? 3 : 4
  return `${n.toFixed(decimales).replace('.', ',')} $`
}
