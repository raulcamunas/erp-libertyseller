/**
 * INTERVALOS EN MINUTOS, ESCRITOS COMO LOS DIRÍA UNA PERSONA
 * =========================================================
 * Puro: sin red, sin base y sin reloj. Lo usan las dos pantallas de horarios —la
 * de los procesos automáticos (Sistema) y la de los refrescos (Ingesta)— porque
 * son dos relojes distintos con el mismo problema de presentación.
 *
 * TODO SE GUARDA EN MINUTOS, siempre. Una sola columna en la base y una sola
 * comparación al decidir si toca; la unidad es cosa de la pantalla. Guardar
 * «6 días» como número y unidad obligaría a convertir en cada comprobación —
 * sesenta veces por hora— para no ganar nada.
 */

export const UNIDADES = [
  { id: 'min', label: 'minutos', singular: 'minuto', minutos: 1 },
  { id: 'h', label: 'horas', singular: 'hora', minutos: 60 },
  { id: 'd', label: 'días', singular: 'día', minutos: 1440 },
] as const

export type Unidad = (typeof UNIDADES)[number]['id']

/** La unidad más grande en la que el intervalo sale como número redondo */
export function descomponer(minutos: number): { valor: number; unidad: Unidad } {
  for (const u of [...UNIDADES].reverse()) {
    if (minutos >= u.minutos && minutos % u.minutos === 0) {
      return { valor: minutos / u.minutos, unidad: u.id }
    }
  }
  return { valor: minutos, unidad: 'min' }
}

export function aMinutos(valor: number, unidad: Unidad): number {
  return valor * (UNIDADES.find((u) => u.id === unidad)?.minutos ?? 1)
}

/** «cada 4 horas», «cada 6 días», «cada 1 minuto» → «cada minuto» */
export function textoIntervalo(minutos: number): string {
  const { valor, unidad } = descomponer(minutos)
  const u = UNIDADES.find((x) => x.id === unidad)!
  return valor === 1 ? `cada ${u.singular}` : `cada ${valor} ${u.label}`
}

/**
 * Cuántas veces al día se ejecuta, en texto.
 *
 * Existe porque «cada 240 minutos» y «6 veces al día» son el mismo dato y no la
 * misma información: la pregunta que se hace uno mirando esta pantalla es
 * cuántas veces pasa algo, no cada cuánto. Ver un «semanal» a secas y creer que
 * era cada quince minutos es exactamente lo que pasó.
 */
export function vecesAlDia(minutos: number): string {
  if (minutos <= 0) return '—'
  const veces = 1440 / minutos
  if (veces >= 1) {
    const n = Number.isInteger(veces) ? veces : Math.round(veces * 10) / 10
    return n === 1 ? '1 vez al día' : `${n} veces al día`
  }
  const dias = minutos / 1440
  const n = Number.isInteger(dias) ? dias : Math.round(dias * 10) / 10
  return n === 1 ? '1 vez al día' : `1 vez cada ${n} días`
}

/** La ventana nocturna, 23:00 → 06:00. Siete horas */
export const VENTANA_MINUTOS = 7 * 60

/**
 * CUÁNTAS VECES SALE DE VERDAD, CONTANDO LA VENTANA NOCTURNA.
 *
 * Sin esto la pantalla mentía: «Precios y Buy Box, cada 20 horas» salía como
 * «1,2 veces al día», y con ventana nocturna eso es imposible — solo puede
 * arrancar entre las 23:00 y las 06:00, así que sale UNA VEZ POR NOCHE y punto.
 *
 * Un número que no se puede cumplir es peor que no poner número: quien lo lee
 * cuenta con él.
 */
export function salidaReal(minutos: number, soloDeNoche: boolean): string {
  if (minutos <= 0) return '—'
  if (!soloDeNoche) return vecesAlDia(minutos)
  if (minutos >= 1440) return vecesAlDia(minutos)
  if (minutos >= VENTANA_MINUTOS) return '1 vez por noche'
  const veces = Math.floor(VENTANA_MINUTOS / minutos)
  return `${veces} veces por noche`
}

/**
 * Lo que hay que avisar de una combinación de cadencia y ventana. null = nada.
 *
 * Son DOS avisos opuestos y los dos hacen falta:
 *
 *   · Por debajo de las 7 horas, la ventana se come el número: pides cada 4
 *     horas y solo puede arrancar de 23:00 a 06:00, así que de día no corre.
 *
 *   · A partir de las 24 h pasa lo contrario y es más sutil: la cadencia se va
 *     desplazando. Un barrido que ayer empezó a las 02:00 y hoy arranca a la
 *     01:58 no llega a las 24 horas por dos minutos, se descarta, y ese cliente
 *     SE SALTA UNA NOCHE ENTERA sin que falle nada. Por eso los valores de
 *     partida son 20 horas y no 24.
 */
export function avisoDeVentana(minutos: number, soloDeNoche: boolean): string | null {
  if (!soloDeNoche) return null
  if (minutos < VENTANA_MINUTOS) {
    return 'Con la ventana nocturna esto no se cumple: solo puede arrancar de 23:00 a 06:00, así que de día no corre.'
  }
  if (minutos >= 1440) {
    return 'Con ventana nocturna, 24 h o más se va desplazando cada noche y acaba saltándose una. 20 horas es lo que lo evita.'
  }
  return null
}
