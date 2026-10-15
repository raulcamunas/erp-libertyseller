/**
 * QUÉ LISTINGS SE REVISAN PRIMERO.
 * PURO: recibe lo que hay y lo que se sabe, y devuelve una lista ordenada. Se
 * prueba en pendientes.prueba.ts.
 *
 *
 * ============ POR QUÉ HAY QUE ELEGIR ============
 *
 * Amazon solo deja leer las incidencias de veinte SKU por llamada. Una cuenta
 * como la de ShoesF tiene 43.800 listings en cuatro países: son 2.200 llamadas
 * para darle una vuelta, y compartiendo el cupo con el sincronismo de stock y el
 * auditor. Revisarlo todo cada hora no tiene sentido ni cabe; y lo que importa
 * no vale lo mismo en todos los listings:
 *
 *   · Un listing CON STOCK al que Amazon no deja vender es dinero perdido hoy.
 *   · Uno sin stock con el mismo problema es un problema para cuando vuelva.
 *
 * Así que cada pasada coge los mejores N según estos niveles, de más a menos
 * urgente. Lo que no entra se queda esperando y lo recoge la siguiente.
 *
 *   0  nunca revisado y con stock
 *   1  con problemas abiertos y vencido (para enterarse pronto de que se arregló)
 *   2  nunca revisado y sin stock
 *   3  limpio con stock y vencido
 *   4  limpio sin stock y vencido
 *   5  el que Amazon no devolvió la última vez, por si ha vuelto a existir
 *
 * Dentro de cada nivel, el que lleva más tiempo sin mirarse primero.
 */

export const HORA_MS = 3_600_000

export interface FilaUniverso {
  mercado: string
  sku: string
  conStock: boolean
}

export interface FilaPrevia {
  mercado: string
  sku: string
  /** Cuándo se revisó por última vez, en ms */
  revisadoAt: number
  /** ¿Tenía errores, avisos u ocultación en esa revisión? */
  abierto: boolean
  /** false = la última vez Amazon no devolvió este SKU */
  enAmazon: boolean
}

export interface Politica {
  ahora: number
  /** Cada cuánto se vuelve a mirar un listing CON problemas */
  abiertosCadaMs: number
  /** Cada cuánto se vuelve a mirar uno limpio que tiene stock */
  limpiosConStockCadaMs: number
  /** Cada cuánto se vuelve a mirar uno limpio sin stock */
  limpiosSinStockCadaMs: number
  /** Cada cuánto se vuelve a preguntar por uno que Amazon no devolvió */
  inexistentesCadaMs: number
  /**
   * «Revisar ahora»: no espera a que venza el plazo de los que tienen problemas ni
   * de los limpios con stock. Es lo que se pulsa tras arreglar algo en Seller
   * Central para ver si Amazon ya lo da por bueno.
   */
  forzar?: boolean
}

/** Los plazos de cada pasada normal */
export const POLITICA_POR_DEFECTO = {
  abiertosCadaMs: 6 * HORA_MS,
  limpiosConStockCadaMs: 24 * HORA_MS,
  limpiosSinStockCadaMs: 72 * HORA_MS,
  inexistentesCadaMs: 7 * 24 * HORA_MS,
} as const

export interface Candidato {
  mercado: string
  sku: string
  nivel: number
  revisadoAt: number
}

export const clave = (mercado: string, sku: string) => `${mercado}\u0000${sku}`

export function elegirPendientes(
  universo: readonly FilaUniverso[],
  previas: readonly FilaPrevia[],
  politica: Politica,
  limite: number
): Candidato[] {
  const antes = new Map(previas.map((p) => [clave(p.mercado, p.sku), p]))
  const forzar = politica.forzar === true
  const candidatos: Candidato[] = []

  for (const u of universo) {
    const p = antes.get(clave(u.mercado, u.sku))
    const edad = p ? politica.ahora - p.revisadoAt : Infinity

    let nivel: number
    if (!p) {
      nivel = u.conStock ? 0 : 2
    } else if (!p.enAmazon) {
      if (edad < politica.inexistentesCadaMs) continue
      nivel = 5
    } else if (p.abierto) {
      if (!forzar && edad < politica.abiertosCadaMs) continue
      nivel = 1
    } else if (u.conStock) {
      if (!forzar && edad < politica.limpiosConStockCadaMs) continue
      nivel = 3
    } else {
      if (edad < politica.limpiosSinStockCadaMs) continue
      nivel = 4
    }

    candidatos.push({ mercado: u.mercado, sku: u.sku, nivel, revisadoAt: p?.revisadoAt ?? 0 })
  }

  candidatos.sort(
    (a, b) =>
      a.nivel - b.nivel ||
      a.revisadoAt - b.revisadoAt ||
      (a.mercado < b.mercado ? -1 : a.mercado > b.mercado ? 1 : 0) ||
      (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0)
  )
  return candidatos.slice(0, Math.max(0, limite))
}

/**
 * Las filas revisadas cuyo SKU ya no está en el catálogo del ERP: el cliente lo ha
 * dado de baja y su fila de cumplimiento se ha quedado de adorno, inflando los
 * totales con listings que ya no existen.
 *
 * Con el universo vacío NO se da ninguna por huérfana: un espejo que ahora mismo
 * no se ha podido leer, o un cliente al que se le ha vaciado el catálogo por
 * error, no puede llevarse por delante todo lo revisado.
 */
export function huerfanas<P extends FilaPrevia>(
  universo: readonly FilaUniverso[],
  previas: readonly P[]
): P[] {
  if (universo.length === 0) return []
  const vivos = new Set(universo.map((u) => clave(u.mercado, u.sku)))
  return previas.filter((p) => !vivos.has(clave(p.mercado, p.sku)))
}
