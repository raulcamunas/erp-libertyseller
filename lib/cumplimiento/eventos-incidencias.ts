import type { Incidencia } from './tipos'

/**
 * CUMPLIMIENTO · CUÁNDO SE ABRE Y SE CIERRA CADA INCIDENCIA. PURO.
 *
 * En cada revisión se comparan los ERRORES de un listing con los de la revisión anterior: un código que aparece es «abierta», uno que desaparece es «cerrada»
 * (con las horas que estuvo abierto, desde su `desde`). Los avisos no cuentan (son miles y no bloquean). Un listing que se revisa por primera vez no da
 * eventos: sus errores no se han «abierto» ahora, solo se ven por primera vez. De aquí salen el tiempo de resolución y las abiertas/cerradas por semana.
 */

export interface EventoDeIncidencia {
  sku: string
  asin: string | null
  codigo: string
  evento: 'abierta' | 'cerrada'
  desde: string
  horas: number | null
  con_stock: boolean
  mensaje: string
}

const errores = (lista: readonly Incidencia[]) => new Map(lista.filter((i) => i.gravedad === 'error').map((i) => [i.codigo, i]))

export function eventosDeIncidencias(
  filas: ReadonlyArray<{ sku: string; asin?: string | null; con_stock: boolean; incidencias: Incidencia[] }>,
  previas: ReadonlyMap<string, readonly Incidencia[]>,
  yaRevisado: (sku: string) => boolean,
  ahora: Date,
): EventoDeIncidencia[] {
  const salida: EventoDeIncidencia[] = []
  const iso = ahora.toISOString()
  for (const f of filas) {
    if (!yaRevisado(f.sku)) continue
    const antes = errores(previas.get(f.sku) ?? [])
    const ahoraErr = errores(f.incidencias)
    for (const [codigo, i] of ahoraErr) if (!antes.has(codigo)) salida.push({ sku: f.sku, asin: f.asin ?? null, codigo, evento: 'abierta', desde: i.desde || iso, horas: null, con_stock: f.con_stock, mensaje: i.mensaje.slice(0, 300) })
    for (const [codigo, i] of antes) {
      if (ahoraErr.has(codigo)) continue
      const desde = i.desde || iso
      const horas = Math.max(0, Math.round(((ahora.getTime() - Date.parse(desde)) / 3_600_000) * 10) / 10)
      salida.push({ sku: f.sku, asin: f.asin ?? null, codigo, evento: 'cerrada', desde, horas, con_stock: f.con_stock, mensaje: i.mensaje.slice(0, 300) })
    }
  }
  return salida
}
