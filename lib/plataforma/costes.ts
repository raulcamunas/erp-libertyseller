/**
 * COSTES CON VIGENCIA — DOMINIO PURO
 * ==================================
 * Sin base de datos y sin reloj: la fecha entra por parámetro.
 *
 * POR QUÉ ESTO NO ES UN `SELECT ... ORDER BY valido_desde DESC LIMIT 1` Y YA
 * -------------------------------------------------------------------------
 * Porque el margen de marzo se calcula con el coste de marzo. En cuanto A3
 * («margen regalado», comparar precio real contra FOEP histórico) mira hacia
 * atrás, necesita el coste QUE REGÍA ESE DÍA, no el de hoy. Con una sola cifra
 * sobreescribible, todo el histórico de margen se reescribe cada vez que el
 * proveedor sube precios y nadie se entera de que las cifras del mes pasado ya
 * no son las que se le enseñaron al cliente.
 *
 * Y por eso no hay `valido_hasta` en la tabla: sería un dato derivado que hay
 * que mantener a mano y que se desincroniza el primer día que alguien inserte un
 * tramo intermedio.
 */

import type { CosteProducto } from './tipos'

/** Lo mínimo que hace falta de una fila de coste para resolver la vigencia */
export type TramoCoste = Pick<CosteProducto, 'sku' | 'coste' | 'moneda' | 'valido_desde'>

/**
 * El coste que regía en una fecha.
 *
 * `fecha` es 'YYYY-MM-DD'. Se compara como TEXTO a propósito: en formato ISO el
 * orden lexicográfico y el cronológico coinciden, y comparar cadenas evita
 * construir Date con horas que un cambio de zona horaria desplazaría un día —que
 * en el límite de un tramo es justo el error que nadie ve.
 *
 * Devuelve null cuando no había coste todavía. NUNCA cero: un margen calculado
 * con coste cero es un margen fantástico y falso, y es la clase de cifra que
 * acaba en una presentación para el cliente.
 */
export function costeVigente<T extends TramoCoste>(tramos: T[], fecha: string): T | null {
  let mejor: T | null = null
  for (const tramo of tramos) {
    if (tramo.valido_desde > fecha) continue
    if (mejor === null || tramo.valido_desde > mejor.valido_desde) mejor = tramo
  }
  return mejor
}

/**
 * Lo mismo para un catálogo entero, en una pasada.
 *
 * Devuelve un Map por SKU. Se hace aquí y no con una consulta por SKU porque
 * trece mil consultas son trece mil viajes: se trae el histórico de costes del
 * cliente (que son miles de filas, no millones) y se resuelve en memoria.
 */
export function costesVigentesPorSku<T extends TramoCoste>(
  tramos: T[],
  fecha: string
): Map<string, T> {
  const salida = new Map<string, T>()
  for (const tramo of tramos) {
    if (tramo.valido_desde > fecha) continue
    const actual = salida.get(tramo.sku)
    if (actual === undefined || tramo.valido_desde > actual.valido_desde) {
      salida.set(tramo.sku, tramo)
    }
  }
  return salida
}

export interface CoberturaCostes {
  /** SKU mirados */
  total: number
  /** De esos, los que tienen coste conocido en la fecha */
  conCoste: number
  /** 0..1. null cuando no hay ningún SKU que medir */
  cobertura: number | null
  /** Los que no lo tienen, para poder pedirlos */
  sinCoste: string[]
}

/**
 * Qué porcentaje del catálogo tiene coste conocido.
 *
 * La especificación lo pide literalmente (§3.6): «Sin esto no sabes de qué
 * análisis te puedes fiar». Un informe de margen sobre el 30 % del catálogo no
 * es un informe de margen, es una muestra sesgada hacia lo que alguien se
 * molestó en rellenar.
 */
export function coberturaDeCostes<T extends TramoCoste>(
  skus: string[],
  tramos: T[],
  fecha: string
): CoberturaCostes {
  const vigentes = costesVigentesPorSku(tramos, fecha)
  const sinCoste = skus.filter((sku) => !vigentes.has(sku))
  const total = skus.length
  return {
    total,
    conCoste: total - sinCoste.length,
    cobertura: total === 0 ? null : (total - sinCoste.length) / total,
    sinCoste,
  }
}
