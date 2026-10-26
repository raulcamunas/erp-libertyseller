/**
 * LOS DÍAS Y LAS HORAS DE LAS SECUENCIAS, SIEMPRE EN HORA DE MADRID.
 * ==================================================================
 * PURO: no toca la base ni la red. Se comprueba con fechas.prueba.ts.
 *
 * El equipo trabaja con horario de España aunque haya quien lo mire desde Latinoamérica (lib/timezone.ts), y los leads son empresas
 * españolas: «de 9 a 18» y «a los 3 días hábiles» se cuentan en Madrid. Aquí se hace SIN librerías (solo `Intl`) para que lo mismo valga en
 * el servidor, en el navegador y en las pruebas, y se comprueba con los dos cambios de hora del año: el de octubre (un día de 25 horas) y el
 * de marzo (uno de 23).
 *
 * Un DÍA es el texto «2026-10-23» (el día de pared en Madrid). Una HORA es un número de MINUTOS desde la medianoche de ese día (540 = 9:00).
 * Un INSTANTE es un número de milisegundos desde 1970, como `Date.now()`.
 */

export const ZONA = 'Europe/Madrid'
const UN_DIA_MS = 86_400_000

const formato = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONA,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

export interface PartesDeMadrid {
  dia: string
  anio: number
  mes: number
  diaDelMes: number
  /** 0 = domingo … 6 = sábado */
  diaDeLaSemana: number
  hora: number
  minuto: number
  segundo: number
  /** Minutos desde la medianoche */
  minutos: number
}

/** Qué día y qué hora de pared es en Madrid un instante */
export function partesDeMadrid(instante: number): PartesDeMadrid {
  const partes: Record<string, string> = {}
  for (const p of formato.formatToParts(new Date(instante))) partes[p.type] = p.value
  const anio = Number(partes.year)
  const mes = Number(partes.month)
  const diaDelMes = Number(partes.day)
  const hora = Number(partes.hour)
  const minuto = Number(partes.minute)
  const segundo = Number(partes.second)
  const dia = `${partes.year}-${partes.month}-${partes.day}`
  return { dia, anio, mes, diaDelMes, diaDeLaSemana: new Date(Date.UTC(anio, mes - 1, diaDelMes)).getUTCDay(), hora, minuto, segundo, minutos: hora * 60 + minuto }
}

export const diaDeMadrid = (instante: number): string => partesDeMadrid(instante).dia

const REGEX_DIA = /^(\d{4})-(\d{2})-(\d{2})$/

export function esDia(texto: unknown): texto is string {
  if (typeof texto !== 'string') return false
  const m = REGEX_DIA.exec(texto)
  if (!m) return false
  const f = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return f.getUTCFullYear() === Number(m[1]) && f.getUTCMonth() === Number(m[2]) - 1 && f.getUTCDate() === Number(m[3])
}

