/**
 * LOS DÍAS Y LOS «HACE CUÁNTO» DE COLD CALLING.
 * =============================================
 * PURO. Se comprueba con fechas.prueba.ts. Lo usa el navegador.
 *
 * `next_call_date` («Rellamar el») es un DÍA DEL CALENDARIO, no un instante: se escribe con un <input type="date"> y es el
 * día que ve en su calendario quien lo apunta. Por eso «hoy» aquí es el día local de quien mira la pantalla, no el de
 * UTC: en España vamos por delante de UTC —dos horas en verano—, así que entre las 00:00 y las 02:00 el «hoy» de UTC todavía
 * es ayer y las rellamadas de hoy no saldrían hasta las dos de la madrugada. (Las llamadas de Rinkel, que sí son instantes,
 * se agrupan por días de Madrid en lib/rendimiento/dia.ts: son dos cosas distintas.)
 */

const dos = (n: number) => String(n).padStart(2, '0')

/** El día de HOY en el calendario de quien mira, «2026-10-22». `fecha` solo se pasa en las pruebas */
export function diaLocal(fecha: Date = new Date()): string {
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`
}

function partes(dia: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dia)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** El día `n` días después (o antes) de otro. Aritmética de calendario: nunca se suman 86.400.000 ms, que fallan en los cambios de hora */
export function sumarDias(dia: string, n: number): string {
  const p = partes(dia)
  if (!p) return dia
  return diaLocal(new Date(p[0], p[1] - 1, p[2] + n))
}

/** Cuántos días hay de `desde` a `hasta` (negativo si `hasta` es anterior). Contados en el calendario, no en milisegundos */
export function diasEntre(desde: string, hasta: string): number {
  const a = partes(desde)
  const b = partes(hasta)
  if (!a || !b) return 0
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86_400_000)
}

const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const DIAS_DE_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']

/** «12 de agosto», para los títulos */
export function diaLargo(dia: string): string {
  const p = partes(dia)
  return p ? `${p[2]} de ${MESES_LARGOS[p[1] - 1]}` : dia
}

/** «jueves 22 de octubre» */
export function diaConSemana(dia: string): string {
  const p = partes(dia)
  if (!p) return dia
  return `${DIAS_DE_SEMANA[new Date(p[0], p[1] - 1, p[2]).getDay()]} ${p[2]} de ${MESES_LARGOS[p[1] - 1]}`
}

/** Cómo está una rellamada respecto a hoy */
export type Vencimiento = { tipo: 'atrasada'; dias: number } | { tipo: 'hoy' } | { tipo: 'manana' } | { tipo: 'futura'; dias: number }

export function vencimientoDe(fecha: string | null, hoy: string): Vencimiento | null {
  // Sin «hoy» (el servidor no sabe en qué calendario está quien mira) no se puede decir cómo está: mejor nada que decir «hoy» por error
  if (!fecha || !partes(fecha) || !partes(hoy)) return null
  const d = diasEntre(hoy, fecha)
  if (d < 0) return { tipo: 'atrasada', dias: -d }
  if (d === 0) return { tipo: 'hoy' }
  if (d === 1) return { tipo: 'manana' }
  return { tipo: 'futura', dias: d }
}

/** «hoy», «mañana», «atrasada 3 d», «12 nov» */
export function etiquetaDeVencimiento(fecha: string | null, hoy: string): string {
  const v = vencimientoDe(fecha, hoy)
  if (!v || !fecha) return ''
  if (v.tipo === 'hoy') return 'hoy'
  if (v.tipo === 'manana') return 'mañana'
  if (v.tipo === 'atrasada') return `atrasada ${v.dias} d`
  const p = partes(fecha)!
  return `${p[2]} ${MESES_CORTOS[p[1] - 1]}`
}

/**
 * «ahora», «hace 12 min», «hace 3 h», «hace 5 d» y, pasadas dos semanas, la fecha («3 oct» o «3 oct 2025» si es de otro año).
 * Son instantes, así que se miden en milisegundos; los días del calendario no importan aquí.
 */
export function haceCuanto(instante: string | number | Date, ahora: number = Date.now()): string {
  const t = instante instanceof Date ? instante.getTime() : typeof instante === 'number' ? instante : Date.parse(instante)
  if (Number.isNaN(t)) return ''
  const minutos = Math.floor((ahora - t) / 60_000)
  if (minutos < 1) return 'ahora'
  if (minutos < 60) return `hace ${minutos} min`
  const horas = Math.floor(minutos / 60)
  if (horas < 24) return `hace ${horas} h`
  const dias = Math.floor(horas / 24)
  if (dias < 14) return `hace ${dias} d`
  const f = new Date(t)
  const mismoAnio = f.getFullYear() === new Date(ahora).getFullYear()
  return `${f.getDate()} ${MESES_CORTOS[f.getMonth()]}${mismoAnio ? '' : ` ${f.getFullYear()}`}`
}
