/**
 * CÓMO SE ESCRIBEN LAS FECHAS Y LOS TAMAÑOS EN CORREO.
 * ====================================================
 * PURO y sin dependencias: lo usa la pantalla. Se comprueba con formato.prueba.ts.
 *
 * Las fechas se cuentan en hora de Madrid, que es la del equipo, y no en la del ordenador de quien mira: un correo de las
 * 23:50 no puede salir como «hoy» para uno y «ayer» para otro.
 */

const MADRID = 'Europe/Madrid'

const SOLO_DIA = new Intl.DateTimeFormat('en-CA', { timeZone: MADRID, year: 'numeric', month: '2-digit', day: '2-digit' })
const HORA = new Intl.DateTimeFormat('es-ES', { timeZone: MADRID, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const DIA_DE_LA_SEMANA = new Intl.DateTimeFormat('es-ES', { timeZone: MADRID, weekday: 'short' })
const DIA_Y_MES = new Intl.DateTimeFormat('es-ES', { timeZone: MADRID, day: 'numeric', month: 'short' })
const COMPLETA = new Intl.DateTimeFormat('es-ES', { timeZone: MADRID, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const NUMERICA = new Intl.DateTimeFormat('es-ES', { timeZone: MADRID, day: '2-digit', month: '2-digit', year: '2-digit' })

const sinPunto = (s: string) => s.replace(/\.$/, '')

/** Cuántos días de calendario (en Madrid) hay de `a` a `b` */
function diasEntre(desde: Date, hasta: Date): number {
  const [ya, ma, da] = SOLO_DIA.format(desde).split('-').map(Number)
  const [yb, mb, db] = SOLO_DIA.format(hasta).split('-').map(Number)
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86_400_000)
}

/**
 * La fecha de una fila de la lista, lo más corta que se entienda: la hora si es de hoy, «ayer», el día de la semana si
 * es de esta semana, «21 oct» si es de este año y «21/10/25» si es de antes.
 */
export function fechaDeLista(iso: string, ahora: Date = new Date()): string {
  const f = new Date(iso)
  if (!Number.isFinite(f.getTime())) return ''
  const dias = diasEntre(f, ahora)
  if (dias <= 0) return HORA.format(f)
  if (dias === 1) return 'ayer'
  if (dias < 7) return sinPunto(DIA_DE_LA_SEMANA.format(f))
  if (SOLO_DIA.format(f).slice(0, 4) === SOLO_DIA.format(ahora).slice(0, 4)) return sinPunto(DIA_Y_MES.format(f))
  return NUMERICA.format(f)
}

/** «21 oct 2026, 10:15» */
export function fechaCompleta(iso: string): string {
  const f = new Date(iso)
  return Number.isFinite(f.getTime()) ? COMPLETA.format(f).replace(/\./g, '') : ''
}

/** «48 KB», «1,2 MB» */
export function tamanoLegible(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  const mb = bytes / (1024 * 1024)
  return `${mb < 10 ? mb.toFixed(1).replace('.', ',') : Math.round(mb)} MB`
}
