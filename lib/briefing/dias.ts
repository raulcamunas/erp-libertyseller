import { diaCorto, diasEntre, esDiaHabil } from '@/lib/correo/secuencias/fechas'

/**
 * QUÉ DICE LA PANTALLA DEL DÍA QUE ENSEÑA.
 * ========================================
 * PURO: sin base ni reloj (el «hoy» llega de fuera). Se comprueba con dias.prueba.ts.
 *
 * La rutina publica de lunes a viernes por la mañana, así que lo normal es que el último briefing sea el de hoy. Cuando no lo es, la pantalla lo dice en una línea en
 * vez de dejar que se lea el de ayer creyendo que es el de hoy:
 *
 *   · 'hoy'        es el de hoy: no hay nada que avisar.
 *   · 'normal'     es el último y no hace falta avisar de nada (un fin de semana, el del viernes).
 *   · 'aviso'      es el último, pero hoy es laborable y aún no ha llegado el de hoy; o ya hace varios días que no llega ninguno.
 *   · 'historico'  se está mirando un día pasado a propósito (el selector de días).
 *   · 'adelantado' es de mañana (se acepta publicar con un día de adelanto).
 */

export type ClaseDeDia = 'hoy' | 'normal' | 'aviso' | 'historico' | 'adelantado'

export interface SituacionDelDia {
  clase: ClaseDeDia
  /** La línea que se enseña; vacía cuando no hay nada que decir */
  texto: string
}

/** Un fin de semana largo sin briefing es normal; pasado esto, se avisa aunque hoy no sea laborable */
const DIAS_SIN_BRIEFING_QUE_AVISAN = 3

/**
 * @param dia        el día del briefing que se está viendo (AAAA-MM-DD)
 * @param hoy        hoy en Madrid (AAAA-MM-DD)
 * @param esElUltimo ¿es el más reciente de los publicados? (false = se ha elegido un día pasado en el selector)
 */
export function situacionDelDia(entrada: { dia: string; hoy: string; esElUltimo: boolean }): SituacionDelDia {
  const { dia, hoy, esElUltimo } = entrada
  if (dia === hoy) return { clase: 'hoy', texto: '' }
  if (dia > hoy) return { clase: 'adelantado', texto: `Es el briefing de ${diaCorto(dia)}, publicado con adelanto.` }
  if (!esElUltimo) return { clase: 'historico', texto: `Estás viendo el briefing del ${diaCorto(dia)}.` }

  const atras = diasEntre(dia, hoy)
  if (esDiaHabil(hoy)) return { clase: 'aviso', texto: `Aún no ha llegado el briefing de hoy. Este es el del ${diaCorto(dia)}.` }
  if (atras > DIAS_SIN_BRIEFING_QUE_AVISAN) return { clase: 'aviso', texto: `Hace ${atras} días que no llega un briefing. El último es el del ${diaCorto(dia)}.` }
  return { clase: 'normal', texto: '' }
}
