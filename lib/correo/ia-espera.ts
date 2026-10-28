import { claseDeLlamada, msDesdeQueAcabo, type LlamadaParaIa } from './ia-contexto'

/**
 * ESPERAR A QUE SE TRANSCRIBA LA LLAMADA QUE ACABA DE TERMINAR. PURO (las dependencias entran por parámetro). Se comprueba con ia-espera.prueba.ts.
 * ==========================================================================================================================================
 * El uso más habitual de «Redactar con IA» es justo DESPUÉS de colgar (40 de los 79 primeros borradores eran «tras llamada»). Pero lo que se habló solo lo sabe la IA cuando la
 * grabación está transcrita, y eso tardaba unos tres minutos (medido sobre 104 llamadas: mediana 2,6 min, p90 3,5): 90 s de espera de seguridad antes de bajar el audio, el turno del
 * proceso que transcribe (pasaba cada dos minutos) y el procesado. Desde el 28 oct 2026 la espera es de 45 s y el proceso pasa cada 30 s, así que lo normal es ~1 min 15 s. Medido
 * sobre los borradores, 8 de 40 se pidieron entre 20 s y 5 min después de una conversación real y la transcripción llegó entre 33 s y 3 min más tarde: la IA escribió a ciegas un
 * correo genérico, y el comercial lo cambió entero.
 *
 * QUÉ SE HACE: si la última llamada con pinta de conversación acaba de terminar y todavía no tiene transcripción, se ESPERA un rato (como mucho 45 s), adelantando lo que haría el
 * proceso automático (transcribir las pendientes, sin esperar a su siguiente vuelta, que pasa cada 30 s) y volviendo a mirar cada pocos segundos. Si llega, el borrador ya lleva
 * lo que se habló. Si no llega, se escribe igualmente, la IA recibe el aviso de que NO sabe lo que se habló (ia-contexto.ts: no puede decir «hemos hablado») y el comercial ve una
 * nota que le dice que espere un par de minutos.
 *
 * SOLO SE ADELANTA CUANDO PUEDE SERVIR. El SQL que ofrece las llamadas por transcribir no ofrece una hasta pasada la espera de seguridad tras colgar (45 s desde la migración 259;
 * 90 s antes, o si esa migración no está lanzada), así que antes de eso adelantar no encuentra nada: se limita a mirar si ha llegado (una lectura barata) y empieza a adelantar cuando
 * la llamada cumple la espera. Si la espera de la base fuera otra, solo cambia cuántas veces se intenta en balde (una pasada vacía son 4 consultas pequeñas).
 */

/** Una llamada que acabó hace más que esto sin transcripción ya no va a tenerla pronto (se omitió, falló o es anterior a la transcripción): no se espera */
export const MINUTOS_QUE_MERECE_LA_PENA_ESPERAR = 8

/**
 * Cuánto tiene que llevar colgada una llamada para que el proceso que transcribe la ofrezca. Es el ajuste `espera_tras_colgar_s` de la base (migración 259; antes estaba
 * escrito en el SQL de la 244 como «+ INTERVAL '90 seconds'»). Aquí es solo una copia para no intentarlo antes de tiempo: si no coincide, no se estropea nada.
 */
export const SEGUNDOS_HASTA_QUE_SE_OFRECE = 45

/** ¿Hay una llamada contestada y larga que acaba de terminar y todavía no está transcrita? */
export function hayTranscripcionPendiente(llamadas: readonly LlamadaParaIa[], ahora: number): boolean {
  return llamadas.some((c) => claseDeLlamada(c) === 'sin_comprobar' && msDesdeQueAcabo(c, ahora) <= MINUTOS_QUE_MERECE_LA_PENA_ESPERAR * 60_000)
}

/** ¿Hay alguna de esas que el proceso que transcribe ya ofrecería? Antes de la espera de seguridad no hay nada que adelantar */
export function sePuedeAdelantar(llamadas: readonly LlamadaParaIa[], ahora: number): boolean {
  return llamadas.some((c) => claseDeLlamada(c) === 'sin_comprobar' && msDesdeQueAcabo(c, ahora) >= SEGUNDOS_HASTA_QUE_SE_OFRECE * 1000 && msDesdeQueAcabo(c, ahora) <= MINUTOS_QUE_MERECE_LA_PENA_ESPERAR * 60_000)
}

/** Lo que ve el comercial junto al borrador cuando se ha acabado el tiempo y la llamada sigue sin transcribirse */
export const AVISO_TRANSCRIPCION_PENDIENTE =
  'La llamada acaba de terminar y su grabación todavía se está transcribiendo (tarda unos 3 minutos): este borrador no sabe lo que habéis hablado. Dale a «Volver a redactar» en un par de minutos, o cuéntaselo en las indicaciones.'

export interface DependenciasDeLaEspera {
  /** Vuelve a leer las llamadas del lead */
  cargar: () => Promise<LlamadaParaIa[]>
  /** Adelanta lo que haría el proceso automático (transcribir lo pendiente). Recibe cuánto tiempo queda de espera, para no empezar nada que no quepa. Puede no hacer nada. No debería lanzar, pero si lo hace se ignora */
  adelantar: (restanteMs: number) => Promise<void>
  ahora: () => number
  dormir: (ms: number) => Promise<void>
}

export interface OpcionesDeLaEspera {
  /** Cuánto se espera como máximo (ms). 45.000: una llamada colgada hace 20 s se ofrece a los 45 y se transcribe en unos 10-15 s */
  maxMs?: number
  /** Cada cuánto se vuelve a mirar (ms). 5.000 */
  cadaMs?: number
}

export interface ResultadoDeLaEspera {
  llamadas: LlamadaParaIa[]
  /** true si se ha acabado el tiempo y la llamada sigue sin transcribirse */
  pendiente: boolean
  esperadoMs: number
  /** Cuántas veces se ha mirado */
  vueltas: number
}

export async function esperarLaTranscripcion(deps: DependenciasDeLaEspera, llamadas: LlamadaParaIa[], opciones: OpcionesDeLaEspera = {}): Promise<ResultadoDeLaEspera> {
  const maxMs = opciones.maxMs ?? 45_000
  const cadaMs = opciones.cadaMs ?? 5_000
  const inicio = deps.ahora()
  let actuales = llamadas
  let vueltas = 0

  while (hayTranscripcionPendiente(actuales, deps.ahora()) && deps.ahora() - inicio < maxMs) {
    vueltas++
    if (sePuedeAdelantar(actuales, deps.ahora())) {
      try {
        await deps.adelantar(Math.max(0, maxMs - (deps.ahora() - inicio)))
      } catch {
        /* adelantar es una ayuda: si falla, se sigue esperando al proceso automático */
      }
    }
    try {
      actuales = await deps.cargar()
    } catch {
      // Sin poder leer las llamadas no se puede saber si ya está: se deja lo que había y se sigue sin esperar más
      break
    }
    if (!hayTranscripcionPendiente(actuales, deps.ahora())) break
    // Si ya no cabe otra vuelta entera, no se duerme para nada
    if (deps.ahora() - inicio + cadaMs >= maxMs) break
    await deps.dormir(cadaMs)
  }
  return { llamadas: actuales, pendiente: hayTranscripcionPendiente(actuales, deps.ahora()), esperadoMs: deps.ahora() - inicio, vueltas }
}
