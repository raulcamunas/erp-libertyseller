/**
 * LAS SEMANAS DE LA AGENDA, EN HORA DE ESPAÑA.
 * =============================================
 * La agenda ya no se baja entera: la página trae la semana que se mira y las dos de al lado, y el resto se pide al navegar. Para pedir «una semana» a la base hace
 * falta saber entre qué dos instantes cae, y ese cálculo tiene dos trampas que por eso viven aquí, con su prueba, y no repartidas por la pantalla:
 *
 *   · LA SEMANA ES LA DE ESPAÑA, no la del navegador. Un comercial en Colombia que abre la agenda a las 20:00 del domingo está ya en el lunes de Madrid.
 *   · LA SEMANA DEL CAMBIO DE HORA NO DURA 168 HORAS. La del 19 al 25 de octubre de 2026 dura 169 y la del 23 al 29 de marzo, 167. Sumar siete días en milisegundos corre
 *     el límite una hora y deja fuera —o mete de más— las citas de la madrugada del lunes. Se construye siempre desde la hora de pared («lunes a las 00:00 en Madrid»).
 *
 * Es puro: no toca la base ni la red. Lo usan la página del servidor y la pantalla del navegador.
 */

import { addDays, format, startOfWeek } from 'date-fns'
import { fromMadrid, madridWallClockString, toMadrid } from '@/lib/timezone'

/**
 * El lunes (a las 00:00, hora de pared de España) de la semana que contiene `instante`.
 * Es un Date «anclado a España», como lo que devuelve toMadrid: sus getters dan la hora de pared de Madrid. NO se serializa con toISOString: para eso, limitesDeSemanas.
 */
export function lunesDeLaSemana(instante: Date | string): Date {
  const lunes = startOfWeek(toMadrid(instante), { weekStartsOn: 1 })
  lunes.setHours(0, 0, 0, 0)
  return lunes
}

/** «2026-10-26»: lo que identifica a una semana en la memoria de la pantalla */
export function claveDeSemana(lunes: Date): string {
  return format(lunes, 'yyyy-MM-dd')
}

/** La clave de la semana en la que cae un instante (el `start_time` de una cita) */
export function claveDeInstante(instante: Date | string): string {
  return claveDeSemana(lunesDeLaSemana(instante))
}

/**
 * De «2026-10-26» al lunes de esa semana (anclado a España, como lunesDeLaSemana). null si no es una fecha de verdad: quien lo recibe de fuera no se fía,
 * y «2026-02-31» no se corrige a marzo en silencio.
 */
export function lunesDeLaClave(clave: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clave)
  if (!m) return null
  const fecha = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0)
  if (Number.isNaN(fecha.getTime()) || fecha.getMonth() !== Number(m[2]) - 1) return null
  const lunes = startOfWeek(fecha, { weekStartsOn: 1 })
  lunes.setHours(0, 0, 0, 0)
  return lunes
}

/**
 * Los dos instantes reales (UTC, en ISO) que encierran `semanas` semanas seguidas desde `lunes`: del lunes a las 00:00 de Madrid al lunes siguiente a las 00:00.
 * `desde` entra y `hasta` no (la consulta es `>= desde` y `< hasta`), así que una cita a las 00:00 del lunes siguiente cae en la semana de después y no en dos.
 */
export function limitesDeSemanas(lunes: Date, semanas = 1): { desde: string; hasta: string } {
  const siguiente = addDays(lunes, 7 * semanas)
  return {
    desde: fromMadrid(madridWallClockString(lunes, 0, 0)).toISOString(),
    hasta: fromMadrid(madridWallClockString(siguiente, 0, 0)).toISOString(),
  }
}

/** Los lunes de las semanas desde `antes` semanas atrás hasta `despues` adelante, con la de `lunes` en medio */
export function semanasAlrededor(lunes: Date, antes: number, despues: number): Date[] {
  const semanas: Date[] = []
  for (let i = -antes; i <= despues; i++) semanas.push(addDays(lunes, 7 * i))
  return semanas
}

export interface TramoDeSemanas {
  /** El lunes de la primera semana del tramo */
  lunes: Date
  semanas: number
}

/**
 * Junta semanas sueltas en tramos seguidos, para pedir cada tramo con UNA consulta: si faltan la anterior y la siguiente de la que se mira
 * son dos consultas, pero si faltan las dos siguientes es una sola. Las repetidas cuentan una vez y el orden de entrada no importa.
 */
export function tramosDeSemanas(lunes: Date[]): TramoDeSemanas[] {
  const unicas = new Map<string, Date>()
  for (const l of lunes) unicas.set(claveDeSemana(l), l)
  const ordenadas = [...unicas.values()].sort((a, b) => a.getTime() - b.getTime())
  const tramos: TramoDeSemanas[] = []
  for (const l of ordenadas) {
    const ultimo = tramos[tramos.length - 1]
    if (ultimo && claveDeSemana(addDays(ultimo.lunes, 7 * ultimo.semanas)) === claveDeSemana(l)) ultimo.semanas += 1
    else tramos.push({ lunes: l, semanas: 1 })
  }
  return tramos
}
