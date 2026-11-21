/**
 * SEO · QUÉ PERIODO SE ENSEÑA. PURO.
 *
 * La lectura de Brand Analytics va por tandas de 18 ASIN (lib/seo/lectura.ts). Mientras una tanda está a medias, la semana nueva ya tiene filas en seo_consultas pero solo de algunos productos:
 * si la pantalla enseñara «el desde más alto», saldría una semana con la mitad de los productos vacíos. Por eso el periodo mostrado es, por orden de preferencia:
 *   1. el que la lectura dio por terminado (`mes_ok` / `semana_ok`);
 *   2. si no hay, el más reciente de los ya leídos enteros del histórico (`periodos_leidos`, migración 299);
 *   3. si tampoco, el más alto que haya en la tabla (lo de antes: mejor algo que nada).
 */

import type { PeriodoSqp } from './periodos'

export interface EntradaDePeriodo {
  periodo: PeriodoSqp
  /** mes_ok o semana_ok de seo_lecturas */
  ok: string | null | undefined
  /** periodos_leidos de seo_lecturas («WEEK:2026-11-01»); undefined sin la migración 299 */
  leidos: readonly string[] | null | undefined
  /** El `desde` más alto de ese periodo en seo_consultas */
  maxDesde: string | null | undefined
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/

/** El `desde` del periodo que se enseña, o null si no hay nada leído */
export function elegirPeriodo(e: EntradaDePeriodo): string | null {
  // Sin una sola fila no hay nada que enseñar, diga lo que diga el estado
  if (!e.maxDesde) return null
  if (e.ok && FECHA.test(e.ok)) return e.ok
  const prefijo = `${e.periodo}:`
  let mejor: string | null = null
  for (const clave of e.leidos ?? []) {
    if (!clave.startsWith(prefijo)) continue
    const desde = clave.slice(prefijo.length)
    if (FECHA.test(desde) && (mejor == null || desde > mejor)) mejor = desde
  }
  return mejor ?? e.maxDesde
}

/** Quita las filas repetidas por su clave (la primera gana). La paginación con un orden que empata podía repetir búsquedas */
export function sinDuplicados<T>(filas: readonly T[], clave: (f: T) => string): T[] {
  const vistas = new Set<string>()
  const salida: T[] = []
  for (const f of filas) {
    const k = clave(f)
    if (vistas.has(k)) continue
    vistas.add(k)
    salida.push(f)
  }
  return salida
}

/* ------------------------------------------------------------------ */
/* Semanas de Amazon (de domingo a sábado) para el gasto de publicidad  */
/* ------------------------------------------------------------------ */

const DIA = 86_400_000

/** El domingo que abre la semana de Amazon de una fecha 'YYYY-MM-DD' (como el `desde` de las semanas de Brand Analytics) */
export function domingoDeLaSemana(fecha: string): string {
  const t = Date.parse(`${fecha.slice(0, 10)}T00:00:00Z`)
  return new Date(t - new Date(t).getUTCDay() * DIA).toISOString().slice(0, 10)
}

export interface GastoSemanal {
  asin: string
  /** Domingo que abre la semana */
  desde: string
  gasto: number
}

/**
 * Suma el gasto diario de las campañas por ASIN y semana. Una campaña es de un producto si lleva su ASIN en el nombre (la nomenclatura de Marketing Test). Si un nombre lleva dos ASIN seguidos,
 * cuenta para los dos: es la convención acordada, y esas campañas no deberían existir. Ordenado por ASIN y semana.
 */
export function agruparGastoSemanal(filas: ReadonlyArray<{ nombre: string; fecha: string; gasto: number | string | null }>, asins: readonly string[]): GastoSemanal[] {
  const buscados = [...new Set(asins.map((a) => a.trim().toUpperCase()).filter(Boolean))]
  const suma = new Map<string, number>()
  for (const f of filas) {
    const gasto = Number(f.gasto) || 0
    const nombre = (f.nombre ?? '').toUpperCase()
    const semana = domingoDeLaSemana(f.fecha)
    for (const asin of buscados) {
      if (!nombre.includes(asin)) continue
      const k = `${asin}|${semana}`
      suma.set(k, (suma.get(k) ?? 0) + gasto)
    }
  }
  return [...suma.entries()]
    .map(([k, gasto]) => {
      const [asin, desde] = k.split('|')
      return { asin, desde, gasto: Math.round(gasto * 100) / 100 }
    })
    .sort((a, b) => a.asin.localeCompare(b.asin) || a.desde.localeCompare(b.desde))
}
