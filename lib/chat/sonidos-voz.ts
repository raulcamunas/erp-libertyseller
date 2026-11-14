/**
 * LOS SONIDOS DE LA JUNTA DE VOZ Y DE LAS LLAMADAS. Qué suena en cada caso lo elige cada persona en la biblioteca de sonidos (lib/sonidos/biblioteca.ts, selector «Sonidos»); aquí solo se
 * decide CUÁNDO suena, y el interruptor «Sonidos de la junta» de Ajustes de audio, que apaga los avisos de la junta (el tono de cuando te llaman no depende de él).
 *
 *   · entrar / salir          lo oyes tú al entrar a una junta o dejarla
 *   · otro-entra / otro-sale  lo oye quien ya está dentro cuando alguien entra o sale (más suave)
 *   · mute / unmute           tu micrófono
 *   · pantalla                empiezas a compartir tu pantalla
 *   · te-ven                  mientras compartes, otra persona abre tu pantalla (una vez por persona y por vez que compartes)
 *   · ensordecer / oir        dejar de oír a todos y volver a oír
 *   · llamando                el tono que oye quien llama mientras el otro no contesta
 *   · llamada                 el tono de cuando te llaman (iniciarTonoDeLlamada)
 */

import { iniciarBucle, ponerSalidaDeAudio, prepararAudio, reproducirInteraccion } from '@/lib/sonidos/reproductor'

export type SonidoDeVoz = 'entrar' | 'salir' | 'otro-entra' | 'otro-sale' | 'mute' | 'unmute' | 'ensordecer' | 'oir' | 'puerta' | 'pantalla' | 'te-ven'

/** El «estoy viendo tu pantalla» que manda quien la abre a quien la comparte (mensaje de datos de LiveKit, solo a esa persona) */
export const TEMA_VEO_TU_PANTALLA = 'veo-tu-pantalla'

/** Hasta cuándo suena el «llamando…» si el otro no entra */
export const MAX_LLAMANDO_MS = 40_000

let activos = true

/** Lo que decide cada persona: si suenan los avisos de la junta y por qué altavoz */
export function ponerSonidosDeVoz(ajustes: { activos: boolean; salida: string }): void {
  activos = ajustes.activos
  ponerSalidaDeAudio(ajustes.salida)
}

/** El navegador no deja sonar nada hasta el primer toque en la página: se prepara el audio. Devuelve cómo quitar los oyentes */
export const prepararSonidosDeVoz = prepararAudio

/** Un sonido de la junta (si la persona no los ha apagado) */
export function sonarVoz(s: SonidoDeVoz): void {
  if (!activos) return
  void reproducirInteraccion(s)
}

/** El «llamando…» de quien llama: se repite hasta que se pare o pasen MAX_LLAMANDO_MS. Devuelve cómo pararlo */
export function iniciarLlamando(): () => void {
  if (!activos) return () => undefined
  return iniciarBucle('llamando', { max: MAX_LLAMANDO_MS })
}

/** El tono de cuando te llaman, hasta que se pare. No depende del interruptor de los sonidos de la junta */
export function iniciarTonoDeLlamada(): () => void {
  return iniciarBucle('llamada')
}
