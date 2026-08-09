/**
 * CATALOG ITEMS 2022-04-01: MARCA, CATEGORÍA, MEDIDAS Y BSR
 * ========================================================
 * SOLO SERVIDOR.
 *
 * De aquí salen los cuatro datos que la especificación pide para la tabla de SKU
 * y que la Listings API no da: marca, categoría, peso y dimensiones. Y el BSR,
 * que va a su serie temporal.
 *
 *
 * POR QUÉ searchCatalogItems Y NO getCatalogItem
 * ---------------------------------------------
 * getCatalogItem es de uno en uno. searchCatalogItems admite 20 ASIN por
 * llamada, y las dos van a 2 peticiones por segundo. Con 13.700 referencias eso
 * es la diferencia entre SEIS MINUTOS y CASI DOS HORAS por cliente y país. La
 * propia documentación de Amazon dice que se use searchCatalogItems para leer
 * varios artículos de golpe.
 *
 *
 * LA TRAMPA QUE HAY QUE TAPAR SÍ O SÍ
 * -----------------------------------
 * getCatalogItem devuelve 404 cuando un ASIN no existe en ese país.
 * searchCatalogItems, EN CAMBIO, DEVUELVE 200 Y SE LO SALTA: pides veinte,
 * existen dieciocho, te llegan dieciocho. Sin error, sin hueco, sin aviso.
 *
 * Si nadie compara lo pedido con lo devuelto, un ASIN que Amazon retira del
 * catálogo deja de refrescarse y su histórico se congela sin que nadie lo note.
 * Y el histórico es justamente el activo que se está construyendo, así que se
 * corrompe en silencio. Por eso `leerCatalogoItems` devuelve `ausentes`, y por
 * eso quien llama TIENE que contarlo.
 *
 *
 * Y UN AVISO SOBRE LAS UNIDADES
 * -----------------------------
 * En el ejemplo oficial de la documentación, el MISMO paquete viene medido en
 * pulgadas y pesado en kilogramos. Aquí no se convierte nada: cada número sale
 * con su unidad y la conversión, si algún día hace falta, se hace donde se
 * sepa para qué. Un peso sin unidad es un peso inventado, y de ese número sale
 * la tarifa de FBA con la que A4 recomendará mover inventario.
 */

import { spApiRequest, type AmazonCredentials } from '@/lib/amazon/sp-api'
import type { ClasificacionItem } from '../tipos'

/** Máximo de identificadores por llamada. Es el número mágico de toda la SP-API */
export const MAX_ASINS_POR_LLAMADA = 20

/** Bloques de datos que sabemos leer. `vendorDetails` no: somos sellers, no vendors */
export type BloqueCatalogo = 'summaries' | 'dimensions' | 'salesRanks' | 'identifiers'

/* ------------------------------------------------------------------ */
/* Lo que devuelve, ya aplanado                                        */
/* ------------------------------------------------------------------ */

export interface Medidas {
  peso: number | null
  pesoUnidad: string | null
  largo: number | null
  ancho: number | null
  alto: number | null
  dimsUnidad: string | null
}

export const MEDIDAS_VACIAS: Medidas = {
  peso: null,
  pesoUnidad: null,
  largo: null,
  ancho: null,
  alto: null,
  dimsUnidad: null,
}

/**
 * Un puesto en un ranking de ventas.
 *
 *   'grupo'     -> displayGroupRanks. El BSR grande, el de la categoría raíz
 *                  («#72.855 en Electrónica»). Es el que sirve para comparar
 *                  rotación entre productos.
 *   'categoria' -> classificationRanks. El de la subcategoría («#113 en
 *                  Televisores QLED»), el que sale en la ficha del producto.
 *
 * Van con su tipo y no mezclados porque un 113 y un 72.855 en la misma columna
 * sin distintivo hacen la serie temporal ininterpretable.
 */
export interface RankCatalogo {
  tipo: 'grupo' | 'categoria'
  categoria: string
  categoriaId: string | null
  rank: number
}

export interface ItemCatalogo {
  asin: string
  marca: string | null
  categoria: string | null
  categoriaId: string | null
  clasificacionItem: ClasificacionItem | null
  /** Del producto */
  producto: Medidas
  /** Del EMBALAJE. Es el que usa Amazon para calcular la tarifa de FBA */
  paquete: Medidas
  ranks: RankCatalogo[]
  /**
   * true cuando las tres medidas lineales no venían en la misma unidad y se han
   * descartado. No se convierte a ojo: una caja medio en pulgadas y medio en
   * centímetros no es una caja, es un dato roto.
   */
  medidasIncoherentes: boolean
}

