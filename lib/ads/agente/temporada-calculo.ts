/**
 * TEMPORADA DEL AGENTE DE PPC (puro, §6.7 de la spec).
 *
 * Eventos de temporada (Black Friday, Navidad…) por país y la «veda de activación»: cerca de BF/CM
 * el ensayo puede seguir, pero el agente no pasa a `activo` hasta que acaba la veda.
 *
 * Todas las fechas son YYYY-MM-DD en la hora local del marketplace (las calcula el servidor con
 * `horaLocal`), y los dos extremos de un evento están incluidos. No hay hora ni zona aquí: se opera
 * con días enteros en UTC para que el cambio de hora no mueva nada.
 */
import { AGENTE, type EventoDeTemporada, type FaseDeEvento } from './tipos'

/**
 * Tabla fija de eventos 2026–27.
 * OJO: UNA PERSONA REVISA ESTAS FECHAS cada año (Amazon y cada país las mueven). Prime Day y Hot Sale (MX)
 * NO están aquí a propósito: Amazon los anuncia con poco margen, así que los pone un admin como eventos
 * manuales (`ads_agente.eventos_manuales`).
 */
export const EVENTOS_DE_TEMPORADA: readonly EventoDeTemporada[] = [
  { nombre: 'Black Friday', desde: '2026-11-27', hasta: '2026-11-30', paises: null, veda: true },
  { nombre: 'El Buen Fin', desde: '2026-11-13', hasta: '2026-11-16', paises: ['MX'], veda: false },
  { nombre: 'Navidad', desde: '2026-12-14', hasta: '2026-12-24', paises: null, veda: false },
  { nombre: 'Reyes', desde: '2026-12-26', hasta: '2027-01-05', paises: ['ES'], veda: false },
]

const DIA_MS = 86_400_000
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/
const RE_PAIS = /^[A-Z]{2}$/
const NOMBRE_MAX = 80

/** Días desde 1970 de una fecha YYYY-MM-DD (null si no es una fecha real: 2026-02-30 no vale) */
function diaDe(fecha: string): number | null {
  if (typeof fecha !== 'string' || !RE_FECHA.test(fecha)) return null
  const ms = Date.UTC(Number(fecha.slice(0, 4)), Number(fecha.slice(5, 7)) - 1, Number(fecha.slice(8, 10)))
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== fecha) return null
  return Math.round(ms / DIA_MS)
}

function fechaDe(dia: number): string {
  return new Date(dia * DIA_MS).toISOString().slice(0, 10)
}

function normalizarPais(pais: string): string {
  return String(pais ?? '').trim().toUpperCase()
}

function aplicaAlPais(e: EventoDeTemporada, pais: string): boolean {
  return e.paises === null || e.paises.some(p => normalizarPais(p) === pais)
}

/** Los eventos que valen en un país: los de la tabla más los manuales, ordenados por fecha de inicio */
export function eventosDe(pais: string, manuales: readonly EventoDeTemporada[]): EventoDeTemporada[] {
  const p = normalizarPais(pais)
  return [...EVENTOS_DE_TEMPORADA, ...(manuales ?? [])]
    .filter(e => aplicaAlPais(e, p) && diaDe(e.desde) !== null && diaDe(e.hasta) !== null)
    .sort((a, b) => (a.desde < b.desde ? -1 : a.desde > b.desde ? 1 : 0))
}

const PRIORIDAD_DE_FASE: Record<FaseDeEvento, number> = { durante: 0, previo: 1, posterior: 2 }

/**
 * Fase de evento de un día: `previo` (los 2 días antes), `durante` o `posterior` (los 7 días después).
 * Si un día cae en varios (Navidad termina y Reyes empieza), gana `durante`, luego `previo`, luego `posterior`.
 */
export function eventoEn(fecha: string, pais: string, manuales: readonly EventoDeTemporada[]): { nombre: string; fase: FaseDeEvento } | null {
  const d = diaDe(fecha)
  if (d === null) return null
  let mejor: { nombre: string; fase: FaseDeEvento } | null = null
  for (const e of eventosDe(pais, manuales)) {
    const ini = diaDe(e.desde) as number
    const fin = diaDe(e.hasta) as number
    let fase: FaseDeEvento | null = null
    if (d >= ini && d <= fin) fase = 'durante'
    else if (d < ini && d >= ini - AGENTE.EVENTO_DIAS_PREVIOS) fase = 'previo'
    else if (d > fin && d <= fin + AGENTE.EVENTO_DIAS_POSTERIORES) fase = 'posterior'
    if (fase && (!mejor || PRIORIDAD_DE_FASE[fase] < PRIORIDAD_DE_FASE[mejor.fase])) mejor = { nombre: e.nombre, fase }
  }
  return mejor
}

