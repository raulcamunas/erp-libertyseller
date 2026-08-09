/**
 * VELOCIDAD DE VENTAS — DOMINIO PURO
 * ==================================
 * Sin base de datos y sin reloj.
 *
 *
 * ESTE FICHERO ES LA INTERFAZ QUE PIDE LA ESPECIFICACIÓN PARA LA FASE B
 * --------------------------------------------------------------------
 * §B1: «GET_SALES_AND_TRAFFIC_REPORT sustituye el CSV externo del módulo A4.
 * Diseña A4 con esa interfaz desde el principio para que el cambio sea
 * transparente.»
 *
 * Ese informe necesita el rol de Análisis de marcas, que está SOLICITADO Y
 * PENDIENTE. Hasta que llegue, las ventas entran por CSV (Sellerboard o Business
 * Reports de Seller Central). Lo que hace que el cambio sea transparente es esto:
 *
 *   · nadie lee amazon_ventas_externas directamente. Se llama a estas funciones.
 *   · cada fila lleva su ORIGEN, y el origen forma parte de la clave única, así
 *     que el CSV y la API pueden convivir el mismo día sin pisarse.
 *   · cuando hay varias fuentes para el mismo (SKU, día), gana la más fiable
 *     según PRIORIDAD_ORIGEN. El día que llegue el rol se empieza a rellenar con
 *     origen 'sp_api' y estas funciones lo prefieren solas.
 *
 * Ni A4, ni el criterio de SKU activo, ni las alertas de reposición se enteran
 * del cambio. Ese es todo el objetivo.
 */

import type { OrigenVentas, VentaExterna } from './tipos'

/**
 * De más fiable a menos. Número más bajo gana.
 *
 * 'sp_api' arriba porque es el propio Amazon contando sus ventas: no hay
 * conversión de divisa, ni redondeos de un exportador, ni el desfase de un
 * fichero que alguien bajó el martes. Sellerboard va por delante de los Business
 * Reports porque ya viene consolidado por SKU; los Business Reports vienen por
 * ASIN y hay que repartirlos, lo que introduce un supuesto. Y el CSV manual es
 * el último porque lo ha tecleado alguien.
 */
export const PRIORIDAD_ORIGEN: Record<OrigenVentas, number> = {
  sp_api: 0,
  csv_sellerboard: 1,
  csv_business_reports: 2,
  csv_manual: 3,
}

export const ORIGEN_VENTAS_LABELS: Record<OrigenVentas, string> = {
  sp_api: 'Informe de ventas y tráfico de Amazon',
  csv_sellerboard: 'CSV de Sellerboard',
  csv_business_reports: 'CSV de Business Reports',
  csv_manual: 'CSV a mano',
}

/** Lo mínimo que hace falta de una fila para agregarla */
export type FilaVentas = Pick<
  VentaExterna,
  'sku' | 'marketplace_id' | 'fecha' | 'unidades' | 'sesiones' | 'origen'
>

export interface VentasDeSku {
  sku: string
  marketplaceId: string
  /** Suma de unidades de los días que TIENEN dato */
  unidades: number
  sesiones: number | null
  /** Cuántos días distintos aportaron dato. Es lo que distingue «vendió 3 en
      treinta días» de «vendió 3 el único día del que tenemos datos» */
  diasConDato: number
  /** Los orígenes que se han acabado usando, para poder explicar la cifra */
  origenes: OrigenVentas[]
}

/**
 * Agrega ventas por SKU quedándose con la MEJOR fuente de cada día.
 *
 * Sin este paso, importar el CSV de Sellerboard sobre un cliente que ya tenía
 * Business Reports duplicaría las unidades de todos los días solapados: el
 * criterio de rotación diría que todo rota el doble y el conjunto activo se
 * duplicaría de golpe. Es un fallo que no da ningún error.
 */
export function agregarVentas(filas: FilaVentas[]): Map<string, VentasDeSku> {
  /** clave -> (día -> mejor fila de ese día) */
  const mejorPorDia = new Map<string, Map<string, FilaVentas>>()

  for (const fila of filas) {
    const clave = `${fila.marketplace_id}|${fila.sku}`
    let dias = mejorPorDia.get(clave)
    if (!dias) {
      dias = new Map<string, FilaVentas>()
      mejorPorDia.set(clave, dias)
    }
    const actual = dias.get(fila.fecha)
    if (actual === undefined || PRIORIDAD_ORIGEN[fila.origen] < PRIORIDAD_ORIGEN[actual.origen]) {
      dias.set(fila.fecha, fila)
    }
  }

  const salida = new Map<string, VentasDeSku>()
  for (const [clave, dias] of mejorPorDia) {
    const [marketplaceId, ...resto] = clave.split('|')
    // El SKU puede llevar barras verticales: se recompone lo que quedó detrás
    // del primer separador en vez de quedarse con el segundo trozo.
    const sku = resto.join('|')

    let unidades = 0
    let sesiones = 0
    let haySesiones = false
    let diasConDato = 0
    const origenes = new Set<OrigenVentas>()

    for (const fila of dias.values()) {
      origenes.add(fila.origen)
      if (fila.unidades !== null) {
        unidades += fila.unidades
        diasConDato += 1
      }
      if (fila.sesiones !== null) {
        sesiones += fila.sesiones
        haySesiones = true
      }
    }

    salida.set(clave, {
      sku,
      marketplaceId,
      unidades,
      sesiones: haySesiones ? sesiones : null,
      diasConDato,
      origenes: [...origenes].sort((a, b) => PRIORIDAD_ORIGEN[a] - PRIORIDAD_ORIGEN[b]),
    })
  }

  return salida
}

/**
 * Solo las unidades, indexadas por SKU, para un marketplace.
 *
 * Es lo que consume el criterio de SKU activo. Devuelve un Map de SKU a número;
 * un SKU que no está en el Map es un SKU DEL QUE NO SABEMOS NADA, y eso no es
 * cero: quien lo consulta tiene que distinguirlo (ver `unidadesVentana` en
 * activos.ts, que acepta null a propósito).
 */
export function unidadesPorSku(filas: FilaVentas[], marketplaceId: string): Map<string, number> {
  const agregado = agregarVentas(filas.filter((f) => f.marketplace_id === marketplaceId))
  const salida = new Map<string, number>()
  for (const v of agregado.values()) {
    salida.set(v.sku, v.unidades)
  }
  return salida
}

/**
 * Qué parte del catálogo tiene datos de ventas.
 *
 * Igual que la cobertura de costes: un filtro de rotación sobre un catálogo del
 * que solo conocemos las ventas del 20 % no filtra por rotación, filtra por
 * quién se molestó en importar el fichero.
 */
export function coberturaDeVentas(
  skus: string[],
  unidades: Map<string, number>
): { total: number; conDatos: number; cobertura: number | null } {
  const conDatos = skus.filter((sku) => unidades.has(sku)).length
  return {
    total: skus.length,
    conDatos,
    cobertura: skus.length === 0 ? null : conDatos / skus.length,
  }
}