function aUtc(dia: string): number {
  const m = REGEX_DIA.exec(dia)
  if (!m) throw new Error(`Día no válido: ${dia}`)
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

const deUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/** El día de la semana de un día de calendario: 0 = domingo … 6 = sábado */
export const diaDeLaSemana = (dia: string): number => new Date(aUtc(dia)).getUTCDay()

/** Suma (o resta) días de calendario a un día */
export const sumarDias = (dia: string, n: number): string => deUtc(aUtc(dia) + n * UN_DIA_MS)

/** Cuántos días de calendario hay de `a` a `b` (positivo si b es posterior) */
export const diasEntre = (a: string, b: string): number => Math.round((aUtc(b) - aUtc(a)) / UN_DIA_MS)

/** El instante en que, en Madrid, son las `minutos` (desde la medianoche) del `dia`. Vale también con las horas que no existen o se repiten por el cambio de hora */
export function instanteDeMadrid(dia: string, minutos: number): number {
  const base = aUtc(dia) + minutos * 60_000
  // Se parte de «como si Madrid fuera UTC» y se corrige con el desfase que Madrid tiene en ese momento (dos pasadas: la segunda cubre el salto de la hora)
  let instante = base
  for (let i = 0; i < 3; i++) {
    const p = partesDeMadrid(instante)
    const comoUtc = Date.UTC(p.anio, p.mes - 1, p.diaDelMes, p.hora, p.minuto, p.segundo)
    const desfase = comoUtc - instante
    const siguiente = base - desfase
    if (siguiente === instante) break
    instante = siguiente
  }
  return instante
}

/* ------------------------------------------------------------------ */
/* Días hábiles                                                        */
/* ------------------------------------------------------------------ */

/** Un día hábil es de lunes a viernes y que no esté en la lista de festivos */
export function esDiaHabil(dia: string, festivos: ReadonlySet<string> | readonly string[] = []): boolean {
  const s = diaDeLaSemana(dia)
  if (s === 0 || s === 6) return false
  return !(festivos instanceof Set ? festivos.has(dia) : (festivos as readonly string[]).includes(dia))
}

/** El primer día hábil que sea `dia` o posterior */
export function diaHabilDesde(dia: string, festivos: ReadonlySet<string> | readonly string[] = []): string {
  let d = dia
  for (let i = 0; i < 400 && !esDiaHabil(d, festivos); i++) d = sumarDias(d, 1)
  return d
}

/** El primer día hábil POSTERIOR a `dia` */
export const siguienteDiaHabil = (dia: string, festivos: ReadonlySet<string> | readonly string[] = []): string => diaHabilDesde(sumarDias(dia, 1), festivos)

/** Suma `n` días hábiles a un día (n = 0 devuelve el mismo día si es hábil, o el siguiente hábil si no lo es) */
export function sumarDiasHabiles(dia: string, n: number, festivos: ReadonlySet<string> | readonly string[] = []): string {
  let d = diaHabilDesde(dia, festivos)
  for (let i = 0; i < n; i++) d = siguienteDiaHabil(d, festivos)
  return d
}

/** Cuántos días hábiles hay desde `desde` hasta `hasta`, contando `desde` y sin contar `hasta` (0 si `hasta` no es posterior) */
export function diasHabilesEntre(desde: string, hasta: string, festivos: ReadonlySet<string> | readonly string[] = []): number {
  let n = 0
  for (let d = desde, i = 0; d < hasta && i < 2000; d = sumarDias(d, 1), i++) if (esDiaHabil(d, festivos)) n++
  return n
}

/* ------------------------------------------------------------------ */
/* Para enseñarlo                                                      */
/* ------------------------------------------------------------------ */

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** «jueves» */
export const nombreDelDia = (dia: string): string => DIAS[diaDeLaSemana(dia)]

/** «mié 28 oct» */
export function diaCorto(dia: string): string {
  const [, m, d] = dia.split('-').map(Number)
  return `${DIAS[diaDeLaSemana(dia)].slice(0, 3)} ${d} ${MESES[m - 1]}`
}

/** «10:42» en hora de Madrid */
export function horaDeMadrid(instante: number): string {
  const p = partesDeMadrid(instante)
  return `${String(p.hora).padStart(2, '0')}:${String(p.minuto).padStart(2, '0')}`
}

/** «9:00» a partir de minutos desde la medianoche */
export const horaDeMinutos = (minutos: number): string => `${Math.floor(minutos / 60)}:${String(minutos % 60).padStart(2, '0')}`

/** «hoy», «mañana» o «mié 28 oct» según lo lejos que esté el día de `ahora` */
export function diaRelativo(dia: string, ahora: number): string {
  const hoy = diaDeMadrid(ahora)
  const d = diasEntre(hoy, dia)
  if (d === 0) return 'hoy'
  if (d === 1) return 'mañana'
  if (d === -1) return 'ayer'
  return diaCorto(dia)
}