/** Nombre del primer evento con algún día `durante` dentro de [desde, hasta] (ambos incluidos), o null */
export function ventanaTocaEvento(desde: string, hasta: string, pais: string, manuales: readonly EventoDeTemporada[]): string | null {
  let a = diaDe(desde)
  let b = diaDe(hasta)
  if (a === null || b === null) return null
  if (a > b) [a, b] = [b, a]
  for (const e of eventosDe(pais, manuales)) {
    const ini = diaDe(e.desde) as number
    const fin = diaDe(e.hasta) as number
    if (ini <= b && fin >= a) return e.nombre
  }
  return null
}

/** ¿Algún evento del país tiene días `durante` en ese mes (YYYY-MM)? */
export function hayEventoEnElMes(mes: string, pais: string, manuales: readonly EventoDeTemporada[]): boolean {
  if (typeof mes !== 'string' || !/^\d{4}-\d{2}$/.test(mes)) return false
  const ini = diaDe(`${mes}-01`)
  if (ini === null) return false
  const anio = Number(mes.slice(0, 4))
  const m = Number(mes.slice(5, 7))
  const fin = Math.round(Date.UTC(anio, m, 0) / DIA_MS) // último día del mes
  return ventanaTocaEvento(fechaDe(ini), fechaDe(fin), pais, manuales) !== null
}

/**
 * Veda de activación: desde 7 días antes del inicio hasta 2 días después del fin de un evento con `veda`
 * (BF/CM 2026: 20 nov → 2 dic). `hasta` es el ÚLTIMO día de la veda (incluido): se puede pasar a activo
 * el día siguiente (3 dic). Si varias vedas se solapan, devuelve la que acaba más tarde.
 */
export function enVedaDeActivacion(fecha: string, pais: string, manuales: readonly EventoDeTemporada[]): { nombre: string; hasta: string } | null {
  const d = diaDe(fecha)
  if (d === null) return null
  let mejor: { nombre: string; fin: number } | null = null
  for (const e of eventosDe(pais, manuales)) {
    if (!e.veda) continue
    const ini = (diaDe(e.desde) as number) - AGENTE.VEDA_DIAS_ANTES
    const fin = (diaDe(e.hasta) as number) + AGENTE.VEDA_DIAS_DESPUES
    if (d >= ini && d <= fin && (!mejor || fin > mejor.fin)) mejor = { nombre: e.nombre, fin }
  }
  return mejor ? { nombre: mejor.nombre, hasta: fechaDe(mejor.fin) } : null
}

/**
 * Valida lo que guarda un admin en `ads_agente.eventos_manuales` (`[{nombre, desde, hasta, paises?, veda?}]`).
 * Lo que no tenga forma de evento se queda fuera (no lanza): nombre vacío, fechas que no existen,
 * `desde` > `hasta`, países que no son códigos de 2 letras. `paises` ausente, null o vacío = todos.
 * `veda` solo si viene `true` (por defecto un evento manual no bloquea la activación).
 */
export function eventosManualesValidos(crudo: unknown): EventoDeTemporada[] {
  if (!Array.isArray(crudo)) return []
  const salida: EventoDeTemporada[] = []
  for (const x of crudo) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) continue
    const o = x as Record<string, unknown>
    const nombre = typeof o.nombre === 'string' ? o.nombre.trim().slice(0, NOMBRE_MAX) : ''
    if (!nombre) continue
    const desde = typeof o.desde === 'string' ? o.desde.trim() : ''
    const hasta = typeof o.hasta === 'string' ? o.hasta.trim() : ''
    const a = diaDe(desde)
    const b = diaDe(hasta)
    if (a === null || b === null || a > b) continue
    let paises: string[] | null = null
    if (o.paises !== undefined && o.paises !== null) {
      if (!Array.isArray(o.paises)) continue
      const lista = o.paises.map(p => (typeof p === 'string' ? normalizarPais(p) : ''))
      if (lista.some(p => !RE_PAIS.test(p))) continue
      paises = lista.length ? Array.from(new Set(lista)) : null
    }
    salida.push({ nombre, desde, hasta, paises, veda: o.veda === true })
  }
  return salida
}
