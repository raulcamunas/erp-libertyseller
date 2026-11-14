/**
 * SEO · LO QUE SE CRUZA CON MARKETING TEST. PURO (se prueba sin base de datos).
 *
 *   · «Vende por publicidad y no está en la ficha»: términos de búsqueda de las campañas del producto que han traído pedidos y cuyas palabras no aparecen en la ficha. Son keywords probadas con
 *     dinero: si convierten pagando, en la ficha tienen que estar.
 *   · «Búsquedas con volumen sin campaña EXACTA»: búsquedas del Search Query Performance con compras en Amazon a las que el producto no apunta con una keyword en concordancia exacta.
 */

import { coberturaDe, normalizar } from './cobertura'
import type { ConsultaGuardada, FichaGuardada } from './datos'

export interface TerminoDeAds {
  termino: string
  pedidos: number
  ventas: number
  clics: number
  gasto: number
}

/** Un término de búsqueda que es un ASIN (los de las campañas de producto) no es una palabra para la ficha */
const esAsin = (t: string) => /^b0[a-z0-9]{8}$/i.test(t.trim())

/** Suma los términos repetidos (el mismo término en varias campañas o grupos) */
export function sumarTerminos(filas: ReadonlyArray<TerminoDeAds>): TerminoDeAds[] {
  const por = new Map<string, TerminoDeAds>()
  for (const f of filas) {
    const k = normalizar(f.termino)
    if (!k || esAsin(k)) continue
    const x = por.get(k)
    if (!x) por.set(k, { ...f, termino: f.termino.trim() })
    else {
      x.pedidos += f.pedidos
      x.ventas += f.ventas
      x.clics += f.clics
      x.gasto += f.gasto
    }
  }
  return [...por.values()]
}

/** Los términos con pedidos que tienen alguna palabra que no está en ninguna parte de la ficha. Los que más venden primero */
export function terminosQueFaltanEnLaFicha(terminos: ReadonlyArray<TerminoDeAds>, ficha: FichaGuardada | null, max = 25): Array<TerminoDeAds & { faltan: string[] }> {
  if (!ficha) return []
  return sumarTerminos(terminos)
    .filter((t) => t.pedidos > 0)
    .map((t) => ({ ...t, faltan: coberturaDe(t.termino, ficha).faltan }))
    .filter((t) => t.faltan.length > 0)
    .sort((a, b) => b.pedidos - a.pedidos || b.ventas - a.ventas)
    .slice(0, max)
}

export interface BusquedaSinExacta {
  consulta: string
  volumen: number | null
  comprasTotal: number | null
  cuotaCompras: number | null
  /** Ya se puja por ella, pero en amplia o frase */
  enOtraConcordancia: boolean
}

/** Las búsquedas que venden en Amazon y no tienen keyword EXACTA en las campañas del producto. Las que más compras mueven primero */
export function busquedasSinExacta(consultas: ReadonlyArray<ConsultaGuardada>, exactas: ReadonlySet<string>, otras: ReadonlySet<string>, max = 20): BusquedaSinExacta[] {
  const vistas = new Set<string>()
  const salida: BusquedaSinExacta[] = []
  for (const c of [...consultas].sort((a, b) => (b.comprasTotal ?? 0) - (a.comprasTotal ?? 0) || (b.volumen ?? 0) - (a.volumen ?? 0))) {
    const k = normalizar(c.consulta)
    if (!k || vistas.has(k) || exactas.has(k) || esAsin(k)) continue
    vistas.add(k)
    if ((c.comprasTotal ?? 0) <= 0) continue
    salida.push({ consulta: c.consulta, volumen: c.volumen, comprasTotal: c.comprasTotal, cuotaCompras: c.cuotaCompras, enOtraConcordancia: otras.has(k) })
    if (salida.length >= max) break
  }
  return salida
}
