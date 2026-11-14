import { hoyEnEspana, semanaDe } from './filtros'

/**
 * «MI DÍA» — PURO.
 *
 * El briefing personal: un PLAN del día (checklist; cada punto puede enlazar una tarea de un cliente) y una REVISIÓN de final de día. Lo que se queda sin hacer pasa solo al día
 * siguiente. Aquí viven las reglas que no dependen de la pantalla ni de la base: validar lo que llega, arrastrar los pendientes, sugerir la revisión y repartir las tareas en
 * «vencidas / hoy / esta semana / más adelante / sin fecha».
 */

export const MAX_PUNTOS = 60
export const MAX_TEXTO_PUNTO = 300
export const MAX_REVISION = 5000
export const MAX_NOTAS = 20_000

export interface PuntoDelPlan {
  id: string
  texto: string
  hecho: boolean
  tarea_id: string | null
  cliente_id: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ID_DE_PUNTO = /^[A-Za-z0-9_-]{6,40}$/

export const idNuevoDePunto = (): string => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

/** Un plan que llega del navegador, limpio: sin puntos vacíos, con ids únicos y topes. null = no es una lista */
export function limpiarPlan(entrada: unknown): PuntoDelPlan[] | null {
  if (!Array.isArray(entrada)) return null
  const vistos = new Set<string>()
  const salida: PuntoDelPlan[] = []
  for (const x of entrada.slice(0, MAX_PUNTOS)) {
    if (!x || typeof x !== 'object') continue
    const p = x as Record<string, unknown>
    const texto = typeof p.texto === 'string' ? p.texto.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXTO_PUNTO) : ''
    if (!texto) continue
    let id = typeof p.id === 'string' && ID_DE_PUNTO.test(p.id) ? p.id : idNuevoDePunto()
    while (vistos.has(id)) id = idNuevoDePunto()
    vistos.add(id)
    salida.push({
      id,
      texto,
      hecho: p.hecho === true,
      tarea_id: typeof p.tarea_id === 'string' && UUID.test(p.tarea_id) ? p.tarea_id.toLowerCase() : null,
      cliente_id: typeof p.cliente_id === 'string' && UUID.test(p.cliente_id) ? p.cliente_id.toLowerCase() : null,
    })
  }
  return salida
}

export const limpiarTexto = (entrada: unknown, max: number): string | null => (typeof entrada === 'string' ? entrada.replace(/\r\n/g, '\n').slice(0, max) : null)

/** Lo que pasa al plan de hoy desde el último briefing: los puntos sin hacer, otra vez sin marcar. Lo que se hizo se queda en su día */
export function arrastrarPendientes(planAnterior: readonly PuntoDelPlan[]): PuntoDelPlan[] {
  return planAnterior.filter((p) => !p.hecho).map((p) => ({ ...p, hecho: false }))
}

export interface ProgresoDelPlan {
  total: number
  hechos: number
  porcentaje: number
}

export function progresoDelPlan(plan: readonly Pick<PuntoDelPlan, 'hecho'>[]): ProgresoDelPlan {
  const hechos = plan.filter((p) => p.hecho).length
  return { total: plan.length, hechos, porcentaje: plan.length === 0 ? 0 : Math.round((hechos / plan.length) * 100) }
}

/**
 * El borrador de la revisión de final de día: lo que se hizo (los puntos del plan marcados y las tareas que se cerraron hoy), lo que se queda para mañana y cuántos comentarios
 * se escribieron. La persona lo corrige: es un punto de partida, no la verdad.
 */
export function sugerirRevision(datos: { puntosHechos: readonly string[]; puntosPendientes: readonly string[]; tareasCerradas: readonly string[]; comentarios: number }): string {
  const lineas: string[] = []
  const hecho = [...new Set([...datos.puntosHechos, ...datos.tareasCerradas])]
  if (hecho.length > 0) lineas.push('Hecho hoy:', ...hecho.map((t) => `- ${t}`))
  if (datos.comentarios > 0) lineas.push(`${lineas.length ? '\n' : ''}He escrito ${datos.comentarios} comentario${datos.comentarios === 1 ? '' : 's'} en tareas.`)
  if (datos.puntosPendientes.length > 0) lineas.push(`${lineas.length ? '\n' : ''}Queda para mañana:`, ...datos.puntosPendientes.map((t) => `- ${t}`))
  return lineas.join('\n')
}

export interface TareaParaElDia {
  id: string
  fecha_inicio: string | null
  fecha_fin: string | null
}

export interface TareasPorFecha<T> {
  vencidas: T[]
  hoy: T[]
  semana: T[]
  despues: T[]
  sinFecha: T[]
}

/** Reparte tareas (sin las hechas: eso lo decide quien llama) por su fecha respecto a hoy. Una tarea con rango cuenta por donde está hoy */
export function repartirPorFecha<T extends TareaParaElDia>(tareas: readonly T[], hoy: string = hoyEnEspana()): TareasPorFecha<T> {
  const { domingo } = semanaDe(hoy)
  const r: TareasPorFecha<T> = { vencidas: [], hoy: [], semana: [], despues: [], sinFecha: [] }
  for (const t of tareas) {
    const desde = t.fecha_inicio?.slice(0, 10)
    if (!desde) {
      r.sinFecha.push(t)
      continue
    }
    const fin = t.fecha_fin?.slice(0, 10)
    const hasta = fin && fin >= desde ? fin : desde
    if (hasta < hoy) r.vencidas.push(t)
    else if (desde <= hoy) r.hoy.push(t)
    else if (desde <= domingo) r.semana.push(t)
    else r.despues.push(t)
  }
  const orden = (a: T, b: T) => (a.fecha_fin ?? a.fecha_inicio ?? '').localeCompare(b.fecha_fin ?? b.fecha_inicio ?? '')
  r.vencidas.sort(orden)
  r.semana.sort((a, b) => (a.fecha_inicio ?? '').localeCompare(b.fecha_inicio ?? ''))
  r.despues.sort((a, b) => (a.fecha_inicio ?? '').localeCompare(b.fecha_inicio ?? ''))
  return r
}

/** El saludo según la hora de España */
export function saludoDeLaHora(ahora: Date = new Date()): string {
  const h = Number(new Intl.DateTimeFormat('es-ES', { hour: 'numeric', hour12: false, timeZone: 'Europe/Madrid' }).format(ahora))
  return h < 6 ? 'Buenas noches' : h < 14 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches'
}

export const esDiaValido = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d))

export const sumarDiasA = (dia: string, n: number): string => {
  const [a, m, d] = dia.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10)
}
