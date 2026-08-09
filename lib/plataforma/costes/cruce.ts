/**
 * DE LA REFERENCIA DEL CLIENTE AL SKU DE AMAZON — DOMINIO PURO
 * ===========================================================
 * Sin base de datos: entran líneas, mapeos y catálogo, salen costes con SKU.
 *
 *
 * ============ AQUÍ TAMPOCO SE CONSTRUYE NINGÚN CRUCE ============
 *
 * El cruce lo hace `crossStock()` de lib/stock-sync/engine.ts, el mismo que
 * decide todas las noches qué unidades se publican en cada listing. Está probado
 * contra los ficheros reales de un cliente (395 filas, 7.877 unidades), sabe
 * distinguir el código exacto de la forma sin ceros a la izquierda, sabe usar el
 * EAN del ERP como desempate y —lo que más importa— SABE NEGARSE A ELEGIR
 * cuando una referencia lleva a dos artículos distintos.
 *
 * La especificación lo pide expresamente («reutiliza el que ya existe en la
 * sincronización de stock») y el motivo es fácil de ver: un cruce que se
 * equivoca no da error. Le pone a un listing el coste de otro producto, el
 * margen sale de otro producto, y la recomendación de precio que salga de ahí
 * será perfectamente coherente y perfectamente equivocada.
 *
 *
 * ============ EL DETALLE QUE HAY QUE ENTENDER: EL CAMPO `stock` ============
 *
 * `crossStock()` cruza `StockLine`, que lleva un campo `stock`. Aquí no hay
 * stock, y lo que se le pasa en ese campo es EL COSTE EN CÉNTIMOS. No es un
 * apaño: es lo que hace que el motor se niegue a elegir en el caso que a A5 le
 * importa.
 *
 * `pickLine()` (engine.ts) resuelve así una referencia que lleva a varios
 * artículos: si todos los candidatos coinciden en ese número, da igual cuál se
 * escoja y escoge el primero; si difieren, NO ELIGE y descarta la fila. Pasando
 * el coste en céntimos, esa regla se lee exactamente como hay que leerla aquí:
 *
 *   · dos artículos distintos que colapsan en la misma referencia y CUESTAN LO
 *     MISMO → da igual cuál se coja, el coste que se guarda es el mismo;
 *   · dos artículos que colapsan y cuestan DISTINTO → el motor se niega, y hace
 *     bien: elegir a ojo es meterle a un SKU el coste de otro producto.
 *
 * Van en céntimos y no en euros porque el campo es entero y porque comparar
 * enteros no arrastra el error de coma flotante que haría que 12,30 y 12,30
 * pareciesen distintos según cómo se hubieran leído.
 *
 * CONSECUENCIA QUE HAY QUE SABER AL LEER LO QUE DEVUELVE crossStock(): sus
 * estadísticas hablan de «unidades» y sus mensajes de «stock». En este contexto
 * ese número son céntimos, así que `stats.totalUnits` y `stats.zeroStock` NO se
 * enseñan en ninguna pantalla de costes. Lo que sí se aprovecha son las filas
 * casadas, la vía por la que casó cada una y las ambigüedades.
 */

import {
  crossStock,
  type CrossMapping,
  type StockLine,
  type UnmatchedRow,
} from '@/lib/stock-sync/engine'
import { normalizeCode } from '@/lib/types/stock-sync'
import type { StockMatchMethod } from '@/lib/types/stock-sync'
import type { LineaCoste } from './lectura'

/* ------------------------------------------------------------------ */
/* Entrada y salida                                                    */
/* ------------------------------------------------------------------ */

/** Lo que hace falta del espejo del catálogo para cruzar */
export interface ListingParaCruce {
  sku: string
  /** EAN/UPC que trae el informe de listings de Amazon */
  codigo_externo: string | null
}

export interface EntradaCruceCostes {
  lineas: LineaCoste[]
  /**
   * El mapeo verificado del cliente (`stock_mappings`). Vacío si el perfil no
   * tiene enlazado ningún cliente de la sincronización de stock.
   *
   * SIEMPRE de UN SOLO cliente: cruzar el fichero de un cliente contra el mapeo
   * de otro sería mezclar datos de dos vendedores, que es justo lo que prohíbe
   * el compromiso firmado ante Amazon. Quien carga estos mapeos (datos.ts) lo
   * hace con el `stock_client_id` que alguien eligió A MANO en el perfil.
   */
  mapeos: CrossMapping[]
  listings: ListingParaCruce[]
}

