/**
 * LOS DÍAS, EN LA HORA DE QUIEN MIRA.
 * PURO. Se prueba en dia.prueba.ts.
 *
 * Un día de actividad es de medianoche a medianoche EN SU ZONA: el mismo instante es «lunes 23:30» en Bogotá y «martes
 * 05:30» en Madrid. Las filas se guardan en UTC y aquí se decide dónde empieza y dónde acaba el día que se está mirando.
 * Hay días de 23 y de 25 horas (cambio de hora en Madrid) y no se suman 24 h a ciegas: se pregunta a `Intl`.
 */

/** Las zonas que se ofrecen: dónde está el equipo y dónde está quien mira */
export const ZONAS: ReadonlyArray<{ id: string; nombre: string }> = [
  { id: 'America/Bogota', nombre: 'Colombia' },
  { id: 'Europe/Madrid', nombre: 'España' },
  { id: 'Asia/Dubai', nombre: 'Dubái' },
]

export const FECHA = /^\d{4}-\d{2}-\d{2}$/

const pad = (n: number) => String(n).padStart(2, '0')

export function zonaValida(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz === '' || tz.length > 60) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

function partes(ms: number, tz: string) {
  const formato = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const o: Record<string, number> = {}
  for (const p of formato.formatToParts(new Date(ms))) if (p.type !== 'literal') o[p.type] = Number(p.value)
  // Algunos motores devuelven «24» a medianoche aun con h23
  if (o.hour === 24) o.hour = 0
  return { year: o.year, month: o.month, day: o.day, hour: o.hour, minute: o.minute, second: o.second }
}

/** Cuánto se adelanta (o atrasa) la hora de esa zona respecto a UTC en ese instante, en ms */
export function desfaseMs(tz: string, ms: number): number {
  const p = partes(ms, tz)
  const comoUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return comoUtc - Math.floor(ms / 1000) * 1000
}

/** «2026-10-23» + 1 -> «2026-10-24». Aritmética de calendario pura, sin zonas */
export function sumarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + dias)).toISOString().slice(0, 10)
}

/** El instante (UTC, en ms) en que empieza ese día en esa zona */
export function inicioDelDiaMs(fecha: string, tz: string): number {
  const [y, m, d] = fecha.split('-').map(Number)
  const medianocheComoUtc = Date.UTC(y, m - 1, d)
  // Dos pasadas: la segunda corrige el caso en que el cambio de hora cae entre las dos
  const primera = medianocheComoUtc - desfaseMs(tz, medianocheComoUtc)
  return medianocheComoUtc - desfaseMs(tz, primera)
}

/** El instante en que EMPIEZA el día siguiente (el final, sin incluir, de este) */
export function finDelDiaMs(fecha: string, tz: string): number {
  return inicioDelDiaMs(sumarDias(fecha, 1), tz)
}

/** El día de calendario («2026-10-23») que es ese instante en esa zona */
export function fechaDeMs(ms: number, tz: string): string {
  const p = partes(ms, tz)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** «09:05», en 24 horas y en esa zona */
export function horaDeMs(ms: number, tz: string): string {
  const p = partes(ms, tz)
  return `${pad(p.hour)}:${pad(p.minute)}`
}

/** «jueves 23 de octubre» */
export function etiquetaDeFecha(fecha: string): string {
  const [y, m, d] = fecha.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
}

/** «hoy 08:12», «ayer 17:40», «21 oct 09:00» (`hoy` es el día de calendario de ahora, en la misma zona) */
export function fechaCorta(ms: number, zona: string, hoy: string): string {
  const dia = fechaDeMs(ms, zona)
  const hora = horaDeMs(ms, zona)
  if (dia === hoy) return `hoy ${hora}`
  if (dia === sumarDias(hoy, -1)) return `ayer ${hora}`
  const [y, m, d] = dia.split('-').map(Number)
  const mes = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es-ES', { month: 'short', timeZone: 'UTC' }).replace('.', '')
  return `${d} ${mes} ${hora}`
}

/** «2 h 05 min», «45 min», «0 min» */
export function duracion(minutos: number): string {
  const m = Math.max(0, Math.round(minutos))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r === 0 ? `${h} h` : `${h} h ${pad(r)} min`
}

/** Cuántos días atrás se puede mirar: el registro se purga a los 90, y se deja un margen */
export const DIAS_MAXIMOS_ATRAS = 100

/**
 * LA VENTANA QUE UNA PETICIÓN PUEDE PEDIR.
 *
 * Dos instantes en ms, `desde` < `hasta`, de como mucho 49 horas (un día de 25 h y un margen), que no sean del futuro
 * lejano ni de antes de lo que se guarda. Cualquier otra cosa, null: una petición con una ventana de diez años haría
 * leer la tabla entera.
 */
export function ventanaValida(desde: unknown, hasta: unknown, ahoraMs: number): { desde: number; hasta: number } | null {
  const d = typeof desde === 'string' && desde.trim() !== '' ? Number(desde) : typeof desde === 'number' ? desde : NaN
  const h = typeof hasta === 'string' && hasta.trim() !== '' ? Number(hasta) : typeof hasta === 'number' ? hasta : NaN
  if (!Number.isFinite(d) || !Number.isFinite(h)) return null
  if (h <= d || h - d > 49 * 3_600_000) return null
  if (d < ahoraMs - DIAS_MAXIMOS_ATRAS * 86_400_000) return null
  if (d > ahoraMs + 2 * 86_400_000) return null
  return { desde: Math.floor(d), hasta: Math.floor(h) }
}
