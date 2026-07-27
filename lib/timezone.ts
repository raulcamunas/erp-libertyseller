import { toZonedTime, fromZonedTime } from 'date-fns-tz'

/**
 * Toda la agenda opera siempre en hora de España, sea cual sea el
 * huso horario del navegador de quien la mire (comerciales en
 * Latinoamérica incluidos).
 */
export const APP_TIMEZONE = 'Europe/Madrid'

/**
 * Convierte un instante (ISO string o Date) a un Date cuyos getters
 * locales (getHours, getDate, getDay...) devuelven la hora de pared en
 * España. A partir de aquí se puede usar con normalidad `format()`,
 * `isSameDay()`, etc. de date-fns — NUNCA volver a serializar este
 * resultado con `.toISOString()` para enviarlo a la API (usar
 * `fromMadrid` para eso).
 */
export function toMadrid(date: Date | string): Date {
  return toZonedTime(date, APP_TIMEZONE)
}

/**
 * Inversa de `toMadrid`: dado un string de hora de pared sin offset
 * ("yyyy-MM-ddTHH:mm:ss", interpretado como hora de España), devuelve
 * el instante real (Date) que representa. Es lo que hay que usar para
 * construir cualquier fecha/hora que el usuario haya elegido pensando
 * en hora de España, antes de guardarla.
 */
export function fromMadrid(wallClock: string): Date {
  return fromZonedTime(wallClock, APP_TIMEZONE)
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * Construye el string de hora de pared "yyyy-MM-ddTHH:mm:00" a partir
 * de un Date ya anclado a España (obtenido con `toMadrid`) y una
 * hora/minuto — listo para pasar a `fromMadrid`.
 */
export function madridWallClockString(dayInMadrid: Date, hour: number, minute: number): string {
  const y = dayInMadrid.getFullYear()
  const m = pad(dayInMadrid.getMonth() + 1)
  const d = pad(dayInMadrid.getDate())
  return `${y}-${m}-${d}T${pad(hour)}:${pad(minute)}:00`
}
