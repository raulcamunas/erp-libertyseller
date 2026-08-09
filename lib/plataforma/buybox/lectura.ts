/**
 * PLATAFORMA · MÓDULO A2 — LEER LO QUE DEVUELVE AMAZON
 * ====================================================
 * FUNCIONES PURAS. Aquí no se llama a nadie: entra el JSON tal cual llega y sale
 * lo que entiende el motor de diagnóstico. Así se puede comprobar cada trampa de
 * la respuesta con un objeto escrito a mano, que es la única forma de probar un
 * parser de una API que no tiene sandbox útil.
 *
 *
 * ============ LAS SEIS DEFENSAS, Y POR QUÉ CADA UNA ============
 *
 * 1. SE CASA CADA RESPUESTA CON SU PETICIÓN POR EL OBJETO QUE AMAZON DEVUELVE EN
 *    ECO, NUNCA POR LA POSICIÓN EN EL ARRAY. Que el orden se preserve NO ESTÁ
 *    DOCUMENTADO en ninguna de las dos operaciones por lotes. Si algún día
 *    Amazon paraleliza y devuelve desordenado, casar por posición asigna el
 *    precio de un SKU a otro — y no da ningún error: la tabla se llena de
 *    números plausibles y equivocados. Es el peor fallo posible de este fichero
 *    y por eso el emparejamiento tiene dos vías (el campo del eco y, si falta,
 *    el SKU dentro de la URI) y una tercera que NO existe: la posición.
 *
 * 2. UN 200 DEL LOTE NO SIGNIFICA QUE FUERA BIEN. La llamada entera devuelve 200
 *    y dentro cada elemento trae su propio `status.statusCode`. Se recorren uno
 *    a uno.
 *
 * 3. NUNCA SE INDEXA `[0]` EN `featuredOfferExpectedPriceResults`. Cuántos
 *    elementos trae no está documentado. Se itera y se elige el que corresponde
 *    a nuestra oferta.
 *
 * 4. LOS ENUM DE AMAZON NO SON CERRADOS. `resultStatus`, el `status` de Pricing
 *    v0 y los códigos de canal pueden crecer sin aviso. Todo lo que viene de un
 *    enum se guarda CRUDO además de traducido, y la traducción tiene rama por
 *    defecto que devuelve «sin dato», jamás un cero.
 *
 * 5. SE ACEPTAN LAS DOS GRAFÍAS `NO_COMPETING_OFFER` y `NO_COMPETING_OFFERS`. La
 *    documentación de Amazon usa las dos y no dice cuál manda.
 *
 * 6. LOS FALLOS SE CLASIFICAN POR CÓDIGO HTTP + PRESENCIA DE LA CABECERA DE
 *    LÍMITE, NO POR EL TEXTO. Ver `clasificarFallo()`.
 *
 *
 * ============ Y LA REGLA QUE ATRAVIESA TODO EL FICHERO ============
 *
 * PRECIO DE LISTING Y PRECIO PUESTO EN CASA SON COSAS DISTINTAS Y NO SE MEZCLAN.
 * El FOEP es precio de listing, SIN envío. La competencia, en la misma
 * respuesta, trae `ListingPrice`, `Shipping` y `LandedPrice`. Comparar un FOEP
 * contra un landed es una comparación inválida, y con un catálogo mayoritariamente
 * FBM —donde el envío no es cero— eso estropea el diagnóstico entero. Aquí cada
 * importe sale con su nombre completo y nunca se suman por comodidad.
 */

import type { LecturaFoep, LecturaOfertas } from './diagnostico'
import type { CanalOferta, EstadoAmazonRetail, EstadoBuyBox, OfertaGuardada } from './tipos'

/* ------------------------------------------------------------------ */
/* Fallos                                                              */
/* ------------------------------------------------------------------ */

export type ClaseFallo =
  /** 403 sin cabecera de límite: falta el rol o la autorización. NO se reintenta */
  | 'rol'
  /** 400 con cabecera: el dato que mandamos es malo. Se aísla ese elemento */
  | 'dato'
  /** 429: cuota. Espera creciente */
  | 'cuota'
  /** 503 y 5xx: es Amazon. Espera más larga */
  | 'amazon'
  /** 404: ese SKU o ese ASIN no está */
  | 'no_encontrado'
  /** Cualquier otra cosa */
  | 'otro'