/** Cómo se llegó del fichero al SKU */
export type ViaCoste = StockMatchMethod | 'sku_fichero'

export const VIA_COSTE_LABELS: Record<ViaCoste, string> = {
  sku_fichero: 'El fichero ya traía el SKU',
  ref_exacta: 'Referencia exacta',
  ean_erp: 'EAN del ERP del cliente',
  ref_padding: 'Referencia sin ceros a la izquierda',
  ean_listing: 'EAN del listing de Amazon',
  sin_casar: 'Sin casar',
}

export interface CosteCasado {
  sku: string
  linea: LineaCoste
  via: ViaCoste
  /** El SKU no está en el espejo del catálogo. Se importa igual: ver el aviso */
  fueraDelCatalogo: boolean
}

/** Una línea del fichero que no ha llegado a ningún SKU */
export interface LineaSinSku {
  linea: LineaCoste
  motivo: 'sin_coste' | 'ninguna_referencia_apunta' | 'ambigua'
  detalle: string
}

export const MOTIVO_LINEA_LABELS: Record<LineaSinSku['motivo'], string> = {
  sin_coste: 'La fila no trae un coste legible',
  ninguna_referencia_apunta: 'Ningún SKU del catálogo ni del mapeo apunta a esta referencia',
  ambigua: 'La referencia lleva a varios artículos con costes distintos',
}

export interface ResultadoCruceCostes {
  casados: CosteCasado[]
  /** Lo accionable: costes que el cliente ha mandado y no se han podido aplicar */
  lineasSinSku: LineaSinSku[]
  /**
   * Cuántos SKU del catálogo no aparecen en este fichero.
   *
   * NO ES UN ERROR y por eso es un número y no una lista. Un fichero de tarifa
   * de proveedor cubre lo que cubre; que un SKU no venga significa que ese
   * proveedor no lo vende, no que falte nada. Lo que sí es un problema —un SKU
   * que no tiene coste en NINGÚN sitio— lo dice la pantalla de cobertura, que
   * mira el catálogo entero y no un fichero.
   */
  skusNoCubiertos: number
  /** SKU casados que no están en el espejo del catálogo */
  fueraDelCatalogo: number
  avisos: string[]
}

/* ------------------------------------------------------------------ */
/* El cruce                                                            */
/* ------------------------------------------------------------------ */

