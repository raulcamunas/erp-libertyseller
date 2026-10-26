import { INTENTOS_MAXIMOS } from './reglas'
import { SEGUNDOS_MINIMOS_DE_CONVERSACION, type QuienDelTurno, type ResumenDeLlamadaGuardado, type TurnoDeLaLlamada } from './tipos'

/**
 * QUÉ SE ENSEÑA DE CADA LLAMADA EN LA FICHA Y EN «MI RENDIMIENTO», Y CUÁNDO SEGUIR PREGUNTANDO.
 * ============================================================================================
 * PURO: lo usan el historial del lead y la lista de llamadas del día. Se comprueba con pantalla.prueba.ts.
 *
 * El resumen NO llega con la llamada: el proceso `rinkel-transcribir` lo hace unos minutos después de colgar (la grabación tarda en
 * aparecer en Rinkel, el proceso corre cada dos minutos y transcribir y resumir son unos 15 segundos). Por eso la pantalla, mientras una
 * llamada reciente está esperando su resumen, vuelve a preguntar cada 30 segundos, y deja de hacerlo en cuanto llega o pasada una hora
 * (si en una hora no ha salido, el proceso está apagado o esa llamada no se va a transcribir, y preguntar más es gastar en balde).
 */

/** Lo mínimo de una llamada para saber si le toca resumen. Lo cumplen las llamadas del historial y las de «Mi rendimiento» */
export interface LlamadaTranscribible {
  id: string
  fecha: string
  duracion_s: number
  estado: string
  grabacion_id: string | null
  /** Sin lead no hay ficha donde dejar el resumen, así que el proceso no la transcribe. Las llamadas del historial siempre lo tienen */
  lead_id?: string | null
}

/** Cuánto tiempo, desde que acaba la llamada, se sigue esperando un resumen que no llega */
export const ESPERA_MAXIMA_MS = 60 * 60_000

/** ¿Es una llamada de las que el proceso transcribe? (contestada, con conversación, con grabación y con lead) */
export function leToca(l: LlamadaTranscribible): boolean {
  return l.estado === 'ANSWERED' && l.duracion_s >= SEGUNDOS_MINIMOS_DE_CONVERSACION && l.grabacion_id !== null && l.lead_id !== null
}

export type VistaDelResumen = 'resumen' | 'buzon' | 'procesando' | 'sin_resumen' | 'nada'

/**
 * Qué enseñar de una llamada según lo que haya en `rinkel_transcripciones`:
 *   · resumen      una conversación ya resumida: el bloque entero
 *   · buzon        saltó un buzón de voz: una línea apagada
 *   · procesando   se está haciendo (o falló y se va a reintentar): «Transcribiendo…»
 *   · sin_resumen  no se pudo y no se va a poder: una línea apagada con el motivo
 *   · nada         no hay fila, o no había nada aprovechable (silencio, un «¿diga?»): no se enseña nada
 */
export function vistaDelResumen(r: ResumenDeLlamadaGuardado | undefined): VistaDelResumen {
  if (!r) return 'nada'
  if (r.estado === 'hecha') {
    if (r.tipo === 'conversacion' && r.resumen) return 'resumen'
    if (r.tipo === 'buzon_de_voz') return 'buzon'
    return 'nada'
  }
  if (r.estado === 'procesando') return 'procesando'
  if (r.estado === 'fallida') return r.intentos >= INTENTOS_MAXIMOS ? 'sin_resumen' : 'procesando'
  return 'sin_resumen'
}

/** ¿Esta llamada está esperando su resumen? (le toca al proceso y aún no lo tiene, o lo está haciendo, o falló y se va a reintentar) */
export function esperaResumen(l: LlamadaTranscribible, r: ResumenDeLlamadaGuardado | undefined, ahora: number): boolean {
  if (!leToca(l)) return false
  if (r) return vistaDelResumen(r) === 'procesando'
  // Sin fila: todavía no ha llegado el proceso. Se espera solo a las que acaban de colgar
  const termino = Date.parse(l.fecha) + l.duracion_s * 1000
  return Number.isFinite(termino) && ahora - termino < ESPERA_MAXIMA_MS
}

/** ¿Merece la pena volver a preguntar por los resúmenes de estas llamadas? */
export function hayQueEsperar(llamadas: readonly LlamadaTranscribible[], resumenes: ReadonlyMap<string, ResumenDeLlamadaGuardado>, ahora: number): boolean {
  return llamadas.some((l) => esperaResumen(l, resumenes.get(l.id), ahora))
}

/**
 * Lo que llega de la base como `turnos` (un JSON que puede tener cualquier forma) -> los turnos que se pueden enseñar, o null si no hay: la llamada aún no se ha
 * separado, no valía la pena (muy corta) o lo guardado no se entiende. En ese caso se enseña la transcripción corrida, como siempre
 */
export function turnosLegibles(valor: unknown): TurnoDeLaLlamada[] | null {
  if (!Array.isArray(valor)) return null
  const lados: readonly QuienDelTurno[] = ['comercial', 'cliente']
  const turnos: TurnoDeLaLlamada[] = []
  for (const t of valor) {
    if (!t || typeof t !== 'object') continue
    const { quien, texto } = t as { quien?: unknown; texto?: unknown }
    const lado = lados.find((l) => l === quien)
    if (lado && typeof texto === 'string' && texto.trim()) turnos.push({ quien: lado, texto: texto.trim() })
  }
  return turnos.length > 0 ? turnos : null
}

/** La primera frase del resumen, para la línea de vista previa de una lista */
export function primeraFrase(texto: string): string {
  const limpio = texto.replace(/\s+/g, ' ').trim()
  const fin = limpio.search(/[.!?](\s|$)/)
  const frase = fin === -1 ? limpio : limpio.slice(0, fin + 1)
  return frase.length > 160 ? `${frase.slice(0, 159).trimEnd()}…` : frase
}
