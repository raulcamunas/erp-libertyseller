/**
 * DÓNDE VA CADA CITA EN LA REJILLA DE UN DÍA.
 * ============================================
 * Convierte las citas de un día en bloques con su posición: la fila de la rejilla donde empieza (top), lo que mide (height) y la columna que le toca si se solapa con
 * otra (col de totalCols). Todo en hora de España, que es la hora a la que se agenda, sea cual sea la zona del navegador.
 *
 * Salió de AgendaCalendar, donde se calculaba mezclado con el pintado. Separado se comprueba entero, y se arreglan dos cosas que antes se resolvían a ojo:
 *
 *   · UNA CITA QUE SE SALE DE LA REJILLA SE RECORTA, no se dibuja fuera. La rejilla va de las 08:00 a las 21:00; en producción hay una cita de 13 horas que acababa
 *     después de las 21:00, y antes su bloque se salía por debajo de la columna y se montaba encima de lo que hubiera. Una que cae entera fuera del horario no se pinta
 *     (no cabe), en vez de salir con altura negativa y colocarse en cualquier sitio.
 *   · LAS QUE CRUZAN LA MEDIANOCHE llegan hasta el final de la rejilla, no hasta una hora negativa.
 *
 * Es puro: no toca la base ni el navegador.
 */

import { format, isSameDay } from 'date-fns'
import { toMadrid } from '@/lib/timezone'
import { layoutOverlappingEvents } from '@/lib/calendar-layout'

export interface Rejilla {
  /** Primera hora que se pinta (08 = a las 08:00) */
  inicioDia: number
  /** Hora en la que acaba la rejilla (21 = a las 21:00) */
  finDia: number
  /** Píxeles que mide una hora */
  alturaHora: number
  /** Lo mínimo que mide un bloque, para que una cita corta se pueda leer y pinchar */
  alturaMinima: number
}

export const REJILLA: Rejilla = { inicioDia: 8, finDia: 21, alturaHora: 64, alturaMinima: 26 }

export interface Colocada<T> {
  cita: T
  col: number
  totalCols: number
  top: number
  height: number
  /** «10:30», la hora de inicio en España */
  hora: string
}

/** «2026-10-28»: el día de España en el que EMPIEZA la cita. Con él se reparten las citas entre las columnas de la semana */
export function claveDeDia(instante: Date | string): string {
  return format(toMadrid(instante), 'yyyy-MM-dd')
}

export function agruparPorDia<T extends { start_time: string }>(citas: T[]): Map<string, T[]> {
  const dias = new Map<string, T[]>()
  for (const c of citas) {
    const clave = claveDeDia(c.start_time)
    const dia = dias.get(clave)
    if (dia) dia.push(c)
    else dias.set(clave, [c])
  }
  return dias
}

export function colocarCitas<T extends { start_time: string; end_time: string }>(citas: T[], rejilla: Rejilla = REJILLA): Colocada<T>[] {
  const { inicioDia, finDia, alturaHora, alturaMinima } = rejilla
  const alto = (finDia - inicioDia) * 60
  const colocadas: Colocada<T>[] = []

  const repartidas = layoutOverlappingEvents(
    citas,
    (c) => new Date(c.start_time).getTime(),
    (c) => new Date(c.end_time).getTime()
  )

  for (const { event: cita, col, totalCols } of repartidas) {
    const inicio = toMadrid(cita.start_time)
    const fin = toMadrid(cita.end_time)
    const minutoDeInicio = (inicio.getHours() - inicioDia) * 60 + inicio.getMinutes()
    // Si acaba otro día, llega hasta el final de la rejilla: «las 00:30» no es antes de las 08:00 de ESE día
    const minutoDeFin = isSameDay(inicio, fin) ? (fin.getHours() - inicioDia) * 60 + fin.getMinutes() : alto
    const desde = Math.min(Math.max(minutoDeInicio, 0), alto)
    const hasta = Math.min(Math.max(minutoDeFin, 0), alto)
    // Entera fuera del horario (o de duración cero y fuera): no cabe en la rejilla
    if (minutoDeInicio >= alto || minutoDeFin <= 0) continue
    colocadas.push({
      cita,
      col,
      totalCols,
      top: (desde / 60) * alturaHora,
      height: Math.max(((hasta - desde) / 60) * alturaHora, alturaMinima),
      hora: format(inicio, 'HH:mm'),
    })
  }
  return colocadas
}

/**
 * A qué hora de la rejilla corresponde un punto de la columna (en píxeles desde su borde de arriba), redondeado al tramo de media hora MÁS CERCANO — pinchar a
 * las 10:20 agenda a las 10:30, como siempre. Nunca sale de la rejilla: el último hueco que se puede elegir es el de las 20:30.
 *
 * La rejilla sigue en tramos de media hora a propósito aunque las citas de un comercial duren una hora (lib/agenda/duracion.ts): eso es dónde EMPIEZA una cita.
 */
export function huecoDeLaRejilla(desdeArriba: number, rejilla: Rejilla = REJILLA): { hour: number; minute: number } {
  const minutos = (desdeArriba / rejilla.alturaHora) * 60
  const ajustado = Math.min(Math.max(Math.round(minutos / 30) * 30, 0), (rejilla.finDia - rejilla.inicioDia) * 60 - 30)
  return { hour: rejilla.inicioDia + Math.floor(ajustado / 60), minute: ajustado % 60 }
}

/** Los píxeles desde el borde de arriba de la columna hasta una hora de pared */
export function alturaDeLaHora(hour: number, minute: number, rejilla: Rejilla = REJILLA): number {
  return (((hour - rejilla.inicioDia) * 60 + minute) / 60) * rejilla.alturaHora
}
