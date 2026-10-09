import { cantidadDe, eanValido } from './respuesta'

/**
 * EL STOCK DE LA TIENDA, UNIDO POR TALLA.
 * ======================================
 * PURA: recibe las filas que ya ha leído la tienda. Se prueba en
 * lib/prestashop/contraste.prueba.ts.
 *
 * PrestaShop reparte lo que hace falta en TRES recursos, y hay que juntarlos:
 *
 *   combinations      una por talla: su `id`, el producto al que pertenece, su
 *                     `ean13` y su `reference`.
 *   stock_availables  el stock. Una fila por talla (`id_product_attribute` = el id
 *                     de la combinación) y OTRA por producto con
 *                     `id_product_attribute` = 0, que es el total del producto.
 *   products          lo que hay que mirar solo para los productos SIN tallas,
 *                     que son los que no tienen combinaciones.
 *
 * LA FILA «0» NO SE SUMA A LAS TALLAS. Un producto con tallas tiene una fila de
 * stock a 0 que es la suma de las suyas: contarla además de cada talla duplicaría
 * el stock. Solo se usa para los productos que no tienen combinaciones.
 *
 * UNA CANTIDAD QUE FALTA ES `null`, NO CERO: una talla sin fila de stock no es una
 * talla agotada, es una talla de la que no se sabe nada.
 */

export interface FilaPS {
  idProducto: string
  /** '0' para un producto sin tallas */
  idComb: string
  ean: string | null
  referencia: string | null
  cantidad: number | null
}

type Fila = Record<string, unknown>

const txt = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number' ? String(v).trim() : ''

export function unirStock(
  stock: Fila[],
  combos: Fila[],
  productos: Fila[]
): { filas: FilaPS[]; duplicadosStock: number } {
  // ---------- El stock, por (producto, talla) ----------
  const stockDe = new Map<string, number | null>()
  let duplicadosStock = 0
  for (const s of stock) {
    const clave = `${txt(s.id_product)}|${txt(s.id_product_attribute) || '0'}`
    if (stockDe.has(clave)) {
      // Una tienda con varias tiendas o grupos repite la fila. No se suman: en un
      // stock compartido son la MISMA cantidad vista dos veces. Se queda la
      // primera y se cuenta cuántas había para poder decirlo.
      duplicadosStock += 1
      continue
    }
    stockDe.set(clave, cantidadDe(s.quantity))
  }

  const filas: FilaPS[] = []
  const productosConTallas = new Set<string>()

  // ---------- Una fila por talla ----------
  for (const c of combos) {
    const idProducto = txt(c.id_product)
    const idComb = txt(c.id)
    if (idProducto === '' || idComb === '') continue
    productosConTallas.add(idProducto)

    const ean = eanValido(c.ean13) ? c.ean13.trim() : null
    const referencia = txt(c.reference)
    filas.push({
      idProducto,
      idComb,
      ean,
      referencia: referencia === '' ? null : referencia,
      cantidad: stockDe.get(`${idProducto}|${idComb}`) ?? null,
    })
  }

  // ---------- Los productos sin tallas ----------
  for (const p of productos) {
    const idProducto = txt(p.id)
    if (idProducto === '' || productosConTallas.has(idProducto)) continue
    const ean = eanValido(p.ean13) ? p.ean13.trim() : null
    const referencia = txt(p.reference)
    filas.push({
      idProducto,
      idComb: '0',
      ean,
      referencia: referencia === '' ? null : referencia,
      cantidad: stockDe.get(`${idProducto}|0`) ?? null,
    })
  }

  return { filas, duplicadosStock }
}
