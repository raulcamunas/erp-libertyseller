/**
 * AMAZON ADS · AGRUPAR LAS CAMPAÑAS POR PRODUCTO (por el ASIN que lleva el nombre).
 *
 * PURO. Una cuenta con 50 campañas son en realidad una docena de productos con 3 o 4 campañas cada uno (Automática, Amplia, Exacta, Ataque…). Aquí se saca el ASIN de cada campaña y se agrupan, para
 * ver el rendimiento POR PRODUCTO y no una lista plana.
 *
 * El ASIN sale de la nomenclatura del SOP («ASIN | SKU | RESUMEN | ESTRATEGIA») y, si la campaña no la sigue, del primer ASIN que aparezca en el nombre (las campañas que crea Amazon por su cuenta
 * se llaman, por ejemplo, «[ProductAI] ES-B0GXGPXR1X-JAMONERO-SP-PAT-May042026»). Las que no llevan ninguno van a un grupo aparte, «Sin producto identificado»: no se inventa.
 */

import { partesDeNombre } from './reglas'
import { totalesDe, type Totales } from './rendimiento-calculo'

const ASIN = /\bB0[A-Z0-9]{8}\b/

export function asinDeCampana(nombre: string): string | null {
  const p = partesDeNombre(nombre)
  if (p && /^B0[A-Z0-9]{8}$/.test(p.asin)) return p.asin
  return nombre.toUpperCase().match(ASIN)?.[0] ?? null
}

/** Un nombre corto del producto sacado del de la campaña: el RESUMEN de la nomenclatura o, en las de Amazon, la palabra que sigue al ASIN. null si no hay */
export function resumenDeCampana(nombre: string): string | null {
  const p = partesDeNombre(nombre)
  if (p) return p.resumen || null
  const m = nombre.match(/B0[A-Z0-9]{8}[-_ ]+([A-Za-zÁÉÍÓÚÑáéíóúñ0-9]+)/)
  return m ? m[1].toUpperCase() : null
}

export interface GrupoDeProducto<T> {
  /** El ASIN, o 'sin-producto' */
  clave: string
  asin: string | null
  titulo: string
  campanas: T[]
  totales: Totales
}

export const CLAVE_SIN_PRODUCTO = 'sin-producto'

/** El más repetido de una lista (el primero que aparezca si empatan) */
function masFrecuente(valores: readonly string[]): string | null {
  const cuenta = new Map<string, number>()
  for (const v of valores) cuenta.set(v, (cuenta.get(v) ?? 0) + 1)
  let mejor: string | null = null
  let n = 0
  for (const [v, c] of cuenta) if (c > n) [mejor, n] = [v, c]
  return mejor
}

/**
 * Agrupa por ASIN, de más a menos gasto (el grupo sin producto, siempre al final). `conocidos` son los productos que ya están dados de alta en la cuenta (asin → resumen): su nombre manda sobre el que se
 * deduzca de las campañas.
 */
export function agruparPorProducto<T extends Totales & { nombre: string }>(campanas: readonly T[], conocidos: ReadonlyMap<string, string> = new Map()): Array<GrupoDeProducto<T>> {
  const por = new Map<string, T[]>()
  for (const c of campanas) {
    const clave = asinDeCampana(c.nombre) ?? CLAVE_SIN_PRODUCTO
    const lista = por.get(clave)
    if (lista) lista.push(c)
    else por.set(clave, [c])
  }
  const grupos: Array<GrupoDeProducto<T>> = [...por.entries()].map(([clave, lista]) => {
    const asin = clave === CLAVE_SIN_PRODUCTO ? null : clave
    const titulo = asin === null ? 'Sin producto identificado' : (conocidos.get(asin) ?? masFrecuente(lista.map((c) => resumenDeCampana(c.nombre)).filter((x): x is string => !!x)) ?? asin)
    return { clave, asin, titulo, campanas: lista, totales: totalesDe(lista) }
  })
  return grupos.sort((a, b) => (a.asin === null ? 1 : b.asin === null ? -1 : b.totales.gasto - a.totales.gasto))
}