export interface FalloElemento {
  /** El SKU al que corresponde, si se ha podido casar */
  sku: string | null
  httpStatus: number | null
  clase: ClaseFallo
  /** El código y el mensaje de Amazon, tal cual */
  codigo: string | null
  mensaje: string | null
  /** ¿Merece la pena reintentar este elemento en la pasada siguiente? */
  reintentable: boolean
}

/**
 * De qué es este fallo.
 *
 * SE DECIDE POR EL CÓDIGO HTTP Y POR SI VINO LA CABECERA DE LÍMITE, NUNCA POR EL
 * TEXTO DEL MENSAJE. Los textos de Amazon cambian, están sin documentar y llegan
 * traducidos según el `issueLocale`; una comparación de cadenas ahí es una bomba
 * de relojería.
 *
 * La cabecera `x-amzn-RateLimit-Limit` SOLO llega en 200, 400 y 404, y puede
 * faltar incluso en un 200. Eso hace que la pareja (código, cabecera) sea
 * informativa:
 *
 *   403 SIN cabecera -> es lo normal en un 403: rol no concedido o autorización
 *                       caducada. No se reintenta; hay que reautorizar al
 *                       cliente. Insistir 685 veces contra una cuenta que nos ha
 *                       retirado el acceso no la recupera.
 *   400 CON cabecera -> la llamada llegó y el dato es malo. Se aísla ESE
 *                       elemento y el resto del lote sigue.
 *   429              -> cuota. Reintentable con espera creciente.
 *   503 / 5xx        -> es Amazon. Reintentable con espera más larga.
 *
 * `tieneCabeceraLimite` puede llegar como `null` cuando quien llama no la ha
 * podido observar; entonces se decide solo por el código, que para 403, 429 y
 * 5xx da el mismo resultado (Amazon documenta que en esos tres la cabecera nunca
 * viene).
 */
export function clasificarFallo(params: {
  httpStatus: number | null
  tieneCabeceraLimite: boolean | null
}): { clase: ClaseFallo; reintentable: boolean } {
  const { httpStatus, tieneCabeceraLimite } = params

  if (httpStatus === 429) return { clase: 'cuota', reintentable: true }
  if (httpStatus !== null && httpStatus >= 500) return { clase: 'amazon', reintentable: true }
  if (httpStatus === 404) return { clase: 'no_encontrado', reintentable: false }

  if (httpStatus === 403 || httpStatus === 401) {
    // Con cabecera sería rarísimo (Amazon documenta que en un 403 no viene). Si
    // apareciera, seguiría sin ser reintentable: un 403 no mejora repitiéndolo.
    return { clase: 'rol', reintentable: false }
  }

  if (httpStatus === 400) {
    // La cabecera confirma que la petición llegó a la operación y que lo que
    // falla es el dato. Sin cabecera se trata igual: un 400 no se arregla
    // repitiéndolo con el mismo cuerpo.
    void tieneCabeceraLimite
    return { clase: 'dato', reintentable: false }
  }

  return { clase: 'otro', reintentable: false }
}

/* ------------------------------------------------------------------ */
/* El sobre común de las dos operaciones por lotes                     */
/* ------------------------------------------------------------------ */

interface SobreLote {
  headers?: Record<string, unknown>
  status?: { statusCode?: number; reasonPhrase?: string }
  body?: unknown
  request?: unknown
}

/** ¿Vino la cabecera de límite en ESTE elemento del lote? */
function cabeceraLimite(headers: Record<string, unknown> | undefined): boolean | null {
  if (!headers || typeof headers !== 'object') return null
  for (const clave of Object.keys(headers)) {
    if (clave.toLowerCase() === 'x-amzn-ratelimit-limit') return true
  }
  return false
}

