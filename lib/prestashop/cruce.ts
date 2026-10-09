import type { FilaPS } from './stock'

/**
 * CRUZAR EL STOCK DE AMAZON CON EL DE LA TIENDA.
 * =============================================
 * PURA. Se prueba en lib/prestashop/contraste.prueba.ts.
 *
 * ============ CÓMO SE EMPAREJAN ============
 *
 *   1. POR EAN. Es lo que identifica de verdad una talla de un modelo, y los
 *      listings de Amazon ya lo traen en el espejo (`codigo_externo`).
 *   2. Si no hay EAN o no aparece, POR REFERENCIA: la referencia de la talla en la
 *      tienda contra el SKU de Amazon, tal cual.
 *
 * UN EMPAREJAMIENTO DUDOSO NO SE USA. Si un EAN está en más de una talla de la
 * tienda, no se sabe cuál es la buena: se marca como ambiguo y NO entra en las
 * divergencias. Es preferible no comparar a decir «Amazon tiene 3 y la tienda 0»
 * mirando la talla equivocada.
 *
 * LOS EAN SE COMPARAN SIN CEROS A LA IZQUIERDA: un UPC de 12 dígitos y el mismo
 * código como EAN-13 con un cero delante son el mismo producto.
 */

export interface FilaAmazon {
  sku: string
  asin: string | null
  ean: string | null
  /** Lo que Amazon tiene. 0 si no figura con stock */
  cantidad: number
}

export type Via = 'ean' | 'referencia'

export interface Cruzado {
  sku: string
  asin: string | null
  via: Via
  amazon: number
  /** null = la tienda no tiene dato de stock para esa talla */
  tienda: number | null
  /** El emparejamiento no es único: no se compara */
  ambiguo: boolean
}

export function normalizarEan(valor: string | null | undefined): string | null {
  if (typeof valor !== 'string') return null
  const digitos = valor.replace(/\D/g, '')
  if (digitos.length < 8 || digitos.length > 14) return null
  const sinCeros = digitos.replace(/^0+/, '')
  return sinCeros === '' ? null : sinCeros
}

function indexar(filas: FilaPS[], clave: (f: FilaPS) => string | null): Map<string, FilaPS[]> {
  const m = new Map<string, FilaPS[]>()
  for (const f of filas) {
    const k = clave(f)
    if (k === null) continue
    const lista = m.get(k)
    if (lista) lista.push(f)
    else m.set(k, [f])
  }
  return m
}

export function cruzar(
  amazon: FilaAmazon[],
  tienda: FilaPS[]
): { cruzados: Cruzado[]; sinCruce: FilaAmazon[] } {
  const porEan = indexar(tienda, (f) => normalizarEan(f.ean))
  const porRef = indexar(tienda, (f) => (f.referencia ? f.referencia.trim().toLowerCase() : null))

  const cruzados: Cruzado[] = []
  const sinCruce: FilaAmazon[] = []

  for (const a of amazon) {
    const ean = normalizarEan(a.ean)
    let candidatos = ean ? (porEan.get(ean) ?? []) : []
    let via: Via = 'ean'
    if (candidatos.length === 0) {
      candidatos = porRef.get(a.sku.trim().toLowerCase()) ?? []
      via = 'referencia'
    }

    if (candidatos.length === 0) {
      sinCruce.push(a)
      continue
    }
    const unico = candidatos.length === 1
    cruzados.push({
      sku: a.sku,
      asin: a.asin,
      via,
      amazon: a.cantidad,
      tienda: unico ? candidatos[0].cantidad : null,
      ambiguo: !unico,
    })
  }

  return { cruzados, sinCruce }
}

export interface Divergencia {
  sku: string
  asin: string | null
  via: Via
  amazon: number
  tienda: number
}

export interface Divergencias {
  /** Amazon vende y la tienda no tiene: se puede vender lo que no hay */
  sobreventa: Divergencia[]
  /** La tienda tiene y Amazon no: se está dejando de vender */
  ventaPerdida: Divergencia[]
  /** Los dos tienen, pero distinto */
  distinta: Divergencia[]
  iguales: number
  /** La tienda no tiene dato de stock de esa talla */
  sinDatoTienda: number
  /** El emparejamiento no es único */
  ambiguos: number
}

/**
 * Qué divergencias hay entre lo emparejado.
 *
 * UN STOCK NEGATIVO EN LA TIENDA CUENTA COMO CERO. PrestaShop deja vender sin stock
 * y la cantidad puede quedar en -3: eso no es «menos de nada», es agotado.
 */
export function divergencias(cruzados: Cruzado[]): Divergencias {
  const d: Divergencias = {
    sobreventa: [],
    ventaPerdida: [],
    distinta: [],
    iguales: 0,
    sinDatoTienda: 0,
    ambiguos: 0,
  }

  for (const c of cruzados) {
    if (c.ambiguo) {
      d.ambiguos += 1
      continue
    }
    if (c.tienda === null) {
      d.sinDatoTienda += 1
      continue
    }
    const t = Math.max(0, c.tienda)
    const fila: Divergencia = { sku: c.sku, asin: c.asin, via: c.via, amazon: c.amazon, tienda: t }

    if (c.amazon > 0 && t === 0) d.sobreventa.push(fila)
    else if (c.amazon === 0 && t > 0) d.ventaPerdida.push(fila)
    else if (c.amazon > 0 && t > 0 && c.amazon !== t) d.distinta.push(fila)
    else d.iguales += 1
  }

  d.sobreventa.sort((a, b) => b.amazon - a.amazon || a.sku.localeCompare(b.sku))
  d.ventaPerdida.sort((a, b) => b.tienda - a.tienda || a.sku.localeCompare(b.sku))
  d.distinta.sort(
    (a, b) => Math.abs(b.amazon - b.tienda) - Math.abs(a.amazon - a.tienda) || a.sku.localeCompare(b.sku)
  )
  return d
}
