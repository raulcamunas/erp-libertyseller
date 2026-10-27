import { PREGUNTAS_REUNION } from '@/lib/types/crm'
import type { AnalisisDeReunion } from './tipos'

/**
 * EL GUION DE LA REUNIÓN VISTO DESDE EL ANÁLISIS: qué claves existen y qué respuestas de la IA se pueden pasar al guion. Es PURO y vive aparte de analisis.ts a propósito: ese
 * módulo trae el SDK de OpenAI, y esto lo usa también el navegador (la ficha del cliente) sin arrastrarlo.
 */

/** Las claves del guion de la reunión que la IA puede contestar */
export const CLAVES_DEL_GUION: readonly string[] = PREGUNTAS_REUNION.flatMap((b) => b.preguntas.map((p) => p.clave))

/**
 * Las respuestas del análisis que se pueden pasar al guion: SOLO las de preguntas que siguen vacías. Lo que una persona ya escribió no se pisa nunca, ni aunque la IA lo
 * contradiga: la última palabra es de quien estuvo en la reunión.
 */
export function respuestasParaElGuion(analisis: Pick<AnalisisDeReunion, 'respuestas_guion'>, actuales: Record<string, string> | null | undefined): Record<string, string> {
  const nuevas: Record<string, string> = {}
  for (const { clave, respuesta } of analisis.respuestas_guion) {
    if (!CLAVES_DEL_GUION.includes(clave)) continue
    if ((actuales?.[clave] ?? '').trim() !== '') continue
    nuevas[clave] = respuesta
  }
  return nuevas
}