/** El SKU que viene dentro de una URI del tipo `/products/pricing/v0/listings/{sku}/offers` */
export function skuDeUri(uri: unknown): string | null {
  if (typeof uri !== 'string') return null
  const trozos = uri.split('/').filter((t) => t !== '')
  const i = trozos.indexOf('listings')
  if (i < 0 || i + 1 >= trozos.length) return null
  try {
    return decodeURIComponent(trozos[i + 1]) || null
  } catch {
    // Un SKU con un `%` suelto rompe decodeURIComponent. Mejor el crudo que nada.
    return trozos[i + 1] || null
  }
}

/* ------------------------------------------------------------------ */
/* Canal, en el vocabulario ternario                                   */
/* ------------------------------------------------------------------ */

/**
 * El canal de una oferta de Pricing v0.
 *
 * OJO: `IsFulfilledByAmazon` significa FBA, NO Amazon Retail. Un tercero con FBA
 * devuelve exactamente lo mismo, y confundirlos es el error que la especificación
 * arrastra en la regla 3 del §3.5.
 *
 * Y el orden importa: primero FBA, después SFP (que es MFN con Prime), y solo al
 * final FBM. Con el binario FBA/FBM, una oferta SFP se clasificaría FBM y el
 * diagnóstico de «pierdo la Buy Box por logística» saldría al revés.
 */
export function canalDeOferta(oferta: {
  IsFulfilledByAmazon?: unknown
  PrimeInformation?: { IsPrime?: unknown; IsNationalPrime?: unknown }
}): CanalOferta {
  const fba = oferta.IsFulfilledByAmazon
  if (fba === true) return 'FBA'
  if (fba === false) {
    return oferta.PrimeInformation?.IsPrime === true ? 'SFP' : 'FBM'
  }
  // Ausente: NO se supone. Ver el tipo CanalOferta.
  return 'desconocido'
}

/** El canal de una oferta de la API de FOEP, que habla otro vocabulario */
export function canalDeFoep(params: {
  fulfillmentType?: unknown
  primeDetails?: unknown
}): CanalOferta {
  const tipo = typeof params.fulfillmentType === 'string' ? params.fulfillmentType : null
  if (tipo === 'AFN') return 'FBA'
  if (tipo === 'MFN') {
    // `primeDetails` presente en una oferta MFN es exactamente la definición de
    // Seller Fulfilled Prime.
    return params.primeDetails ? 'SFP' : 'FBM'
  }
  return 'desconocido'
}

/* ------------------------------------------------------------------ */
/* getListingOffersBatch                                               */
/* ------------------------------------------------------------------ */

interface ImporteCrudo {
  Amount?: unknown
  amount?: unknown
  CurrencyCode?: unknown
  currencyCode?: unknown
}

interface OfertaCruda {
  MyOffer?: unknown
  SellerId?: unknown
  offerType?: unknown
  ListingPrice?: ImporteCrudo
  Shipping?: ImporteCrudo
  IsFulfilledByAmazon?: unknown
  IsBuyBoxWinner?: unknown
  IsFeaturedMerchant?: unknown
  PrimeInformation?: { IsPrime?: unknown; IsNationalPrime?: unknown }
}

interface PayloadOfertas {
  SKU?: unknown
  ASIN?: unknown
  status?: unknown
  Identifier?: { SellerSKU?: unknown; ASIN?: unknown }
  Summary?: {
    TotalOfferCount?: unknown
    BuyBoxPrices?: Array<{ LandedPrice?: ImporteCrudo; ListingPrice?: ImporteCrudo; Shipping?: ImporteCrudo }>
    NumberOfOffers?: Array<{ OfferCount?: unknown; fulfillmentChannel?: unknown }>
  }
  Offers?: OfertaCruda[]
}

export interface OpcionesLecturaOfertas {
  /** Nuestro identificador de vendedor. Sin él NO se puede saber si la oferta
      destacada es nuestra, que es el corte del que cuelga todo el diagnóstico */
  nuestroSellerId: string
  /** Identificadores conocidos de Amazon Retail en ese marketplace. Casi siempre
      vacío: Amazon no publica la lista. Ver EstadoAmazonRetail */
  sellersAmazon?: string[]
  /** Cuántas ofertas se guardan para el histórico. 0 = ninguna */
  maxOfertasGuardadas?: number
}

