/**
 * AUDITOR DE STOCK: CÓMO SE CUENTA.
 * =================================
 * PURA: no toca la base de datos ni Amazon. Se comprueba entera con
 * lib/auditor-stock/clasificar.prueba.ts.
 *
 *
 * ============ TRES RESULTADOS, NO DOS ============
 *
 * Cada SKU acaba en uno de tres sitios:
 *
 *   con stock   Amazon dice que hay una o más unidades.
 *   sin stock   Amazon dice que hay CERO.
 *   sin dato    Amazon no ha dicho cuántas hay.
 *
 * El tercero NO ES UN CERO, y mezclarlo con «sin stock» es el error caro de un
 * auditor: haría parecer agotado lo que simplemente no se ha podido leer, y un
 * tracker cuyo propósito es detectar que el stock desaparece daría una falsa
 * alarma cada vez que Amazon devuelva un listing sin cantidad.
 *
 * Es el mismo criterio que la serie de inventario (lib/plataforma/tareas/
 * inventario-fba.ts): conocido / desconocido, y un cero no se cuela donde había
 * un «no lo sabemos».
 *
 *
 * ============ DE DÓNDE SALE LA CANTIDAD ============
 *
 *   FBM (lo gestiona el vendedor): la cantidad que Amazon devuelve AHORA en
 *     `fulfillmentAvailability`. Es el dato en directo.
 *
 *   FBA (lo gestiona Amazon): la API de listados NO da la cantidad de un FBA. Se
 *     toma del último inventario de Amazon que tengamos en el espejo, que se lee
 *     una vez al día. Es un dato MÁS VIEJO y por eso va marcado con el canal 'A'
 *     en el detalle: quien mire la lista tiene que poder distinguir lo que se
 *     leyó hace un minuto de lo que se leyó ayer.
 */

export type Canal = 'M' | 'A'

/** Lo que Amazon ha devuelto de un SKU, ya normalizado */
export interface ItemVivo {
  sku: string
  asin: string | null
  /** Solo significa algo si isFba es false */
  quantity: number | null
  isFba: boolean
}

/** Lo que tenemos en el espejo de un SKU, para completar lo que Amazon no da */
export interface DelEspejo {
  sku: string
  asin: string | null
  /** La cantidad FBA del último inventario leído. null = no se ha leído nunca */
  fbaCantidad: number | null
}

/** [sku, asin, cantidad, canal]: compacto a propósito, ver la migración 220 */
export type FilaDetalle = [string, string | null, number, Canal]

export interface Recuento {
  /** Cuántos SKU se han pedido */
  pedidos: number
  /** Cuántos ha devuelto Amazon */
  leidas: number
  /** Los que se pidieron y Amazon no devolvió: listings borrados, normalmente */
  noVinieron: number
  conStock: number
  sinStock: number
  sinDato: number
  unidades: number
  conStockFbm: number
  conStockFba: number
  /** Solo los que tienen stock. Es lo que se guarda como detalle */
  detalle: FilaDetalle[]
  /** La cantidad de cada SKU leído, o null si no hay dato. Para comparar */
  cantidades: Map<string, number | null>
}

/**
 * ¿Es una cantidad que se pueda creer?
 *
 * Un entero de cero para arriba. Una cantidad negativa, fraccionaria o NaN no es
 * un stock: es un dato roto, y se trata como «sin dato» en vez de redondearla a
 * cero —que parecería un agotado— o aceptarla —que sumaría unidades
 * imposibles—.
 */
export function cantidadValida(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0
}

export function clasificar(
  pedidos: string[],
  vivos: ReadonlyMap<string, ItemVivo>,
  espejo: ReadonlyMap<string, DelEspejo>
): Recuento {
  const r: Recuento = {
    pedidos: pedidos.length,
    leidas: 0,
    noVinieron: 0,
    conStock: 0,
    sinStock: 0,
    sinDato: 0,
    unidades: 0,
    conStockFbm: 0,
    conStockFba: 0,
    detalle: [],
    cantidades: new Map(),
  }

  for (const sku of pedidos) {
    const vivo = vivos.get(sku)
    if (!vivo) {
      r.noVinieron += 1
      continue
    }
    r.leidas += 1

    const delEspejo = espejo.get(sku)
    const canal: Canal = vivo.isFba ? 'A' : 'M'
    const cantidad = vivo.isFba ? (delEspejo?.fbaCantidad ?? null) : vivo.quantity
    const asin = vivo.asin ?? delEspejo?.asin ?? null

    if (!cantidadValida(cantidad)) {
      r.sinDato += 1
      r.cantidades.set(sku, null)
    } else if (cantidad > 0) {
      r.conStock += 1
      r.unidades += cantidad
      if (canal === 'M') r.conStockFbm += 1
      else r.conStockFba += 1
      r.detalle.push([sku, asin, cantidad, canal])
      r.cantidades.set(sku, cantidad)
    } else {
      r.sinStock += 1
      r.cantidades.set(sku, 0)
    }
  }

  // Lo que más stock tiene, arriba: es lo primero que se quiere mirar.
  r.detalle.sort((a, b) => b[2] - a[2] || a[0].localeCompare(b[0]))
  return r
}

/* ------------------------------------------------------------------ */
/* Qué se movió entre dos auditorías                                   */
/* ------------------------------------------------------------------ */

export interface Cambios {
  /** Pasaron de no tener stock a tenerlo: [sku, cantidad ahora] */
  entran: [string, number][]
  /** Pasaron de tener stock a no tenerlo: [sku, cantidad que tenían] */
  salen: [string, number][]
}

/**
 * Compara la auditoría anterior con la que se acaba de hacer.
 *
 * UN SKU «SALE» SOLO SI AHORA SE HA LEÍDO Y TIENE CERO. Que no aparezca en la
 * lista de los que tienen stock no quiere decir que se haya agotado: puede que
 * esta vez Amazon no lo haya devuelto, o que haya venido sin cantidad. Contarlo
 * como «salida» inventaría una caída de stock que no ha ocurrido, y detectar
 * caídas de stock es justo para lo que existe este auditor.
 *
 * Y «ENTRA» ES PASAR DE CERO A MÁS, no cambiar de cantidad. Una venta que baja
 * un SKU de 12 a 11 no es un cambio de estado y pasaría a diario cientos de
 * veces; lo que interesa es que un producto aparezca o desaparezca.
 */
export function diferencias(
  anterior: ReadonlyArray<readonly [string, ...unknown[]] & { 2?: number }>,
  ahora: ReadonlyMap<string, number | null>
): Cambios {
  const antes = new Map<string, number>()
  for (const fila of anterior) {
    const cantidad = fila[2]
    if (typeof cantidad === 'number') antes.set(fila[0], cantidad)
  }

  const cambios: Cambios = { entran: [], salen: [] }

  for (const [sku, cantidad] of ahora) {
    if (cantidad === null) continue
    const previa = antes.get(sku) ?? 0
    if (cantidad > 0 && previa === 0) cambios.entran.push([sku, cantidad])
    if (cantidad === 0 && previa > 0) cambios.salen.push([sku, previa])
  }

  cambios.entran.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  cambios.salen.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return cambios
}