export interface LecturaCatalogo {
  items: ItemCatalogo[]
  /** ASIN que se pidieron y Amazon no ha devuelto. Ver la cabecera */
  ausentes: string[]
  requestId: string | null
}

/* ------------------------------------------------------------------ */
/* La llamada                                                          */
/* ------------------------------------------------------------------ */

interface RespuestaBusqueda {
  numberOfResults?: number
  items?: ItemCrudo[]
}

interface ValorConUnidad {
  unit?: string
  value?: number
}

interface MedidasCrudas {
  height?: ValorConUnidad
  length?: ValorConUnidad
  weight?: ValorConUnidad
  width?: ValorConUnidad
}

interface ItemCrudo {
  asin?: string
  summaries?: Array<{
    marketplaceId?: string
    brand?: string
    manufacturer?: string
    itemClassification?: string
    browseClassification?: { displayName?: string; classificationId?: string }
  }>
  dimensions?: Array<{
    marketplaceId?: string
    item?: MedidasCrudas
    package?: MedidasCrudas
  }>
  salesRanks?: Array<{
    marketplaceId?: string
    classificationRanks?: Array<{ classificationId?: string; title?: string; rank?: number }>
    displayGroupRanks?: Array<{ websiteDisplayGroup?: string; title?: string; rank?: number }>
  }>
}

/**
 * Lee hasta 20 ASIN de una vez.
 *
 * `marketplaceIds` admite UNO SOLO en esta operación: multi-marketplace es
 * multiplicar llamadas, no ampliar el array. Y los identificadores repetidos se
 * quitan antes de salir, porque varios SKU del mismo cliente pueden apuntar al
 * mismo ASIN y mandar el duplicado gastaría sitio de los veinte que caben.
 */
export async function leerCatalogoItems(
  creds: AmazonCredentials,
  params: {
    marketplaceId: string
    asins: string[]
    bloques: BloqueCatalogo[]
  }
): Promise<LecturaCatalogo> {
  const pedidos = [...new Set(params.asins.map((a) => a.trim()).filter((a) => a !== ''))]
  if (pedidos.length === 0) return { items: [], ausentes: [], requestId: null }
  if (pedidos.length > MAX_ASINS_POR_LLAMADA) {
    throw new Error(
      `searchCatalogItems admite ${MAX_ASINS_POR_LLAMADA} identificadores por llamada y se le han pasado ${pedidos.length}`
    )
  }

  const { data, requestId } = await spApiRequest<RespuestaBusqueda>(creds, 'searchCatalogItems', {
    method: 'GET',
    path: '/catalog/2022-04-01/items',
    query: {
      identifiers: pedidos,
      identifiersType: 'ASIN',
      marketplaceIds: [params.marketplaceId],
      includedData: params.bloques,
    },
  })

  const items: ItemCatalogo[] = []
  const devueltos = new Set<string>()

  for (const crudo of data.items ?? []) {
    if (!crudo.asin) continue
    devueltos.add(crudo.asin)
    items.push(aplanar(crudo, params.marketplaceId))
  }

  return {
    items,
    ausentes: pedidos.filter((a) => !devueltos.has(a)),
    requestId,
  }
}

/* ------------------------------------------------------------------ */
/* Aplanado                                                            */
/* ------------------------------------------------------------------ */

const CLASIFICACIONES: ClasificacionItem[] = [
  'BASE_PRODUCT',
  'VARIATION_PARENT',
  'PRODUCT_BUNDLE',
  'OTHER',
]