export interface ResultadoLoteOfertas {
  /** Por SKU. La clave sale del eco de Amazon, nunca de la posición */
  porSku: Map<string, LecturaOfertas>
  /** Las ofertas recortadas para el histórico, por SKU */
  ofertasPorSku: Map<string, OfertaGuardada[]>
  fallos: FalloElemento[]
  /** Elementos de la respuesta que no se han podido casar con ninguna petición */
  sinCasar: number
  /** SKU que se pidieron y no han vuelto en ninguna forma */
  ausentes: string[]
  /** Valores de enum que no conocíamos. Se registran, no se ignoran */
  enumsDesconocidos: string[]
}

/**
 * Lee la respuesta de `getListingOffersBatch`.
 *
 * `skusPedidos` es la lista EXACTA que se mandó, en el mismo orden en que se
 * mandó — pero NO se usa para casar por posición: se usa para saber QUÉ FALTA.
 * Que Amazon devuelva menos elementos de los pedidos sin dar error es
 * exactamente lo que hace `searchCatalogItems` en A1, y ahí ya costó una
 * defensa: un SKU que deja de volver se queda con datos viejos y su histórico se
 * congela sin que nadie lo note.
 */
export function leerLoteOfertas(
  respuesta: unknown,
  skusPedidos: string[],
  opciones: OpcionesLecturaOfertas
): ResultadoLoteOfertas {
  const porSku = new Map<string, LecturaOfertas>()
  const ofertasPorSku = new Map<string, OfertaGuardada[]>()
  const fallos: FalloElemento[] = []
  const enumsDesconocidos: string[] = []
  let sinCasar = 0

  const sobres = arrayDe((respuesta as { responses?: unknown })?.responses)
  const amazonIds = new Set((opciones.sellersAmazon ?? []).map((s) => s.trim()).filter(Boolean))
  const maxGuardadas = opciones.maxOfertasGuardadas ?? 0

  for (const bruto of sobres) {
    const sobre = bruto as SobreLote
    const body = sobre.body as { payload?: PayloadOfertas; errors?: unknown[] } | undefined
    const payload = body?.payload

    /* ---- DEFENSA 1: casar por el eco, nunca por la posición ---- */
    const peticion = (sobre.request ?? {}) as Record<string, unknown>
    const sku =
      texto(payload?.SKU) ??
      texto(payload?.Identifier?.SellerSKU) ??
      texto(peticion.SellerSKU) ??
      skuDeUri(peticion.uri)

    /* ---- DEFENSA 2: un 200 del lote no significa que fuera bien ---- */
    const httpStatus =
      typeof sobre.status?.statusCode === 'number' ? sobre.status.statusCode : null

    if (httpStatus === null || httpStatus < 200 || httpStatus >= 300) {
      const primerError = arrayDe(body?.errors)[0] as
        | { code?: unknown; message?: unknown }
        | undefined
      const { clase, reintentable } = clasificarFallo({
        httpStatus,
        tieneCabeceraLimite: cabeceraLimite(sobre.headers),
      })
      fallos.push({
        sku,
        httpStatus,
        clase,
        codigo: texto(primerError?.code),
        mensaje: texto(primerError?.message) ?? texto(sobre.status?.reasonPhrase),
        reintentable,
      })
      if (!sku) sinCasar += 1
      continue
    }

    if (!sku || !payload) {
      // Un 200 sin payload y sin forma de saber a qué SKU pertenece. No se
      // atribuye a nadie: atribuirlo al que tocaba por posición es justo el
      // error que la defensa 1 existe para evitar.
      sinCasar += 1
      continue
    }

    /* ---- El `status` de Pricing v0 también es un enum abierto ---- */
    const estadoPayload = texto(payload.status)
    if (estadoPayload && estadoPayload !== 'Success') {
      if (!enumsDesconocidos.includes(`status=${estadoPayload}`)) {
        enumsDesconocidos.push(`status=${estadoPayload}`)
      }
    }

    const lectura = aplanarOfertas(payload, opciones.nuestroSellerId, amazonIds)
    porSku.set(sku, lectura.lectura)
    if (maxGuardadas > 0 && lectura.guardadas.length > 0) {
      ofertasPorSku.set(sku, lectura.guardadas.slice(0, maxGuardadas))
    }
  }

  const ausentes = skusPedidos.filter((s) => !porSku.has(s) && !fallos.some((f) => f.sku === s))

  return { porSku, ofertasPorSku, fallos, sinCasar, ausentes, enumsDesconocidos }
}

