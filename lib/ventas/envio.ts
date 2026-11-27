/**
 * COSTO DE ENVÍO · LO PURO (como «Costo de envío» de Sellerboard). Un perfil tiene una regla:
 *   · ninguno   sin gastos de envío
 *   · cobrado   lo que pagó el comprador por el envío (la de por defecto)
 *   · pedido    un importe fijo por pedido          · unidad   un importe fijo por unidad   (las de antes)
 *   · precio    tabla por país de destino × precio máximo del pedido
 *   · unidades  tabla por país × número máximo de unidades del pedido
 *   · peso      tabla por país × peso máximo del paquete (kg, con el peso de cada producto del catálogo de Amazon)
 * En las tablas, cada columna es un tope («hasta X»; null = sin límite) y cada fila un país (código ISO, el del mercado del pedido) o «resto».
 */

export type ReglaEnvio = 'ninguno' | 'cobrado' | 'pedido' | 'unidad' | 'precio' | 'unidades' | 'peso'
export const REGLAS_CON_TABLA: readonly ReglaEnvio[] = ['precio', 'unidades', 'peso']

export interface TablaEnvio {
  /** Topes de cada columna, de menor a mayor; null = sin límite (la última) */
  topes: Array<number | null>
  /** Una fila por país (ES, FR…) y «resto» para todos los demás. `importes[i]` es el de la columna i */
  filas: Array<{ zona: string; importes: Array<number | null> }>
}

export const TABLA_INICIAL: TablaEnvio = {
  topes: [null],
  filas: [
    { zona: 'ES', importes: [null] },
    { zona: 'resto', importes: [null] },
  ],
}

/** PURA. El importe de la tabla para un país y un valor (precio, unidades o peso del pedido). null si la tabla no lo cubre */
export function importeDeTabla(t: TablaEnvio | null | undefined, pais: string, valor: number): number | null {
  if (!t || !t.filas.length || !t.topes.length) return null
  const fila = t.filas.find((f) => f.zona.toUpperCase() === pais.toUpperCase()) ?? t.filas.find((f) => f.zona === 'resto')
  if (!fila) return null
  let col = t.topes.findIndex((tope) => tope === null || valor <= tope + 1e-9)
  if (col < 0) col = t.topes.length - 1 // por encima del último tope: el último
  const v = fila.importes[col]
  return v == null || !Number.isFinite(v) ? null : v
}

/**
 * PURA. El coste de envío de los pedidos FBM de una fila del resumen (un día, un país, un SKU), sin el detalle de cada pedido: se toma el pedido medio
 * de la fila (unidades por pedido; su precio, con el precio medio por unidad; su peso, con el del producto).
 */
export function costeDeFila(
  p: { regla: ReglaEnvio; importe: number; tabla?: TablaEnvio | null; porEuro?: number },
  x: { pedidos: number; unidades: number; cobrado: number; precioUnidad: number; pais: string; pesoUnidadKg: number | null }
): number {
  if (x.pedidos <= 0) return 0
  const aEuros = (v: number) => v / (p.porEuro && p.porEuro > 0 ? p.porEuro : 1)
  switch (p.regla) {
    case 'ninguno':
      return 0
    case 'cobrado':
      return x.cobrado
    case 'pedido':
      return aEuros(p.importe) * x.pedidos
    case 'unidad':
      return aEuros(p.importe) * x.unidades
    default: {
      const udsPorPedido = x.unidades / x.pedidos
      const valor = p.regla === 'precio' ? x.precioUnidad * udsPorPedido : p.regla === 'unidades' ? Math.ceil(udsPorPedido) : (x.pesoUnidadKg ?? 0) * udsPorPedido
      const imp = importeDeTabla(p.tabla, x.pais, valor)
      // Si la tabla no tiene importe para ese país y tramo, lo cobrado (como si no hubiera perfil)
      return imp == null ? x.cobrado : aEuros(imp) * x.pedidos
    }
  }
}

/** PURA. El peso en kg de un valor del catálogo de Amazon con su unidad (kilograms, grams, pounds, ounces) */
export function aKg(peso: number | null | undefined, unidad: string | null | undefined): number | null {
  if (peso == null || !Number.isFinite(Number(peso))) return null
  const u = (unidad ?? 'kilograms').toLowerCase()
  const v = Number(peso)
  if (u.startsWith('g')) return v / 1000
  if (u.startsWith('pound') || u === 'lb' || u === 'lbs') return v * 0.453592
  if (u.startsWith('ounce') || u === 'oz') return v * 0.0283495
  return v
}