export function cruzarCostes(entrada: EntradaCruceCostes): ResultadoCruceCostes {
  const avisos: string[] = []
  const casados: CosteCasado[] = []
  const lineasSinSku: LineaSinSku[] = []

  const skusDelCatalogo = new Set(entrada.listings.map((l) => l.sku))

  // ---------- Las que no traen coste no entran al cruce ----------
  // No es un descarte silencioso: se cuentan y salen en la lista de trabajo. Lo
  // que no pueden hacer es participar en el cruce, porque una línea sin coste
  // compitiendo con otra que sí lo tiene haría que el motor viera dos candidatos
  // «con valor distinto» y se negara a casar el bueno.
  const conCoste: LineaCoste[] = []
  for (const linea of entrada.lineas) {
    if (linea.coste === null) {
      lineasSinSku.push({
        linea,
        motivo: 'sin_coste',
        detalle:
          'La celda de coste está vacía, es texto o vale cero. No se importa: «sin coste» y «coste cero» ' +
          'no son lo mismo, y un margen calculado sobre cero sale fantástico y falso.',
      })
      continue
    }
    conCoste.push(linea)
  }

  // ---------- 1) El camino corto: el fichero ya trae el SKU ----------
  // Sin cruce no hay cruce que se equivoque. Cuando el cliente exporta desde una
  // hoja que ya lleva el SKU de Amazon, no hay nada que interpretar.
  const paraCruzar: LineaCoste[] = []
  const skusPorFichero = new Set<string>()

  for (const linea of conCoste) {
    if (!linea.sku) {
      paraCruzar.push(linea)
      continue
    }
    const fuera = !skusDelCatalogo.has(linea.sku)
    casados.push({ sku: linea.sku, linea, via: 'sku_fichero', fueraDelCatalogo: fuera })
    skusPorFichero.add(linea.sku)
  }

  // ---------- 2) El resto, por el motor de la sincronización de stock ----------
  if (paraCruzar.length > 0) {
    const lineasStock: StockLine[] = paraCruzar.map((linea) => ({
      articulo: linea.articulo,
      articuloNorm: linea.articuloNorm,
      descripcion: linea.descripcion,
      // EL COSTE EN CÉNTIMOS. Ver la cabecera de este fichero: es lo que hace
      // que el motor se niegue a casar cuando dos artículos que colapsan en la
      // misma referencia cuestan distinto.
      stock: Math.round((linea.coste as number) * 100),
    }))

    // El índice de EAN sale DEL PROPIO FICHERO de costes: si trae columna de
    // código de barras, eso es exactamente lo que consume la vía 'ean_erp' del
    // motor —el EAN que el ERP del cliente le atribuye a cada artículo—, que es
    // la que desempata las referencias que solo se diferencian en los ceros.
    const eanIndex = new Map<string, string[]>()
    for (const linea of paraCruzar) {
      if (!linea.ean || !linea.articulo) continue
      const lista = eanIndex.get(linea.articulo)
      if (lista) {
        if (!lista.includes(linea.ean)) lista.push(linea.ean)
      } else {
        eanIndex.set(linea.articulo, [linea.ean])
      }
    }

    // ORDEN DELIBERADO: primero el catálogo, después el mapeo verificado.
    // crossStock() se queda con la ÚLTIMA fila de cada SKU repetido, así que el
    // mapeo —que alguien comprobó contra los ficheros reales del cliente— gana
    // sobre la suposición «la referencia del fichero será el SKU».
    const mappings: CrossMapping[] = [
      ...entrada.listings.map((listing) => ({
        sku_amazon: listing.sku,
        ref_erp: listing.sku,
        ean_amazon: listing.codigo_externo,
      })),
      ...entrada.mapeos,
    ]

    const cruce = crossStock({ mappings, stockLines: lineasStock, eanIndex })

    const porArticulo = new Map<string, LineaCoste>()
    for (const linea of paraCruzar) {
      if (!porArticulo.has(linea.articulo)) porArticulo.set(linea.articulo, linea)
    }

    const articulosCasados = new Set<string>()
    for (const fila of cruce.rows) {
      const linea = porArticulo.get(fila.articulo)
      if (!linea) continue
      articulosCasados.add(fila.articulo)
      casados.push({
        sku: fila.sku,
        linea,
        via: fila.via,
        fueraDelCatalogo: !skusDelCatalogo.has(fila.sku),
      })
    }

    // ---------- Lo accionable: líneas del fichero que no han llegado a nadie ----------
    //
    // ES LA DIRECCIÓN CONTRARIA A LA QUE MIRA LA SINCRONIZACIÓN DE STOCK, y la
    // diferencia es la razón de este bloque. Allí lo grave es el SKU que se
    // queda sin actualizar, porque Amazon conserva el stock de ayer y el cliente
    // vende lo que no tiene. Aquí un SKU que no viene en el fichero no es
    // ningún problema: la tarifa de un proveedor cubre lo que cubre. Lo que sí
    // hay que arreglar es al revés — un coste que el cliente nos ha mandado y
    // que no hemos sabido a quién aplicarle.
    const ambiguas = new Map<string, UnmatchedRow>()
    for (const fila of cruce.unmatched) {
      if (fila.reason !== 'ref_ambigua' && fila.reason !== 'ean_ambiguo') continue
      const clave = normalizeCode(fila.refErp ?? '')
      if (clave && !ambiguas.has(clave)) ambiguas.set(clave, fila)
    }

    for (const linea of paraCruzar) {
      if (articulosCasados.has(linea.articulo)) continue
      const ambigua = ambiguas.get(linea.articuloNorm)
      lineasSinSku.push({
        linea,
        motivo: ambigua ? 'ambigua' : 'ninguna_referencia_apunta',
        detalle: ambigua
          ? `${ambigua.detail} (El motor de cruce se comparte con la sincronización de stock y habla de ` +
            '«stock»; aquí el número que compara es el coste en céntimos.)'
          : `Ni el catálogo de Amazon ni el mapeo del cliente tienen ningún SKU con la referencia «${
              linea.articulo || linea.sku
            }». O el mapeo está incompleto, o es un artículo que no se vende en Amazon.`,
      })
    }

    if (cruce.stats.duplicatedSkus > 0) {
      avisos.push(
        `${cruce.stats.duplicatedSkus} SKU aparecían repetidos entre el catálogo y el mapeo del cliente; ` +
          'ha mandado la fila del mapeo, que es la que alguien ha verificado.'
      )
    }
  }

  // ---------- Recuento final ----------
  const skusCasados = new Set(casados.map((c) => c.sku))
  let skusNoCubiertos = 0
  for (const sku of skusDelCatalogo) if (!skusCasados.has(sku)) skusNoCubiertos += 1

  const fueraDelCatalogo = casados.filter((c) => c.fueraDelCatalogo).length
  if (fueraDelCatalogo > 0) {
    avisos.push(
      `${fueraDelCatalogo} ${fueraDelCatalogo === 1 ? 'coste va' : 'costes van'} a un SKU que no está en el ` +
        'espejo del catálogo. Se guardan igual —el coste es del cliente, no de Amazon— pero no se van a ver ' +
        'en ninguna pantalla de margen hasta que el censo del catálogo traiga ese SKU. Si el censo ya ha ' +
        'corrido, comprueba que el SKU está bien escrito.'
    )
  }

  const ambiguas = lineasSinSku.filter((l) => l.motivo === 'ambigua').length
  if (ambiguas > 0) {
    avisos.push(
      `${ambiguas} ${ambiguas === 1 ? 'línea se ha quedado' : 'líneas se han quedado'} fuera porque su ` +
        'referencia, quitados los ceros a la izquierda, lleva a varios artículos con COSTES DISTINTOS y ' +
        'ningún EAN los desempata. Se descartan a propósito: meterle a un SKU el coste de otro producto ' +
        'produce un margen coherente y equivocado, que es peor que no tener margen.'
    )
  }

  return {
    casados,
    lineasSinSku,
    skusNoCubiertos,
    fueraDelCatalogo,
    avisos,
  }
}