/**
 * Aplana el payload de un SKU.
 *
 * DOS DECISIONES DENTRO, LAS DOS CARAS:
 *
 * · QUIÉN TIENE LA OFERTA DESTACADA se decide por `IsBuyBoxWinner` sobre la
 *   oferta cuyo `SellerId` es el nuestro. NO por `MyOffer` a secas y NO por
 *   comparar precios: `MyOffer` no siempre viene, y comparar precios daría por
 *   ganada la Buy Box a la oferta más barata, que no es como funciona.
 *
 * · LOS PRECIOS DE LA COMPETENCIA SE GUARDAN POR SEPARADO, listing y landed. El
 *   mínimo de listing es el único comparable con el FOEP.
 */
function aplanarOfertas(
  payload: PayloadOfertas,
  nuestroSellerId: string,
  amazonIds: Set<string>
): { lectura: LecturaOfertas; guardadas: OfertaGuardada[] } {
  const ofertas = arrayDe(payload.Offers) as OfertaCruda[]

  let precioPropio: number | null = null
  let envioPropio: number | null = null
  let moneda: string | null = null
  let canalPropio: CanalOferta = 'desconocido'
  let hayOfertaPropia = false

  let precioBuybox: number | null = null
  let envioBuybox: number | null = null
  let canalGanador: CanalOferta | null = null
  let buybox: EstadoBuyBox = 'nadie'

  let competidores = 0
  let competidoresPrime = 0
  let precioCompetidorMin: number | null = null
  let precioCompetidorMinLanded: number | null = null
  let amazonPresente = false

  const guardadas: OfertaGuardada[] = []

  for (const oferta of ofertas) {
    // Las ofertas B2B viven en el mismo array y NO son las que ve un comprador
    // normal. Se filtran igual que hace normalizeListingItem() en lib/amazon/sp-api.ts.
    const tipo = texto(oferta.offerType)
    if (tipo && tipo !== 'B2C') continue

    const sellerId = texto(oferta.SellerId)
    const nuestra = oferta.MyOffer === true || (sellerId !== null && sellerId === nuestroSellerId)
    const listing = importe(oferta.ListingPrice)
    const envio = importe(oferta.Shipping)
    const canal = canalDeOferta(oferta)
    const ganadora = oferta.IsBuyBoxWinner === true
    if (moneda === null) moneda = divisa(oferta.ListingPrice)

    if (nuestra) {
      hayOfertaPropia = true
      if (precioPropio === null) precioPropio = listing
      if (envioPropio === null) envioPropio = envio
      if (canalPropio === 'desconocido') canalPropio = canal
    } else {
      competidores += 1
      if (canal === 'FBA' || canal === 'SFP') competidoresPrime += 1
      if (sellerId !== null && amazonIds.has(sellerId)) amazonPresente = true
      if (listing !== null && (precioCompetidorMin === null || listing < precioCompetidorMin)) {
        precioCompetidorMin = listing
      }
      const landed = listing === null ? null : listing + (envio ?? 0)
      if (landed !== null && (precioCompetidorMinLanded === null || landed < precioCompetidorMinLanded)) {
        precioCompetidorMinLanded = landed
      }
    }

    if (ganadora) {
      buybox = nuestra ? 'nuestra' : 'de_otro'
      precioBuybox = listing
      envioBuybox = envio
      canalGanador = canal
    }

    if (sellerId !== null) {
      guardadas.push({ v: sellerId, p: listing, e: envio, c: canal, g: ganadora, n: nuestra })
    }
  }

  /**
   * SI NADIE TRAE `IsBuyBoxWinner`, la respuesta puede seguir trayendo un
   * `Summary.BuyBoxPrices`. Eso significa que SÍ hay oferta destacada pero no
   * está entre las ofertas devueltas (Amazon manda como mucho veinte). En ese
   * caso el estado es `de_otro` con precio, no `nadie`: decir «no la tiene
   * nadie» cuando la tiene alguien fuera de la ventana es un diagnóstico
   * distinto y una acción distinta.
   */
  const preciosBuybox = arrayDe(payload.Summary?.BuyBoxPrices)
  if (buybox === 'nadie' && preciosBuybox.length > 0) {
    const primero = preciosBuybox[0] as {
      ListingPrice?: ImporteCrudo
      Shipping?: ImporteCrudo
    }
    buybox = 'de_otro'
    precioBuybox = importe(primero.ListingPrice)
    envioBuybox = importe(primero.Shipping)
    if (moneda === null) moneda = divisa(primero.ListingPrice)
  }

  /**
   * EL VEREDICTO TERNARIO DE AMAZON RETAIL.
   *
   * Solo hay dos afirmaciones honestas: «sí» cuando un identificador conocido de
   * Amazon está entre los vendedores, y «no» cuando no hay NINGUNA oferta ajena
   * —si no vende nadie más, tampoco vende Amazon—. Todo lo demás es
   * `indeterminado`, y se enseña así.
   */
  const amazon: EstadoAmazonRetail = amazonPresente
    ? 'si'
    : competidores === 0
      ? 'no'
      : 'indeterminado'

  return {
    lectura: {
      precioPropio,
      envioPropio,
      moneda,
      canalPropio,
      hayOfertaPropia,
      buybox: hayOfertaPropia || ofertas.length > 0 ? buybox : 'desconocido',
      precioBuybox,
      envioBuybox,
      canalGanador,
      competidores,
      competidoresPrime,
      precioCompetidorMin,
      precioCompetidorMinLanded:
        precioCompetidorMinLanded === null ? null : redondear(precioCompetidorMinLanded),
      amazon,
      leidoAt: null,
    },
    guardadas,
  }
}