function aplanar(crudo: ItemCrudo, marketplaceId: string): ItemCatalogo {
  const resumen = porMarketplace(crudo.summaries, marketplaceId)
  const medidas = porMarketplace(crudo.dimensions, marketplaceId)
  const ranks = porMarketplace(crudo.salesRanks, marketplaceId)

  const producto = medidasDe(medidas?.item)
  const paquete = medidasDe(medidas?.package)

  const clasificacionCruda = (resumen?.itemClassification ?? '') as ClasificacionItem
  const clasificacionItem = CLASIFICACIONES.includes(clasificacionCruda) ? clasificacionCruda : null

  const salida: RankCatalogo[] = []
  for (const r of ranks?.displayGroupRanks ?? []) {
    if (typeof r.rank !== 'number' || r.rank <= 0) continue
    salida.push({
      tipo: 'grupo',
      categoria: r.title?.trim() || 'Sin nombre',
      categoriaId: r.websiteDisplayGroup ?? null,
      rank: Math.round(r.rank),
    })
  }
  for (const r of ranks?.classificationRanks ?? []) {
    if (typeof r.rank !== 'number' || r.rank <= 0) continue
    salida.push({
      tipo: 'categoria',
      categoria: r.title?.trim() || 'Sin nombre',
      categoriaId: r.classificationId ?? null,
      rank: Math.round(r.rank),
    })
  }

  return {
    asin: crudo.asin as string,
    // `brand` primero y `manufacturer` como respaldo: en catálogos de terceros
    // —que es la mitad de la cartera— hay fichas sin marca declarada y con
    // fabricante puesto, y una marca vacía tira abajo el criterio de «marca
    // propia» y cualquier agrupación por marca.
    marca: resumen?.brand?.trim() || resumen?.manufacturer?.trim() || null,
    categoria: resumen?.browseClassification?.displayName?.trim() || null,
    // El identificador además del nombre: es lo que permite seguir la misma
    // categoría cuando Amazon le cambia el rótulo.
    categoriaId: resumen?.browseClassification?.classificationId ?? null,
    clasificacionItem,
    producto: producto.medidas,
    paquete: paquete.medidas,
    ranks: salida,
    medidasIncoherentes: producto.incoherente || paquete.incoherente,
  }
}

/**
 * El bloque del marketplace que se ha pedido.
 *
 * NO se coge `[0]` a secas: Amazon devuelve estos bloques agrupados por país y,
 * aunque al pedir uno solo venga un único elemento, coger el primero sin mirar
 * el marketplace es el tipo de atajo que funciona hasta el día que se pide más
 * de uno y entonces mezcla el BSR de España con el de Alemania.
 */
function porMarketplace<T extends { marketplaceId?: string }>(
  bloques: T[] | undefined,
  marketplaceId: string
): T | undefined {
  const lista = bloques ?? []
  return lista.find((b) => b.marketplaceId === marketplaceId) ?? undefined
}

/**
 * Peso y dimensiones, cada uno con su unidad.
 *
 * Las tres medidas lineales tienen que venir en la MISMA unidad. Si no, se
 * descartan las tres y se avisa: mezclar pulgadas y centímetros en un volumen da
 * un número que parece correcto y no lo es, y ese número acaba siendo una tarifa
 * de FBA en el módulo A4. El peso va aparte y sí se conserva aunque las
 * dimensiones se caigan.
 */
function medidasDe(crudas: MedidasCrudas | undefined): {
  medidas: Medidas
  incoherente: boolean
} {
  if (!crudas) return { medidas: MEDIDAS_VACIAS, incoherente: false }

  const peso = numero(crudas.weight?.value)
  const pesoUnidad = peso === null ? null : (crudas.weight?.unit ?? null)

  const largo = numero(crudas.length?.value)
  const ancho = numero(crudas.width?.value)
  const alto = numero(crudas.height?.value)

  const unidades = [
    largo === null ? null : (crudas.length?.unit ?? null),
    ancho === null ? null : (crudas.width?.unit ?? null),
    alto === null ? null : (crudas.height?.unit ?? null),
  ].filter((u): u is string => u !== null)

  const distintas = new Set(unidades)
  const incoherente = distintas.size > 1
  const hayDims = largo !== null || ancho !== null || alto !== null

  // El CHECK de la migración 123 exige que si hay alguna medida lineal haya
  // unidad. Sin unidad conocida, las medidas no se guardan: es preferible no
  // tener el dato a tener uno que no se puede interpretar.
  const dimsUnidad = incoherente || distintas.size === 0 ? null : [...distintas][0]
  const guardarDims = hayDims && dimsUnidad !== null

  return {
    medidas: {
      // Un peso sin unidad tampoco se guarda: el CHECK amazon_listings_peso_unidad_ok
      // lo rechazaría, y con razón.
      peso: pesoUnidad === null ? null : peso,
      pesoUnidad,
      largo: guardarDims ? largo : null,
      ancho: guardarDims ? ancho : null,
      alto: guardarDims ? alto : null,
      dimsUnidad: guardarDims ? dimsUnidad : null,
    },
    incoherente,
  }
}

function numero(valor: unknown): number | null {
  return typeof valor === 'number' && Number.isFinite(valor) && valor >= 0 ? valor : null
}
