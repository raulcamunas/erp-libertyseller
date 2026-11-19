import { cruzar, divergencias, type Divergencia, type FilaAmazon } from './cruce'
import type { FilaPS } from './stock'

/**
 * EL RESUMEN DEL CONTRASTE: LAS CIFRAS DE CADA PASADA.
 * ====================================================
 * PURA. La usan a la vez el botón «Contrastar con Amazon» y cada auditoría de 10
 * minutos, para que las dos digan exactamente lo mismo: no hay dos formas de
 * contar «cuántos tienen stock en la tienda».
 *
 *
 * ============ DOS NÚMEROS QUE NO SE PUEDEN MIRAR DE FRENTE ============
 *
 * `tienda.conStock` cuenta TODAS las tallas de la tienda con stock, incluidas las
 * que no están en Amazon. `cruce.amazonConStock` y `cruce.tiendaConStock` cuentan
 * solo entre los listings EMPAREJADOS con certeza.
 *
 * Los primeros son universos distintos —la tienda vende por su cuenta y Amazon
 * solo tiene una parte— y comparar «2.431 en la tienda» con «2.177 en Amazon»
 * llevaría a concluir que faltan 254 productos sin que falte ninguno. La pareja
 * que sí se puede mirar de frente es la segunda, y por eso se calcula aparte.
 */

export interface ResumenContraste {
  tienda: {
    tallas: number
    conStock: number
    sinStock: number
    sinDato: number
    unidades: number
  }
  cruce: {
    cruzados: number
    porEan: number
    porReferencia: number
    ambiguos: number
    sinPareja: number
    /** Sin pareja y con stock en Amazon: de esos no se puede decir nada */
    sinParejaConStock: number
    /** Entre los comparables (emparejados, sin duda y con dato de la tienda) */
    amazonConStock: number
    tiendaConStock: number
  }
  divergencias: {
    sobreventa: number
    ventaPerdida: number
    distinta: number
    iguales: number
    sinDatoTienda: number
  }
  listas: {
    sobreventa: Divergencia[]
    ventaPerdida: Divergencia[]
    distinta: Divergencia[]
    sinParejaConStock: { sku: string; ean: string | null; cantidad: number }[]
  }
}

export function resumirContraste(
  amazon: FilaAmazon[],
  tallas: FilaPS[],
  tope = 300
): ResumenContraste {
  const { cruzados, sinCruce } = cruzar(amazon, tallas)
  const d = divergencias(cruzados)

  const comparables = cruzados.filter((c) => !c.ambiguo && c.tienda !== null)
  const sinParejaConStock = sinCruce.filter((a) => a.cantidad > 0)

  return {
    tienda: {
      tallas: tallas.length,
      conStock: tallas.filter((t) => t.cantidad !== null && t.cantidad > 0).length,
      // Un stock negativo (se vende sin stock) está agotado, no «por debajo de cero»
      sinStock: tallas.filter((t) => t.cantidad !== null && t.cantidad <= 0).length,
      sinDato: tallas.filter((t) => t.cantidad === null).length,
      unidades: tallas.reduce((n, t) => n + (t.cantidad !== null && t.cantidad > 0 ? t.cantidad : 0), 0),
    },
    cruce: {
      cruzados: cruzados.length,
      porEan: cruzados.filter((c) => c.via === 'ean').length,
      porReferencia: cruzados.filter((c) => c.via === 'referencia').length,
      ambiguos: d.ambiguos,
      sinPareja: sinCruce.length,
      sinParejaConStock: sinParejaConStock.length,
      amazonConStock: comparables.filter((c) => c.amazon > 0).length,
      tiendaConStock: comparables.filter((c) => (c.tienda as number) > 0).length,
    },
    divergencias: {
      sobreventa: d.sobreventa.length,
      ventaPerdida: d.ventaPerdida.length,
      distinta: d.distinta.length,
      iguales: d.iguales,
      sinDatoTienda: d.sinDatoTienda,
    },
    listas: {
      sobreventa: d.sobreventa.slice(0, tope),
      ventaPerdida: d.ventaPerdida.slice(0, tope),
      distinta: d.distinta.slice(0, tope),
      sinParejaConStock: [...sinParejaConStock]
        .sort((a, b) => b.cantidad - a.cantidad || a.sku.localeCompare(b.sku))
        .slice(0, tope)
        .map((a) => ({ sku: a.sku, ean: a.ean, cantidad: a.cantidad })),
    },
  }
}