/* ------------------------------------------------------------------ */
/* getFeaturedOfferExpectedPriceBatch                                  */
/* ------------------------------------------------------------------ */

interface ImporteFoep {
  amount?: unknown
  currencyCode?: unknown
}

interface OfertaDestacadaCruda {
  offerIdentifier?: {
    marketplaceId?: unknown
    sellerId?: unknown
    asin?: unknown
    sku?: unknown
    fulfillmentType?: unknown
  }
  condition?: unknown
  fulfillmentType?: unknown
  listingPrice?: ImporteFoep
  shippingOptions?: unknown[]
  primeDetails?: unknown
}

interface ResultadoFoepCrudo {
  featuredOfferExpectedPrice?: { listingPrice?: ImporteFoep; points?: unknown }
  resultStatus?: unknown
  competingFeaturedOffer?: OfertaDestacadaCruda
  currentFeaturedOffer?: OfertaDestacadaCruda
}

interface CuerpoFoep {
  offerIdentifier?: {
    marketplaceId?: unknown
    sellerId?: unknown
    asin?: unknown
    sku?: unknown
    fulfillmentType?: unknown
  }
  featuredOfferExpectedPriceResults?: ResultadoFoepCrudo[]
  errors?: unknown[]
}

/** Lo que el FOEP sabe de la oferta destacada actual, que no es poco */
export interface ExtraFoep {
  /** Quién la tiene AHORA. Es lo que decide si el FOEP es ofensivo o defensivo */
  buybox: EstadoBuyBox
  precioBuybox: number | null
  canalGanador: CanalOferta | null
  canalPropio: CanalOferta
  asin: string | null
}

export interface ResultadoLoteFoep {
  porSku: Map<string, LecturaFoep>
  extrasPorSku: Map<string, ExtraFoep>
  fallos: FalloElemento[]
  sinCasar: number
  ausentes: string[]
  enumsDesconocidos: string[]
}

/** Las dos grafías. La documentación de Amazon usa las dos y no dice cuál manda */
const SIN_COMPETENCIA = new Set(['NO_COMPETING_OFFER', 'NO_COMPETING_OFFERS'])

