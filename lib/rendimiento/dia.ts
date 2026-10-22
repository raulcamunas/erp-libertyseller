/**
 * LOS DÍAS DEL PANEL DE RENDIMIENTO, SIEMPRE EN HORA DE MADRID.
 * =============================================================
 * PURO. Se comprueba con dia.prueba.ts. Lo usan el servidor y el navegador.
 *
 * Rinkel da cada llamada con su instante en UTC («2026-10-21T12:01:26.352Z») y un comercial
 * piensa en días de Madrid: la llamada de las 00:30 del 22 es del 22, aunque en UTC sea la
 * 22:30 del 21. Si el día se sacara cortando el texto ISO, esas llamadas caerían en el día
 * equivocado SIN dar ningún error, y los dos cambios de hora del año las mueven además una hora
 * en un sentido y en otro.
 *
 * Un día se identifica por su fecha civil, `'2026-10-21'`. Lo que sale de aquí son instantes
 * (Date) para filtrar contra la base y fechas civiles para pintar; nunca se suma «86.400.000 ms»
 * para pasar de un día al siguiente, porque el 25 de octubre dura 25 horas y el 29 de marzo, 23.
 */

export const ZONA = 'Europe/Madrid'

const partesDeFecha = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

interface Partes {
  y: number
  m: number
  d: number
  h: number
  mi: number
  s: number
}

function partes(instante: Date): Partes {
  const p: Record<string, number> = {}
  for (const parte of partesDeFecha.formatToParts(instante)) {
    if (parte.type !== 'literal') p[parte.type] = Number(parte.value)
  }
  return { y: p.year, m: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second }
}

const dos = (n: number) => String(n).padStart(2, '0')

/** El día de Madrid al que pertenece un instante: 'YYYY-MM-DD' */
export function diaMadrid(instante: string | number | Date): string {
  const p = partes(new Date(instante))
  return `${p.y}-${dos(p.m)}-${dos(p.d)}`
}

/** El día de hoy en Madrid. `ahora` solo se pasa en las pruebas */
export function hoyMadrid(ahora: Date = new Date()): string {
  return diaMadrid(ahora)
}

/** Cuánto va Madrid por delante de UTC en ese instante, en minutos (60 en invierno, 120 en verano) */
function desfaseEnMinutos(instante: Date): number {
  const p = partes(instante)
  const comoSiFueraUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s)
  return Math.round((comoSiFueraUtc - Math.floor(instante.getTime() / 1000) * 1000) / 60_000)
}

const DIA = /^(\d{4})-(\d{2})-(\d{2})$/

/** ¿Es una fecha civil real? '2026-02-31' no lo es */
export function esDia(texto: string): boolean {
  const m = DIA.exec(texto)
  if (!m) return false
  const f = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return f.getUTCFullYear() === Number(m[1]) && f.getUTCMonth() === Number(m[2]) - 1 && f.getUTCDate() === Number(m[3])
}

function aPartesCiviles(dia: string): [number, number, number] {
  const m = DIA.exec(dia)
  if (!m) throw new Error(`«${dia}» no es un día con el formato AAAA-MM-DD`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** El día de Madrid `n` días después (o antes, con n negativo). Aritmética de calendario, no de milisegundos */
export function sumarDias(dia: string, n: number): string {
  const [y, m, d] = aPartesCiviles(dia)
  const f = new Date(Date.UTC(y, m - 1, d + n))
  return `${f.getUTCFullYear()}-${dos(f.getUTCMonth() + 1)}-${dos(f.getUTCDate())}`
}

/** El instante en que EMPIEZA ese día en Madrid (las 00:00 de allí, en UTC) */
export function inicioDelDia(dia: string): Date {
  const [y, m, d] = aPartesCiviles(dia)
  const medianocheSinCorregir = Date.UTC(y, m - 1, d)
  // La corrección depende del desfase del propio día, que a su vez depende de la corrección: dos pasadas
  // bastan porque el cambio de hora no cae nunca a medianoche (es a las 02:00 o a las 03:00)
  let candidato = medianocheSinCorregir
  for (let i = 0; i < 2; i += 1) candidato = medianocheSinCorregir - desfaseEnMinutos(new Date(candidato)) * 60_000
  return new Date(candidato)
}

/** [desde, hasta) del día: `hasta` es el comienzo del siguiente, así que no se cuenta dos veces nada */
export function rangoDelDia(dia: string): { desde: Date; hasta: Date } {
  return { desde: inicioDelDia(dia), hasta: inicioDelDia(sumarDias(dia, 1)) }
}

/** Los días de un mes, de 1 a 28/29/30/31. `mes` va de 1 a 12 */
export function diasDelMes(anio: number, mes: number): string[] {
  const dias = new Date(Date.UTC(anio, mes, 0)).getUTCDate()
  return Array.from({ length: dias }, (_, i) => `${anio}-${dos(mes)}-${dos(i + 1)}`)
}

/** [desde, hasta) de un mes entero */
export function rangoDelMes(anio: number, mes: number): { desde: Date; hasta: Date } {
  const dias = diasDelMes(anio, mes)
  return { desde: inicioDelDia(dias[0]), hasta: inicioDelDia(sumarDias(dias[dias.length - 1], 1)) }
}

/** El mes al que pertenece un día: { anio, mes } con mes de 1 a 12 */
export function mesDe(dia: string): { anio: number; mes: number } {
  const [y, m] = aPartesCiviles(dia)
  return { anio: y, mes: m }
}

/** El mes `n` meses después (o antes) de otro, con el desbordamiento de año resuelto */
export function sumarMeses(anio: number, mes: number, n: number): { anio: number; mes: number } {
  const total = anio * 12 + (mes - 1) + n
  return { anio: Math.floor(total / 12), mes: (total % 12) + 1 }
}

/** Posición del día en la semana empezando en lunes: lunes = 0 … domingo = 6 */
export function indiceDeSemana(dia: string): number {
  const [y, m, d] = aPartesCiviles(dia)
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const DIAS_DE_SEMANA = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

/** «octubre 2026» */
export function etiquetaDeMes(anio: number, mes: number): string {
  return `${MESES[mes - 1]} ${anio}`
}

/** «miércoles 21 de octubre». Con `conAnio`, «miércoles 21 de octubre de 2026» */
export function etiquetaDeDia(dia: string, conAnio = false): string {
  const [y, m, d] = aPartesCiviles(dia)
  return `${DIAS_DE_SEMANA[indiceDeSemana(dia)]} ${d} de ${MESES[m - 1]}${conAnio ? ` de ${y}` : ''}`
}

/** La hora de un instante en Madrid, «14:01» */
export function horaMadrid(instante: string | number | Date): string {
  const p = partes(new Date(instante))
  return `${dos(p.h)}:${dos(p.mi)}`
}
