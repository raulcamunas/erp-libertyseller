/**
 * AMAZON ADS · LAS REGLAS DEL SOP, COMO FUNCIONES PURAS (el motor, en modo sombra).
 *
 * De los términos de búsqueda de una ventana (informe `spSearchTerm`) y de los números de la ficha de cuenta salen PROPUESTAS de cambio, cada una con su motivo en una línea. Aquí NO se habla con
 * Amazon ni con la base: lo que entra y lo que sale son datos. Quien llame decidirá qué se hace con las propuestas (enseñarlas para aprobar, aplicarlas, anotarlas en el log).
 *
 *
 * ============ LAS DOS REGLAS DE ESTA PRIMERA PIEZA ============
 *
 *   NEGATIVIZAR  gasto sin venta ≥ (veces el CPA objetivo de la ficha) Y clics ≥ (mínimo de la ficha) Y cero compras. SOP: «Gasto sin venta antes de negativizar: 2× el CPA objetivo, con mínimo
 *                de 15 clics».
 *   PROMOVER     un término con ≥ N compras con ACoS ≤ objetivo en la ventana pasa un escalón del embudo: AUTO RADAR → MANUAL AMPLIA → MANUAL EXACTA / DOMINIO. Al subir, se negativiza en la campaña de
 *                origen para que no compitan (SOP: «la misma keyword compitiendo en Amplia y en Exacta se negativiza en la Amplia»).
 *
 * Y la regla de oro que las envuelve (principio 03): NADA SE TOCA SIN MUESTRA SUFICIENTE. Un término con menos clics que la muestra mínima no genera ninguna propuesta.
 *
 * Lo que NO hace todavía: ajustar pujas, subir presupuesto, pasar a ESTABILIDAD, vigilar gasto anormal. Cada regla se añade aquí con sus pruebas.
 */

import type { Rol } from './estructura'

export interface TerminoDeBusqueda {
  termino: string
  campaignId: string
  campaignName: string
  adGroupName?: string
  clics: number
  gasto: number
  compras: number
  ventas: number
}

export interface UmbralesDeFicha {
  comprasParaExacta: number
  clicsMinimosNegativizar: number
  muestraMinimaClics: number
}

export interface ObjetivosParaReglas {
  /** ACoS objetivo del producto, en % */
  acosObjetivoPct: number
  /** Gasto sin venta a partir del cual se negativiza (ya multiplicado por el factor de la ficha) */
  gastoMaximoSinVenta: number
}

export type TipoDePropuesta = 'negativizar' | 'promover'

export interface Propuesta {
  tipo: TipoDePropuesta
  termino: string
  /** La campaña donde se ha visto el término */
  campaignId: string
  campaignName: string
  desdeRol: Rol | null
  /** A qué campaña sube (solo en «promover») */
  haciaRol: Rol | null
  /** Para «promover»: también hay que negativizarlo en la campaña de origen */
  negativizarEnOrigen: boolean
  /** Una línea: qué dato justifica el cambio */
  motivo: string
  clics: number
  gasto: number
  compras: number
  acosPct: number | null
}

const ROLES_CONOCIDOS: readonly Rol[] = ['AUTO RADAR', 'MANUAL AMPLIA', 'MANUAL EXACTA / DOMINIO', 'MANUAL EXACTA / ESTABILIDAD', 'ATAQUE ASIN']

/** De «ASIN | SKU | RESUMEN | ESTRATEGIA» a sus partes. null si el nombre no sigue la nomenclatura (campañas viejas o de otro sistema: el motor no las toca) */
export function partesDeNombre(nombre: string): { asin: string; sku: string; resumen: string; rol: Rol } | null {
  const trozos = nombre.split('|').map((t) => t.trim())
  if (trozos.length < 4) return null
  const rol = trozos[trozos.length - 1].replace(/\s+/g, ' ').toUpperCase() as Rol
  if (!ROLES_CONOCIDOS.includes(rol)) return null
  return { asin: trozos[0].toUpperCase(), sku: trozos[1], resumen: trozos.slice(2, -1).join(' | '), rol }
}

/** El escalón al que sube un término desde cada campaña. ESTABILIDAD y ATAQUE ASIN no promueven: no son un escalón del embudo */
const SIGUIENTE: Partial<Record<Rol, Rol>> = {
  'AUTO RADAR': 'MANUAL AMPLIA',
  'MANUAL AMPLIA': 'MANUAL EXACTA / DOMINIO',
}

const redondear = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d

/**
 * Las propuestas para un conjunto de términos. Se juzga cada término en cada campaña por separado, y un mismo término no produce dos propuestas en la misma campaña (si cumple las dos reglas, manda
 * la de promover, que es la que tiene compras).
 */
export function proponerCambios(terminos: readonly TerminoDeBusqueda[], umbrales: UmbralesDeFicha, objetivos: ObjetivosParaReglas): Propuesta[] {
  const propuestas: Propuesta[] = []
  const vistos = new Set<string>()

  for (const t of terminos) {
    const partes = partesDeNombre(t.campaignName)
    if (!partes) continue // fuera de la nomenclatura: no se toca
    const clave = `${t.campaignId}|${t.termino.trim().toLowerCase()}`
    if (vistos.has(clave)) continue
    vistos.add(clave)

    // Principio 03: sin muestra suficiente no se decide nada
    if (t.clics < umbrales.muestraMinimaClics) continue

    const acos = t.ventas > 0 ? redondear((t.gasto / t.ventas) * 100, 1) : null
    const base = { termino: t.termino.trim(), campaignId: t.campaignId, campaignName: t.campaignName, desdeRol: partes.rol, clics: t.clics, gasto: redondear(t.gasto), compras: t.compras, acosPct: acos }

    const siguiente = SIGUIENTE[partes.rol]
    if (siguiente && t.compras >= umbrales.comprasParaExacta && acos !== null && acos <= objetivos.acosObjetivoPct) {
      propuestas.push({
        ...base,
        tipo: 'promover',
        haciaRol: siguiente,
        negativizarEnOrigen: true,
        motivo: `${t.compras} compras con ACoS ${String(acos).replace('.', ',')} % (objetivo ${String(objetivos.acosObjetivoPct).replace('.', ',')} %) en ${t.clics} clics: pasa de ${partes.rol} a ${siguiente}`,
      })
      continue
    }

    if (t.compras === 0 && t.clics >= umbrales.clicsMinimosNegativizar && t.gasto >= objetivos.gastoMaximoSinVenta) {
      propuestas.push({
        ...base,
        tipo: 'negativizar',
        haciaRol: null,
        negativizarEnOrigen: false,
        motivo: `${String(redondear(t.gasto)).replace('.', ',')} gastados en ${t.clics} clics sin ninguna venta (el tope es ${String(objetivos.gastoMaximoSinVenta).replace('.', ',')} y ${umbrales.clicsMinimosNegativizar} clics)`,
      })
    }
  }

  // Primero lo que mejora (promover), luego lo que ahorra, y dentro de cada tipo lo que más gasto mueve
  return propuestas.sort((a, b) => (a.tipo === b.tipo ? b.gasto - a.gasto : a.tipo === 'promover' ? -1 : 1))
}