/** Los que sabemos que traen precio */
const CON_PRECIO = new Set(['VALID_FOEP'])

/**
 * Lee la respuesta de `getFeaturedOfferExpectedPriceBatch`.
 *
 * TRES TRAMPAS TAPADAS AQUÍ:
 *
 * 1. `featuredOfferExpectedPriceResults` ES UN ARRAY Y NO SE INDEXA `[0]`.
 *    Cuántos elementos trae no está documentado. Se itera y se toma el primero
 *    que traiga precio; si ninguno lo trae, se conserva el `resultStatus` del
 *    primero para poder decir POR QUÉ no hay número.
 *
 * 2. `resultStatus` ES UN ENUM ABIERTO. Un valor que no conocemos NO se
 *    interpreta: se guarda crudo, el estado queda en `no_disponible` y el motor
 *    lo trata como «sin dato». Nunca como cero.
 *
 * 3. LA COMPARACIÓN DE `sellerId` ES OBLIGATORIA. `currentFeaturedOffer` es la
 *    oferta destacada de AHORA, sea de quien sea. Compararla contra nuestro
 *    identificador es lo ÚNICO que distingue un FOEP ofensivo de uno defensivo,
 *    y no hay ningún `resultStatus` que lo diga.
 */
export function leerLoteFoep(
  respuesta: unknown,
  skusPedidos: string[],
  opciones: { nuestroSellerId: string }
): ResultadoLoteFoep {
  const porSku = new Map<string, LecturaFoep>()
  const extrasPorSku = new Map<string, ExtraFoep>()
  const fallos: FalloElemento[] = []
  const enumsDesconocidos: string[] = []
  let sinCasar = 0

  const sobres = arrayDe((respuesta as { responses?: unknown })?.responses)

  for (const bruto of sobres) {
    const sobre = bruto as SobreLote
    const cuerpo = sobre.body as CuerpoFoep | undefined
    const peticion = (sobre.request ?? {}) as Record<string, unknown>

    /* ---- DEFENSA 1: el eco, nunca la posición ---- */
    const sku = texto(peticion.sku) ?? texto(cuerpo?.offerIdentifier?.sku)

    /* ---- DEFENSA 2: cada elemento con su propio estado ---- */
    const httpStatus =
      typeof sobre.status?.statusCode === 'number' ? sobre.status.statusCode : null

    if (httpStatus === null || httpStatus < 200 || httpStatus >= 300) {
      const primerError = arrayDe(cuerpo?.errors)[0] as
        | { code?: unknown; message?: unknown }
        | undefined
      const { clase, reintentable } = clasificarFallo({
        httpStatus,
        tieneCabeceraLimite: cabeceraLimite(sobre.headers),
      })
      fallos.push({
        sku,
        httpStatus,
        clase,
        codigo: texto(primerError?.code),
        mensaje: texto(primerError?.message) ?? texto(sobre.status?.reasonPhrase),
        reintentable,
      })
      if (!sku) sinCasar += 1
      continue
    }

    if (!sku) {
      sinCasar += 1
      continue
    }

    const resultados = arrayDe(cuerpo?.featuredOfferExpectedPriceResults) as ResultadoFoepCrudo[]

    /* ---- DEFENSA 3: iterar, nunca [0] ---- */
    let importeFoep: number | null = null
    let monedaFoep: string | null = null
    let resultado: string | null = null
    let elegido: ResultadoFoepCrudo | null = null

    for (const r of resultados) {
      const estado = texto(r.resultStatus)
      if (resultado === null) resultado = estado
      const precio = importeMinusculas(r.featuredOfferExpectedPrice?.listingPrice)
      if (precio !== null && importeFoep === null) {
        importeFoep = precio
        monedaFoep = divisaMinusculas(r.featuredOfferExpectedPrice?.listingPrice)
        resultado = estado
        elegido = r
      }
      if (elegido === null && (r.currentFeaturedOffer || r.competingFeaturedOffer)) elegido = r

      if (
        estado !== null &&
        !CON_PRECIO.has(estado) &&
        !SIN_COMPETENCIA.has(estado) &&
        !RESULTADOS_CONOCIDOS.has(estado) &&
        !enumsDesconocidos.includes(`resultStatus=${estado}`)
      ) {
        enumsDesconocidos.push(`resultStatus=${estado}`)
      }
    }

    porSku.set(sku, {
      // Sin importe NO es cero y NO es null a secas: es `no_disponible` con su
      // motivo crudo al lado. Lo exige el CHECK de la migración 123 y lo exige
      // la regla 5 del §3.5 de la especificación.
      estado: importeFoep === null ? 'no_disponible' : 'disponible',
      importe: importeFoep,
      moneda: monedaFoep,
      resultado,
      leidoAt: null,
    })

    /* ---- Lo que el FOEP sabe además del número ---- */
    if (elegido) {
      const actual = elegido.currentFeaturedOffer
      const sellerActual = texto(actual?.offerIdentifier?.sellerId)
      const nuestroCanal = canalDeFoep({
        fulfillmentType: cuerpo?.offerIdentifier?.fulfillmentType,
        primeDetails: undefined,
      })

      extrasPorSku.set(sku, {
        buybox: !actual
          ? SIN_COMPETENCIA.has(resultado ?? '')
            ? 'nadie'
            : 'desconocido'
          : sellerActual !== null && sellerActual === opciones.nuestroSellerId
            ? 'nuestra'
            : 'de_otro',
        precioBuybox: importeMinusculas(actual?.listingPrice),
        canalGanador: actual
          ? canalDeFoep({
              fulfillmentType: actual.fulfillmentType ?? actual.offerIdentifier?.fulfillmentType,
              primeDetails: actual.primeDetails,
            })
          : null,
        canalPropio: nuestroCanal,
        asin: texto(cuerpo?.offerIdentifier?.asin),
      })
    }
  }

  const ausentes = skusPedidos.filter((s) => !porSku.has(s) && !fallos.some((f) => f.sku === s))

  return { porSku, extrasPorSku, fallos, sinCasar, ausentes, enumsDesconocidos }
}

