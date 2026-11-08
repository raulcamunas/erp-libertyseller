/**
 * LAS TAREAS QUE SE REPITEN: cuándo toca la siguiente, cómo se titula y qué cuerpo lleva. PURO (se comprueba con recurrencia.prueba.ts).
 *
 * Todas las fechas son `AAAA-MM-DD` (el día de España que calcula el servidor) y las cuentas se hacen en UTC con el calendario, sin horas: así no hay saltos por el cambio de hora.
 *
 *   · laborable: de lunes a viernes.
 *   · semanal / quincenal: un día de la semana (1 = lunes … 7 = domingo), cada semana o cada dos.
 *   · mensual: un día del mes; si el mes no lo tiene (31 en abril) toca el último día.
 *
 * Si el servidor no pudo crear alguna ocurrencia (nadie abrió el ERP durante días), NO se crean todas de golpe: se crea solo la más reciente que ya tocó y se sigue desde ahí.
 */

import { nuevoIdDeBloque, type Bloque } from './bloques'

export type Recurrencia =
  | { tipo: 'ninguna' }
  | { tipo: 'laborable' }
  | { tipo: 'semanal'; diaSemana: number }
  | { tipo: 'quincenal'; diaSemana: number }
  | { tipo: 'mensual'; diaMes: number }

export const RECURRENCIA_NINGUNA: Recurrencia = { tipo: 'ninguna' }

const UTC = (f: string) => {
  const [a, m, d] = f.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d))
}
const aTexto = (d: Date) => d.toISOString().slice(0, 10)
export const sumarDias = (f: string, n: number): string => aTexto(new Date(UTC(f).getTime() + n * 86_400_000))
/** 1 = lunes … 7 = domingo */
export const diaDeLaSemana = (f: string): number => UTC(f).getUTCDay() || 7
const diasDelMes = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).getUTCDate()

/** Una recurrencia que llega de fuera, comprobada: lo que no se entiende es «ninguna» */
export function recurrenciaValida(v: unknown): Recurrencia {
  if (!v || typeof v !== 'object') return RECURRENCIA_NINGUNA
  const r = v as { tipo?: unknown; diaSemana?: unknown; diaMes?: unknown }
  const dia = Number(r.diaSemana)
  const mes = Number(r.diaMes)
  if (r.tipo === 'laborable') return { tipo: 'laborable' }
  if ((r.tipo === 'semanal' || r.tipo === 'quincenal') && Number.isInteger(dia) && dia >= 1 && dia <= 7) return { tipo: r.tipo, diaSemana: dia }
  if (r.tipo === 'mensual' && Number.isInteger(mes) && mes >= 1 && mes <= 31) return { tipo: 'mensual', diaMes: mes }
  return RECURRENCIA_NINGUNA
}

/** La primera fecha que le toca desde un día (incluido); null si no se repite */
export function primeraFecha(rec: Recurrencia, desde: string): string | null {
  switch (rec.tipo) {
    case 'ninguna':
      return null
    case 'laborable': {
      let f = desde
      while (diaDeLaSemana(f) > 5) f = sumarDias(f, 1)
      return f
    }
    case 'semanal':
    case 'quincenal': {
      const falta = (rec.diaSemana - diaDeLaSemana(desde) + 7) % 7
      return sumarDias(desde, falta)
    }
    case 'mensual': {
      const [a, m, d] = desde.split('-').map(Number)
      const esteMes = Math.min(rec.diaMes, diasDelMes(a, m))
      if (esteMes >= d) return `${a}-${String(m).padStart(2, '0')}-${String(esteMes).padStart(2, '0')}`
      return fechaDelMes(a, m + 1, rec.diaMes)
    }
  }
}

function fechaDelMes(a: number, m: number, dia: number): string {
  const f = new Date(Date.UTC(a, m - 1, 1))
  const año = f.getUTCFullYear()
  const mes = f.getUTCMonth() + 1
  return `${año}-${String(mes).padStart(2, '0')}-${String(Math.min(dia, diasDelMes(año, mes))).padStart(2, '0')}`
}

