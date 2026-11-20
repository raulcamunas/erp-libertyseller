/**
 * SEO · LA EVOLUCIÓN CON CESTA FIJA. PURO (se prueba sin base de datos).
 *
 * La evolución de siempre (función seo_evolucion) suma TODAS las búsquedas de cada periodo. Pero las búsquedas que da Brand Analytics cambian de un periodo a otro: si una semana entra «lego»
 * con 14 millones de impresiones y 661 nuestras, la cuota de impresiones del producto se hunde sin que haya pasado nada. Comparar así es comparar cestas distintas.
 *
 * Aquí la cesta es FIJA: las `n` búsquedas del producto (relevantes y sin sospecha de ser ajenas, lib/seo/embudo.ts) que más compras mueven en el mercado en el último periodo. En cada periodo se
 * suman solo esas (las que salen ese periodo). Si salen menos de la mitad, el punto es un HUECO (null): no se sabe, y un hueco nunca es un cero.
 */

import type { ConsultaGuardada } from './datos'
import { claveDeBusqueda, diagnosticarTodas, esDelProducto, type OpcionesDeDiagnostico } from './embudo'

export const TAMANO_DE_CESTA = 20
/** Por debajo de esta fracción de la cesta presente en un periodo, el punto es un hueco */
export const PRESENCIA_MINIMA = 0.5

export interface PuntoDeCesta {
  desde: string
  hasta: string
  cuotaImpresiones: number | null
  cuotaClics: number | null
  cuotaCompras: number | null
  /** Las compras del producto en las búsquedas de la cesta presentes */
  comprasAsin: number | null
  /** Las veces que se buscaron las búsquedas de la cesta presentes */
  volumen: number | null
  /** Cuántas búsquedas de la cesta salen en el informe ese periodo, de `total` */
  presentes: number
  total: number
}

export interface OpcionesDeCesta extends OpcionesDeDiagnostico {
  /** El periodo con el que se elige la cesta (su `desde`). Sin él, el último en que el producto tiene búsquedas */
  ultimo?: string
}

/** Lo propio de un escalón: el recuento si está; si no, la cuota por el total */
function propio(asin: number | null | undefined, cuota: number | null | undefined, total: number | null | undefined): number | null {
  if (asin != null) return asin
  if (cuota != null && total != null) return cuota * total
  return null
}

const division = (a: number, b: number) => (b > 0 ? a / b : null)

/**
 * LA CESTA FIJA DE UN PRODUCTO Y SU SERIE.
 * @param filas búsquedas de varios periodos (de toda la cuenta o del producto): se filtran por `asin` y `periodo`
 * @param precio el precio del listing (para descartar las de otro precio al elegir la cesta)
 */
export function cestaFija(filas: readonly ConsultaGuardada[], asin: string, periodo: 'WEEK' | 'MONTH', precio: number | null | undefined, n = TAMANO_DE_CESTA, opciones: OpcionesDeCesta = {}): { consultas: string[]; serie: PuntoDeCesta[] } {
  const delProducto = filas.filter((f) => f.asin === asin && f.periodo === periodo)
  const periodos = [...new Map(delProducto.map((f) => [f.desde, f.hasta])).entries()].sort((a, b) => a[0].localeCompare(b[0]))
  if (periodos.length === 0) return { consultas: [], serie: [] }
  const ultimo = opciones.ultimo && periodos.some(([d]) => d === opciones.ultimo) ? opciones.ultimo : periodos[periodos.length - 1][0]

  // La cesta: las n del producto con más compras del mercado en el último periodo
  const { busquedas } = diagnosticarTodas(
    delProducto.filter((f) => f.desde === ultimo),
    precio,
    opciones
  )
  const cesta = busquedas
    .filter(esDelProducto)
    .sort((a, b) => (b.fila.comprasTotal ?? 0) - (a.fila.comprasTotal ?? 0) || (b.fila.volumen ?? 0) - (a.fila.volumen ?? 0))
    .slice(0, Math.max(0, n))
    .map((d) => d.fila.consulta)
  const claves = new Set(cesta.map(claveDeBusqueda))
  const total = claves.size
  if (total === 0) return { consultas: [], serie: [] }

  const serie = periodos
    .filter(([desde]) => desde <= ultimo)
    .map(([desde, hasta]): PuntoDeCesta => {
      // Una búsqueda por clave (si viniera repetida, la primera)
      const porClave = new Map<string, ConsultaGuardada>()
      for (const f of delProducto) if (f.desde === desde && claves.has(claveDeBusqueda(f.consulta)) && !porClave.has(claveDeBusqueda(f.consulta))) porClave.set(claveDeBusqueda(f.consulta), f)
      const presentes = porClave.size
      if (presentes / total < PRESENCIA_MINIMA) return { desde, hasta, cuotaImpresiones: null, cuotaClics: null, cuotaCompras: null, comprasAsin: null, volumen: null, presentes, total }
      let impT = 0
      let impA = 0
      let cliT = 0
      let cliA = 0
      let comT = 0
      let comA = 0
      let volumen = 0
      for (const f of porClave.values()) {
        volumen += f.volumen ?? 0
        const ia = propio(f.impresionesAsin, f.cuotaImpresiones, f.impresionesTotal)
        if (f.impresionesTotal != null && ia != null) {
          impT += f.impresionesTotal
          impA += ia
        }
        const ca = propio(f.clicsAsin, f.cuotaClics, f.clicsTotal)
        if (f.clicsTotal != null && ca != null) {
          cliT += f.clicsTotal
          cliA += ca
        }
        comT += f.comprasTotal ?? 0
        comA += propio(f.comprasAsin, f.cuotaCompras, f.comprasTotal) ?? 0
      }
      return { desde, hasta, cuotaImpresiones: division(impA, impT), cuotaClics: division(cliA, cliT), cuotaCompras: division(comA, comT), comprasAsin: comA, volumen, presentes, total }
    })
  return { consultas: cesta, serie }
}