/** Los que conocemos. Cualquier otro se registra como desconocido, no se ignora */
const RESULTADOS_CONOCIDOS = new Set([
  'VALID_FOEP',
  'NO_COMPETING_OFFER',
  'NO_COMPETING_OFFERS',
  'OFFER_NOT_ELIGIBLE',
  'FEATURED_OFFER_NOT_AVAILABLE',
  'ASIN_NOT_ELIGIBLE',
  'ASIN_NOT_FOUND',
  'OFFER_NOT_FOUND',
])

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

function arrayDe(valor: unknown): unknown[] {
  return Array.isArray(valor) ? valor : []
}

function texto(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  const limpio = valor.trim()
  return limpio === '' ? null : limpio
}

/**
 * Un importe de Pricing v0.
 *
 * `Amount` puede llegar como número o como cadena. Se convierte con cuidado y
 * NUNCA se cae a cero: un `parseFloat(undefined)` que acaba en `NaN ?? 0` es
 * exactamente el bug que convierte «no hay dato» en «vale cero euros», y en este
 * módulo un cero se lee como «regálalo».
 */
function importe(valor: ImporteCrudo | undefined): number | null {
  if (!valor) return null
  const crudo = valor.Amount ?? valor.amount
  if (typeof crudo === 'number') return Number.isFinite(crudo) ? crudo : null
  if (typeof crudo === 'string') {
    const n = Number(crudo.replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function divisa(valor: ImporteCrudo | undefined): string | null {
  if (!valor) return null
  return texto(valor.CurrencyCode ?? valor.currencyCode)
}

function importeMinusculas(valor: ImporteFoep | undefined): number | null {
  if (!valor) return null
  const crudo = valor.amount
  if (typeof crudo === 'number') return Number.isFinite(crudo) ? crudo : null
  if (typeof crudo === 'string') {
    const n = Number(crudo.replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  return null
}

function divisaMinusculas(valor: ImporteFoep | undefined): string | null {
  if (!valor) return null
  return texto(valor.currencyCode)
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100
}