/** La fecha que le toca DESPUÉS de una ocurrencia dada; null si no se repite */
export function siguienteFecha(rec: Recurrencia, ocurrencia: string): string | null {
  switch (rec.tipo) {
    case 'ninguna':
      return null
    case 'laborable':
      return primeraFecha(rec, sumarDias(ocurrencia, 1))
    case 'semanal':
      return sumarDias(ocurrencia, 7)
    case 'quincenal':
      return sumarDias(ocurrencia, 14)
    case 'mensual': {
      const [a, m] = ocurrencia.split('-').map(Number)
      return fechaDelMes(a, m + 1, rec.diaMes)
    }
  }
}

/**
 * Lo que hay que crear hoy: la ocurrencia más reciente que ya tocó (`proxima` o una posterior que ya haya pasado) y la que viene después. null si todavía no toca.
 */
export function ocurrenciaPendiente(rec: Recurrencia, proxima: string, hoy: string): { ocurrencia: string; siguiente: string } | null {
  if (rec.tipo === 'ninguna' || proxima > hoy) return null
  let ocurrencia = proxima
  let siguiente = siguienteFecha(rec, ocurrencia)
  // Tope de vueltas: una recurrencia diaria con años de retraso no debe dar mil vueltas
  for (let i = 0; siguiente !== null && siguiente <= hoy && i < 800; i++) {
    ocurrencia = siguiente
    siguiente = siguienteFecha(rec, ocurrencia)
  }
  return siguiente === null ? null : { ocurrencia, siguiente }
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/** La semana ISO del año (la semana 1 es la que lleva el primer jueves) */
export function semanaIso(f: string): number {
  const d = UTC(f)
  const diaIso = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - diaIso)
  const inicio = Date.UTC(d.getUTCFullYear(), 0, 1)
  return Math.ceil(((d.getTime() - inicio) / 86_400_000 + 1) / 7)
}

/** El título de la tarea: `{fecha}` → «8 nov», `{mes}` → «noviembre», `{año}` → «2026», `{semana}` → «45» */
export function titularDesdePlantilla(titulo: string, fecha: string): string {
  const [a, m, d] = fecha.split('-').map(Number)
  return titulo
    .replace(/\{fecha\}/gi, `${d} ${MESES_CORTOS[m - 1]}`)
    .replace(/\{mes\}/gi, MESES[m - 1])
    .replace(/\{a(?:ñ|n)o\}/gi, String(a))
    .replace(/\{semana\}/gi, String(semanaIso(fecha)))
    .trim()
}

/**
 * El cuerpo de una tarea nueva sacado del de la plantilla: bloques con identificador propio, sin ninguna huella de Notion (la tarea nueva es otra página), con las casillas sin
 * marcar, y sin los bloques que el editor no sabe recrear (tablas, bases de datos… y las imágenes sin dirección).
 */
export function cuerpoDesdePlantilla(bloques: readonly Bloque[]): Bloque[] {
  return bloques
    .filter((b) => b.tipo !== 'notion' && !(b.tipo === 'imagen' && !b.url))
    .map((b) => {
      const { notion_id: _n, notion_tipo: _t, vista: _v, ...resto } = b
      void _n
      void _t
      void _v
      return { ...resto, id: nuevoIdDeBloque(), ...(b.tipo === 'tarea' ? { hecho: false } : {}) }
    })
}

export const NOMBRE_DE_DIA = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

/** La recurrencia dicha con palabras, para la lista de plantillas */
export function describirRecurrencia(rec: Recurrencia): string {
  switch (rec.tipo) {
    case 'ninguna':
      return 'No se repite'
    case 'laborable':
      return 'Cada día laborable'
    case 'semanal':
      return `Cada ${NOMBRE_DE_DIA[rec.diaSemana]}`
    case 'quincenal':
      return `Cada dos semanas, el ${NOMBRE_DE_DIA[rec.diaSemana]}`
    case 'mensual':
      return `El día ${rec.diaMes} de cada mes`
  }
}