/**
 * Dos costes casados sobre el mismo SKU: el fichero trae dos filas que apuntan
 * al mismo listing con importes distintos.
 *
 * Puede pasar cuando el fichero mezcla dos referencias del ERP que en Amazon son
 * el mismo producto. Se resuelve NO ELIGIENDO, igual que en el resto del módulo:
 * las dos se apartan y se dicen. Devuelve las filas que se pueden guardar y las
 * que se quedan fuera.
 */
export function apartarSkusEnConflicto(casados: CosteCasado[]): {
  buenos: CosteCasado[]
  conflictos: CosteCasado[]
  aviso: string | null
} {
  const porSku = new Map<string, CosteCasado[]>()
  for (const fila of casados) {
    const lista = porSku.get(fila.sku)
    if (lista) lista.push(fila)
    else porSku.set(fila.sku, [fila])
  }

  const buenos: CosteCasado[] = []
  const conflictos: CosteCasado[] = []

  for (const filas of porSku.values()) {
    if (filas.length === 1) {
      buenos.push(filas[0])
      continue
    }
    // Mismo importe en todas: da igual cuál se guarde.
    const distintos = new Set(filas.map((f) => JSON.stringify(huellaImporte(f))))
    if (distintos.size === 1) buenos.push(filas[0])
    else conflictos.push(...filas)
  }

  return {
    buenos,
    conflictos,
    aviso:
      conflictos.length === 0
        ? null
        : `${conflictos.length} filas del fichero apuntan al mismo SKU con costes distintos y se han apartado ` +
          'todas. No se puede elegir una sin inventarse cuál es la buena: mira esas referencias en el fichero ' +
          'del cliente y déjale una sola.',
  }
}

function huellaImporte(fila: CosteCasado): unknown[] {
  return [
    fila.linea.coste,
    fila.linea.costeEnvio,
    fila.linea.costeAlmacen,
    fila.linea.costeFlete,
    fila.linea.moneda,
    fila.linea.validoDesde,
  ]
}
