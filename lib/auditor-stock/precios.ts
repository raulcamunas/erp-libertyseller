/**
 * AUDITOR DE STOCK: QUÉ PRECIOS HAN CAMBIADO.
 * PURA: sin base de datos ni Amazon. Se comprueba con precios.prueba.ts.
 *
 * Los precios van en CÉNTIMOS ENTEROS: comparar 9,13 con 9,13 en coma flotante
 * puede dar «distintos». Un precio que falta o no es positivo es «sin dato» y
 * NO cuenta como cambio: un listing que Amazon devuelve sin precio no ha pasado
 * de valer 12 € a valer 0.
 */

/** [sku, asin, antes, ahora] en céntimos */
export type TuplaPrecio = [string, string | null, number, number]

export function aCentimos(precio: number | null | undefined): number | null {
  if (typeof precio !== 'number' || !Number.isFinite(precio) || precio <= 0) return null
  return Math.round(precio * 100)
}

export interface ResultadoPrecios {
  /** Los de mayor salto primero, con tope */
  cambios: TuplaPrecio[]
  total: number
  suben: number
  bajan: number
  /** Lo que hay que apuntar como «último visto»: los nuevos y los que cambian */
  aGuardar: [string, number][]
}

export function diferenciasPrecio(
  anteriores: Map<string, number>,
  actuales: Map<string, { asin: string | null; centimos: number }>,
  tope = 5000
): ResultadoPrecios {
  const todos: TuplaPrecio[] = []
  const aGuardar: [string, number][] = []
  let suben = 0
  let bajan = 0

  for (const [sku, a] of actuales) {
    const antes = anteriores.get(sku)
    if (antes === undefined) {
      aGuardar.push([sku, a.centimos])
      continue
    }
    if (antes === a.centimos) continue
    aGuardar.push([sku, a.centimos])
    todos.push([sku, a.asin, antes, a.centimos])
    if (a.centimos > antes) suben += 1
    else bajan += 1
  }

  todos.sort((x, y) => Math.abs(y[3] - y[2]) - Math.abs(x[3] - x[2]) || x[0].localeCompare(y[0]))
  return { cambios: todos.slice(0, tope), total: todos.length, suben, bajan, aGuardar }
}
