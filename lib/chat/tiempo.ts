/**
 * LAS HORAS EN ESPAÑA — PURO.
 *
 * «Mañana a las 9» es a las 9 de Madrid, esté donde esté el servidor (que va en UTC) y cambie o no la hora de verano. Aquí se pasa de «día y hora de Madrid» al instante real y al
 * revés, sin depender de la zona del ordenador.
 */

const ZONA = 'Europe/Madrid'

export interface ParteDeFecha {
  anio: number
  mes: number
  dia: number
  hora: number
  minuto: number
  /** 0 = domingo … 6 = sábado */
  diaDeSemana: number
}

const formato = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
const SEMANA = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Qué día y hora es en Madrid en un instante */
export function partesEnMadrid(ms: number): ParteDeFecha {
  const p = Object.fromEntries(formato.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  return { anio: Number(p.year), mes: Number(p.month), dia: Number(p.day), hora: Number(p.hour) % 24, minuto: Number(p.minute), diaDeSemana: Math.max(0, SEMANA.indexOf(p.weekday)) }
}

/** El instante (en ms) en el que en Madrid son esa fecha y esa hora. Si la hora no existe (el salto de primavera) se toma la siguiente; si se repite (el de otoño), la primera */
export function instanteEnMadrid(anio: number, mes: number, dia: number, hora: number, minuto = 0): number {
  const base = Date.UTC(anio, mes - 1, dia, hora, minuto)
  // Dos pasadas: el desfase de Madrid en ese momento (+1 o +2 h) depende del propio instante
  let candidato = base - 2 * 3_600_000
  for (let i = 0; i < 3; i++) {
    const p = partesEnMadrid(candidato)
    const desfaseMin = (Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto) - candidato) / 60_000
    candidato = base - desfaseMin * 60_000
  }
  return candidato
}

/** Esta hora de Madrid, N días después de la fecha dada (por días de calendario: respeta los cambios de hora) */
export function horaDeMadridEnDias(ahora: number, dias: number, hora: number, minuto = 0): number {
  const p = partesEnMadrid(ahora)
  const d = new Date(Date.UTC(p.anio, p.mes - 1, p.dia + dias))
  return instanteEnMadrid(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hora, minuto)
}

/** Cuántos días faltan hasta el próximo lunes (si hoy es lunes, 7) */
export const diasHastaElLunes = (diaDeSemana: number): number => ((8 - diaDeSemana) % 7 || 7)

/** El final del día de hoy en Madrid (23:59) */
export function finDelDia(ahora: number): number {
  return horaDeMadridEnDias(ahora, 0, 23, 59)
}

/** El domingo de esta semana a las 23:59, hora de Madrid */
export function finDeLaSemana(ahora: number): number {
  const p = partesEnMadrid(ahora)
  const hastaDomingo = p.diaDeSemana === 0 ? 0 : 7 - p.diaDeSemana
  return horaDeMadridEnDias(ahora, hastaDomingo, 23, 59)
}

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const dosDigitos = (n: number) => String(n).padStart(2, '0')

/** «hoy a las 17:30», «mañana a las 9:00», «el lunes a las 9:00», «el 12/11 a las 9:00» */
export function describirInstante(ms: number, ahora: number = Date.now()): string {
  const p = partesEnMadrid(ms)
  const hoy = partesEnMadrid(ahora)
  const hora = `${p.hora}:${dosDigitos(p.minuto)}`
  const diferencia = Math.round((Date.UTC(p.anio, p.mes - 1, p.dia) - Date.UTC(hoy.anio, hoy.mes - 1, hoy.dia)) / 86_400_000)
  if (diferencia === 0) return `hoy a las ${hora}`
  if (diferencia === 1) return `mañana a las ${hora}`
  if (diferencia > 1 && diferencia < 7) return `el ${DIAS[p.diaDeSemana]} a las ${hora}`
  return `el ${dosDigitos(p.dia)}/${dosDigitos(p.mes)}${p.anio !== hoy.anio ? `/${p.anio}` : ''} a las ${hora}`
}

/** El valor de un `<input type="datetime-local">` («2026-11-12T09:00») a un instante, entendiéndolo como hora de Madrid. null si no es válido */
export function desdeCampoDeFecha(valor: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(valor)
  if (!m) return null
  const [anio, mes, dia, hora, minuto] = m.slice(1).map(Number)
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || hora > 23 || minuto > 59) return null
  return instanteEnMadrid(anio, mes, dia, hora, minuto)
}

/** Un instante al valor de un `<input type="datetime-local">`, en hora de Madrid */
export function haciaCampoDeFecha(ms: number): string {
  const p = partesEnMadrid(ms)
  return `${p.anio}-${dosDigitos(p.mes)}-${dosDigitos(p.dia)}T${dosDigitos(p.hora)}:${dosDigitos(p.minuto)}`
}