/* ------------------------------------------------------------------ */
/* Cómo se guarda                                                      */
/* ------------------------------------------------------------------ */

/** [sku, asin, amazon, tienda, vía] con 'e' = EAN y 'r' = referencia: compacto a propósito */
export type TuplaDivergencia = [string, string | null, number, number, 'e' | 'r']

export interface ContrasteGuardado {
  sobreventa: TuplaDivergencia[]
  ventaPerdida: TuplaDivergencia[]
  distinta: TuplaDivergencia[]
  /** [sku, ean, cantidad en Amazon] */
  sinParejaConStock: [string, string | null, number][]
}

const tupla = (d: Divergencia): TuplaDivergencia => [d.sku, d.asin, d.amazon, d.tienda, d.via === 'ean' ? 'e' : 'r']

export function compactar(r: ResumenContraste): ContrasteGuardado {
  return {
    sobreventa: r.listas.sobreventa.map(tupla),
    ventaPerdida: r.listas.ventaPerdida.map(tupla),
    distinta: r.listas.distinta.map(tupla),
    sinParejaConStock: r.listas.sinParejaConStock.map((f) => [f.sku, f.ean, f.cantidad]),
  }
}

/* ------------------------------------------------------------------ */
/* La foto completa del cruce (para la página del cliente)             */
/* ------------------------------------------------------------------ */

/**
 * Cómo está cada SKU: c = cuadra · v = venta perdida (tienda sí, Amazon no) · s = sobreventa (Amazon sí, tienda no) · d = distinta cantidad ·
 * n = la tienda no tiene dato · p = sin pareja en la tienda (no se puede comparar)
 */
export type EstadoCruce = 'c' | 'v' | 's' | 'd' | 'n' | 'p'
/** [sku, asin, stock en Amazon, stock en la tienda (null = sin dato o sin pareja), estado] */
export type TuplaCruce = [string, string | null, number, number | null, EstadoCruce]

/**
 * Todos los SKU FBM que tienen stock en ALGUNO de los dos lados, con lo que hay en cada uno. Es lo que enseña la página del cliente: una fila por producto con
 * «Stock Amazon» y «Stock PrestaShop». Los que no tienen stock en ninguno de los dos no salen (son miles y no dicen nada). Los ambiguos tampoco: no se sabe con qué
 * talla de la tienda van.
 */
export function fotoDelCruce(amazon: FilaAmazon[], tallas: FilaPS[]): TuplaCruce[] {
  const { cruzados, sinCruce } = cruzar(amazon, tallas)
  const salida: TuplaCruce[] = []
  for (const c of cruzados) {
    if (c.ambiguo) continue
    const t = c.tienda === null ? null : Math.max(0, c.tienda)
    if (c.amazon <= 0 && !(t && t > 0)) continue
    const estado: EstadoCruce = t === null ? 'n' : c.amazon > 0 && t === 0 ? 's' : c.amazon === 0 && t > 0 ? 'v' : c.amazon !== t ? 'd' : 'c'
    salida.push([c.sku, c.asin, c.amazon, t, estado])
  }
  for (const a of sinCruce) if (a.cantidad > 0) salida.push([a.sku, a.asin, a.cantidad, null, 'p'])
  return salida.sort((a, b) => a[0].localeCompare(b[0]))
}
