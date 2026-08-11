/**
 * PLATAFORMA · EL ESPEJO DEL CATÁLOGO
 * ===================================
 * SOLO SERVIDOR: importa el cliente de service_role.
 *
 * Todo lo que la ingesta de A1 lee y escribe en `amazon_listings`. Los ficheros
 * de lib/plataforma/amazon/** hablan con Amazon y no saben que existe Postgres;
 * este traduce entre lo que devuelven y las filas de la tabla.
 *
 * NO SE CREA NINGUNA TABLA NUEVA DE SKU. La `skus` que dibuja la especificación
 * es esta tabla, que ya existía desde la migración 118 y que la 123 extendió con
 * marca, categoría, medidas y seguimiento. Un modelo duplicado es la forma más
 * rápida de que dos pantallas digan cifras distintas del mismo SKU.
 *
 * Y como en el resto del módulo: aquí NO se lee `amazon_connections.refresh_token_enc`.
 * Las columnas se piden por su nombre, nunca con `*`.
 */

import { marketplaceById } from '@/lib/types/amazon'
import { fetchAll, type UnidadDeTrabajo } from './datos'
import { createServiceClient } from '@/lib/supabase/service'
import type { ItemCatalogo } from './amazon/catalogo-items'
import type { FilaCenso } from './amazon/informe-listings'

/** Cuántas filas se escriben de una vez. El mismo número que usa el refresco de
    quince minutos: ni una a una (55 viajes por cada mil) ni todas juntas (una
    consulta que Postgres tiene que parsear entera) */
const CHUNK_ESCRITURA = 250

/** Cuántos SKU o ASIN caben en un `.in(...)`. Una URL de PostgREST con miles de
    valores dentro no la acepta ningún proxy */
const CHUNK_FILTRO = 300

/* ------------------------------------------------------------------ */
/* Filtros compartidos                                                 */
/* ------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * El filtro de «SKU en seguimiento», tal cual lo entiende PostgREST.
 *
 * El valor efectivo es COALESCE(activo_manual, activo_calculado) —lo que dijo
 * una persona gana siempre— y eso, en sintaxis de filtros, es:
 *
 *     activo_manual = true  O  (activo_manual IS NULL Y activo_calculado = true)
 *
 * Está aquí, en una función, y no copiado en cada consulta, porque un
 * `WHERE activo_calculado` suelto por ahí se salta la decisión manual sin que
 * nadie lo note: el SKU que un gestor sacó del seguimiento ayer volvería a
 * refrescarse hoy y nadie sabría por qué.
 *
 * El tipo es `any` a la fuerza: los constructores de consulta de supabase-js
 * llevan el tipo de la tabla y el de las columnas ya seleccionadas, y no hay
 * forma de escribir un genérico que valga para todas las llamadas sin arrastrar
 * la firma entera. Es la misma renuncia que hace fetchAll con su callback.
 */
export function soloEnSeguimiento<T extends { or: (f: string) => any }>(consulta: T): T {
  return consulta.or('activo_manual.eq.true,and(activo_manual.is.null,activo_calculado.eq.true)')
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface AmbitoCatalogo {
  /** Subconjunto de prueba. null = todo el catálogo de la unidad */
  skusFiltro?: string[] | null
  /** Solo los que están en seguimiento diario */
  soloActivos?: boolean
  /**
   * Solo las referencias marcadas como marca propia del cliente.
   *
   * Es lo que hace que un cliente MIXTO —revende y además tiene marca suya—
   * mida el BSR solo de lo suyo. En su catálogo el ranking de un producto de
   * tercero es del producto, no de él, así que medirlo a diario es gastar cupo
   * en información que no dice nada de su cuenta. Ver lib/plataforma/modelo-negocio.ts.
   */
  soloMarcaPropia?: boolean
  /**
   * Solo las referencias con existencias.
   *
   * Es lo que hace que el monitor de Buy Box pueda cubrir el catálogo ENTERO sin
   * gastar de más: un SKU sin stock no es elegible para la oferta destacada, así
   * que preguntar si la gana es preguntar por algo que no puede pasar.
   *
   * `quantity` es la cantidad del espejo del catálogo, que refresca el ciclo de
   * quince minutos. Un null NO cuenta como cero: significa que no lo sabemos —el
   * caso típico es un FBM cuyo canal no declara cantidad— y descartarlo sería
   * dejar fuera productos que sí están a la venta.
   */
  soloConStock?: boolean
}

/**
 * Aplica el ámbito a una consulta sobre `amazon_listings`.
 *
 * ESTABA COPIADO EN CUATRO SITIOS, y ya se notaba: dos de ellos habían acabado
 * con la línea de `soloMarcaPropia` repetida tres veces. Es inofensivo —filtrar
 * dos veces por lo mismo da igual— pero es la señal de que añadir un filtro
 * nuevo aquí significaba acordarse de cuatro sitios, y de que olvidarse de uno
 * no rompe nada: solo hace que ese trabajo barra de más, en silencio.
 *
 * `skusFiltro` no entra aquí: unos sitios filtran por SKU y otros por ASIN, y
 * meterlo obligaría a un parámetro que solo usa la mitad.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export function aplicarAmbito<T extends { eq: (c: string, v: any) => any; gt: (c: string, v: any) => any; or: (f: string) => any }>(
  consulta: T,
  ambito: AmbitoCatalogo
): T {
  let q: any = consulta
  if (ambito.soloActivos) q = soloEnSeguimiento(q)
  if (ambito.soloMarcaPropia) q = q.eq('es_marca_propia', true)
  // `quantity > 0`. Un NULL no pasa el `gt`, que es lo que se quiere: null es
  // «no lo sabemos», no un cero, pero tampoco es una existencia confirmada y
  // este filtro existe para no gastar cupo en lo que no puede ganar la oferta.
  if (ambito.soloConStock) q = q.gt('quantity', 0)
  return q as T
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ------------------------------------------------------------------ */
/* Volcar el censo                                                     */
/* ------------------------------------------------------------------ */

export interface ResultadoCenso {
  /** Filas escritas en el espejo */
  escritas: number
  /** Cuántas de esas no tenían estado reconocible y han conservado el que había */
  sinEstado: number
  /** SKU que ya estaban en el espejo y NO vienen en el censo */
  desaparecidos: number
  /** SKU del censo que no estaban en el espejo */
  nuevos: number
  consultas: number
}

/**
 * Vuelca el censo del informe en el espejo del catálogo.
 *
 * TRES COLUMNAS QUE NO SE ESCRIBEN, Y LAS TRES A PROPÓSITO:
 *
 *   · `product_type` — no viene en el informe y es OBLIGATORIO en cada cambio
 *     que se le manda a Amazon. Si el censo lo pusiera a null, el catálogo
 *     entero se quedaría sin poder editar precio ni stock hasta el refresco
 *     siguiente. Lo rellena searchListingsItems, en el ciclo de quince minutos.
 *
 *   · `condition_type` — el informe trae `item-condition` como un número, y la
 *     Listings API la escribe como texto ('new_new'). Traducir a ojo entre los
 *     dos vocabularios es inventarse un dato.
 *
 *   · `is_fba` — la genera la base a partir del canal de logística. Mandarla en
 *     el upsert da un error de Postgres que tumbaría el volcado entero.
 *
 * Y una que sí se escribe con cuidado: `listing_status`. El informe dice
 * «Active» y la API dice ['BUYABLE','DISCOVERABLE']; la traducción está en
 * estadoDelInforme(). Cuando el valor no se reconoce, ESA FILA NO TOCA LA
 * COLUMNA —va en un lote aparte— porque escribir un array vacío significa «no
 * está a la venta», y aplicarlo a un catálogo entero porque la cabecera vino en
 * un idioma raro dejaría a ese cliente sin ningún SKU en seguimiento.
 */
export async function volcarCenso(
  unidad: UnidadDeTrabajo,
  filas: FilaCenso[],
  ahora: Date
): Promise<ResultadoCenso> {
  const service = createServiceClient()
  const visto = ahora.toISOString()

  // La divisa NO viene en el informe: el precio es un número desnudo. Sale del
  // marketplace, que es una tabla de parámetros (lib/types/amazon.ts), no una
  // constante escondida en el código. Si el marketplace no está en la tabla, no
  // se escribe divisa: es preferible dejar la que hubiera a inventarse euros.
  const moneda = marketplaceById(unidad.marketplaceId)?.currency ?? null

  const antes = await skusDelEspejo(unidad)
  const enCenso = new Set(filas.map((f) => f.sku))

  const base = (fila: FilaCenso) => ({
    connection_id: unidad.connectionId,
    marketplace_id: unidad.marketplaceId,
    sku: fila.sku,
    asin: fila.asin,
    title: fila.titulo,
    price: fila.precio,
    ...(moneda ? { currency: moneda } : {}),
    quantity: fila.cantidad,
    // El valor CRUDO de Amazon. La columna generada `is_fba` lo interpreta, y la
    // lista de valores posibles depende del vendedor y de sus programas: grabar
    // aquí un mapa de canales es lo que revienta con el primer cliente que entre
    // en un programa nuevo.
    fulfillment_channel_code: fila.canal,
    codigo_externo: fila.codigoExterno,
    codigo_externo_tipo: fila.codigoExternoTipo,
    last_seen_at: visto,
  })

  const conEstado = filas.filter((f) => f.estado !== undefined)
  const sinEstado = filas.filter((f) => f.estado === undefined)

  let consultas = 0
  consultas += await upsertLotes(
    service,
    conEstado.map((f) => ({ ...base(f), listing_status: f.estado as string[] }))
  )
  consultas += await upsertLotes(
    service,
    sinEstado.map((f) => base(f))
  )

  let nuevos = 0
  for (const sku of enCenso) if (!antes.has(sku)) nuevos += 1
  let desaparecidos = 0
  for (const sku of antes) if (!enCenso.has(sku)) desaparecidos += 1

  return {
    escritas: filas.length,
    sinEstado: sinEstado.length,
    desaparecidos,
    nuevos,
    consultas,
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function upsertLotes(
  service: ReturnType<typeof createServiceClient>,
  filas: Record<string, any>[]
): Promise<number> {
  if (filas.length === 0) return 0
  let consultas = 0
  for (let i = 0; i < filas.length; i += CHUNK_ESCRITURA) {
    const { error } = await service
      .from('amazon_listings')
      .upsert(filas.slice(i, i + CHUNK_ESCRITURA), {
        onConflict: 'connection_id,marketplace_id,sku',
      })
    if (error) throw error
    consultas += 1
  }
  return consultas
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Los SKU que hoy tiene el espejo de esta unidad */
async function skusDelEspejo(unidad: UnidadDeTrabajo): Promise<Set<string>> {
  const service = createServiceClient()
  const filas = await fetchAll<{ sku: string }>((desde, hasta) =>
    service
      .from('amazon_listings')
      .select('sku')
      .eq('connection_id', unidad.connectionId)
      .eq('marketplace_id', unidad.marketplaceId)
      .order('sku', { ascending: true })
      .range(desde, hasta)
  )
  return new Set(filas.map((f) => f.sku))
}

/* ------------------------------------------------------------------ */
/* Recorrer el catálogo por ASIN                                       */
/* ------------------------------------------------------------------ */

export interface TramoAsins {
  asins: string[]
  /** El último ASIN incluido. Es el cursor del trabajo */
  ultimo: string | null
  hayMas: boolean
}

/**
 * Cuántas filas se leen para sacar un tramo de ASIN distintos.
 *
 * Varios SKU pueden compartir ASIN —tallas de un mismo modelo, reposiciones con
 * SKU nuevo— así que para veinte ASIN distintos hacen falta más de veinte filas.
 * Diez veces el tamaño del lote cubre de sobra el caso normal, y el caso extremo
 * (un ASIN con doscientas tallas) tampoco se atasca: se devuelve ese ASIN solo y
 * el cursor avanza igual.
 */
const FILAS_POR_TRAMO = 10

/**
 * Los siguientes ASIN distintos del catálogo, en orden ascendente.
 *
 * EL ORDEN TERMINA EN COLUMNA ÚNICA a propósito: el cursor es un ASIN y la
 * consulta siguiente pide «mayor que este». Con un orden con empates, .range()
 * repite filas o se las salta entre tramos, y aquí una fila saltada es un SKU
 * que se queda para siempre sin marca ni medidas sin que nadie lo note.
 */
export async function siguientesAsins(
  unidad: UnidadDeTrabajo,
  cursor: string | null,
  cuantos: number,
  ambito: AmbitoCatalogo = {}
): Promise<TramoAsins> {
  const service = createServiceClient()
  const limite = cuantos * FILAS_POR_TRAMO

  let consulta = service
    .from('amazon_listings')
    .select('asin')
    .eq('connection_id', unidad.connectionId)
    .eq('marketplace_id', unidad.marketplaceId)
    .not('asin', 'is', null)

  if (cursor) consulta = consulta.gt('asin', cursor)
  if (ambito.skusFiltro && ambito.skusFiltro.length > 0) {
    consulta = consulta.in('sku', ambito.skusFiltro)
  }
  consulta = aplicarAmbito(consulta, ambito)

  const { data, error } = await consulta
    .order('asin', { ascending: true })
    .order('sku', { ascending: true })
    .limit(limite)
  if (error) throw error

  const filas = (data ?? []) as Array<{ asin: string | null }>
  const distintos: string[] = []
  const vistos = new Set<string>()
  for (const fila of filas) {
    if (!fila.asin || vistos.has(fila.asin)) continue
    vistos.add(fila.asin)
    distintos.push(fila.asin)
  }

  const tomados = distintos.slice(0, cuantos)

  // GUARDA CONTRA UN BUCLE SIN FIN. Un tramo vacío con `hayMas` en true haría
  // que el motor avanzara al mismo cursor una y otra vez: no daría error, no
  // avanzaría, y el trabajo giraría hasta agotar la pasada, cada cinco minutos,
  // para siempre. Hoy no puede pasar —la consulta excluye los ASIN nulos, así
  // que si vinieron filas hay al menos un ASIN distinto— pero el precio de la
  // guarda es una línea y el de equivocarse es un trabajo que parece vivo.
  if (tomados.length === 0) {
    return { asins: [], ultimo: cursor, hayMas: false }
  }

  return {
    asins: tomados,
    ultimo: tomados[tomados.length - 1],
    // Dos motivos para que haya más, y hacen falta LOS DOS. Con solo el segundo,
    // un tramo que trae 150 filas con 40 ASIN distintos y un límite de 200 daría
    // «no hay más» y se perderían veinte ASIN en silencio.
    hayMas: distintos.length > tomados.length || filas.length === limite,
  }
}

/* ------------------------------------------------------------------ */
/* Escribir los atributos del catálogo                                 */
/* ------------------------------------------------------------------ */

export interface EscrituraAtributos {
  filas: number
  consultas: number
}

/**
 * Escribe marca, categoría, clasificación y medidas de un ASIN en TODOS sus SKU.
 *
 * Se actualiza por ASIN y no por SKU porque los atributos son del producto, no
 * de la referencia: un modelo con doce tallas comparte marca y categoría, y
 * mandar doce UPDATE idénticos es doce veces el mismo viaje.
 *
 * `dims_origen` se pone a 'amazon' solo cuando de verdad han venido medidas. La
 * regla 4 del §3.5 de la especificación exige poder distinguir un SKU medido por
 * Amazon de uno medido a ojo por alguien, porque su estimación de tarifa de FBA
 * no vale lo mismo. Sin esta columna, «lo dice Amazon» y «lo apuntó alguien» son
 * indistinguibles.
 *
 *
 * AUSENCIA NO ES DATO: LO QUE AMAZON NO DICE NO SE ESCRIBE
 * -------------------------------------------------------
 * `searchCatalogItems` devuelve con muchísima frecuencia un ASIN con `summaries`
 * sin `brand`, sin `browseClassification` o sin bloque `dimensions` — y el
 * bloque del país puede no venir. Escribir esos nulos tal cual convierte cada
 * barrido semanal en un borrado silencioso: la marca que había se va, y con ella
 * se mueve el conjunto que se refresca a diario, porque `marca` y
 * `clasificacion_item` alimentan `marcas_excluidas` y `excluir_variacion_padre`
 * del criterio de seguimiento (ver activos.ts). Y se llevaría por delante
 * también lo que alguien haya medido a mano, que es justo lo que `dims_origen`
 * existe para poder distinguir.
 *
 * Así que el patch se monta CAMPO A CAMPO y solo entra lo que ha venido. Es el
 * mismo criterio que ya aplica volcarCenso() con `listing_status`, donde las
 * filas sin estado reconocible van en un lote aparte para no pisar la columna.
 *
 * Las medidas van en BLOQUE —peso con su unidad, las tres lineales con la suya—
 * porque media medida no es media información, es una caja rota: si Amazon
 * manda el peso y no las dimensiones, se escribe el peso y las dimensiones se
 * quedan como estaban.
 *
 * `catalogo_visto_at` sí se escribe SIEMPRE, incluso cuando no ha venido ni un
 * atributo: es el sello de «a este ASIN ya se le ha preguntado», y sin él el
 * barrido volvería una y otra vez sobre los ASIN de los que Amazon no cuenta
 * nada y nunca llegaría a los del final.
 */
export async function escribirAtributos(
  unidad: UnidadDeTrabajo,
  items: ItemCatalogo[],
  ahora: Date
): Promise<EscrituraAtributos> {
  const service = createServiceClient()
  const visto = ahora.toISOString()
  let filas = 0
  let consultas = 0

  for (const item of items) {
    const patch: Record<string, unknown> = {
      // Separado de last_seen_at, que lo mueve el refresco de quince minutos.
      // Este solo lo mueve searchCatalogItems, y es lo que permite saber a
      // quién le toca enriquecer sin releerlo todo. Va SIEMPRE: ver la cabecera.
      catalogo_visto_at: visto,
    }

    if (item.marca !== null) patch.marca = item.marca
    if (item.categoria !== null) patch.categoria = item.categoria
    if (item.categoriaId !== null) patch.categoria_id = item.categoriaId
    if (item.clasificacionItem !== null) patch.clasificacion_item = item.clasificacionItem

    // Cada medida, con su unidad y entera o nada. medidasDe() ya garantiza el
    // par —un peso sin unidad y unas dimensiones sin unidad no salen de allí—,
    // que es justo lo que exigen los CHECK amazon_listings_peso_unidad_ok y
    // amazon_listings_dims_unidad_ok de la 123.
    let hayMedidas = false
    if (item.producto.peso !== null) {
      patch.peso = item.producto.peso
      patch.peso_unidad = item.producto.pesoUnidad
      hayMedidas = true
    }
    if (item.producto.dimsUnidad !== null) {
      patch.largo = item.producto.largo
      patch.ancho = item.producto.ancho
      patch.alto = item.producto.alto
      patch.dims_unidad = item.producto.dimsUnidad
      hayMedidas = true
    }
    if (item.paquete.peso !== null) {
      patch.peso_paquete = item.paquete.peso
      patch.peso_paquete_unidad = item.paquete.pesoUnidad
      hayMedidas = true
    }
    if (item.paquete.dimsUnidad !== null) {
      patch.largo_paquete = item.paquete.largo
      patch.ancho_paquete = item.paquete.ancho
      patch.alto_paquete = item.paquete.alto
      patch.dims_paquete_unidad = item.paquete.dimsUnidad
      hayMedidas = true
    }

    // Solo cuando de verdad ha medido Amazon. Si no ha medido nada, la columna
    // NO se toca: puede estar valiendo 'manual', y pisarla borraría la única
    // señal que distingue una tarifa de FBA calculada sobre datos de Amazon de
    // una calculada sobre una caja medida a ojo.
    if (hayMedidas) patch.dims_origen = 'amazon'

    const { data, error } = await service
      .from('amazon_listings')
      .update(patch)
      .eq('connection_id', unidad.connectionId)
      .eq('marketplace_id', unidad.marketplaceId)
      .eq('asin', item.asin)
      .select('id')

    if (error) throw error
    filas += (data ?? []).length
    consultas += 1
  }

  return { filas, consultas }
}

/* ------------------------------------------------------------------ */
/* Lecturas del catálogo para la ingesta                               */
/* ------------------------------------------------------------------ */

/** Lo que hace falta de un listing para cruzarlo con lo que devuelve Amazon */
export interface ListingIngesta {
  id: string
  sku: string
  asin: string | null
  is_fba: boolean
  fulfillment_channel_code: string | null
  quantity: number | null
}

const CAMPOS_INGESTA = 'id, sku, asin, is_fba, fulfillment_channel_code, quantity'

/** Los listings de estos ASIN. Es lo que convierte «un ASIN» en «sus SKU» */
export async function listingsDeAsins(
  unidad: UnidadDeTrabajo,
  asins: string[],
  ambito: AmbitoCatalogo = {}
): Promise<ListingIngesta[]> {
  if (asins.length === 0) return []
  const service = createServiceClient()
  const salida: ListingIngesta[] = []

  for (let i = 0; i < asins.length; i += CHUNK_FILTRO) {
    const tramo = asins.slice(i, i + CHUNK_FILTRO)
    const filas = await fetchAll<ListingIngesta>((desde, hasta) => {
      let consulta = service
        .from('amazon_listings')
        .select(CAMPOS_INGESTA)
        .eq('connection_id', unidad.connectionId)
        .eq('marketplace_id', unidad.marketplaceId)
        .in('asin', tramo)
      if (ambito.skusFiltro && ambito.skusFiltro.length > 0) {
        consulta = consulta.in('sku', ambito.skusFiltro)
      }
      consulta = aplicarAmbito(consulta, ambito)
      return consulta.order('sku', { ascending: true }).range(desde, hasta)
    })
    salida.push(...filas)
  }

  return salida
}

/** Todo el catálogo de una unidad, recortado al ámbito del trabajo */
export async function listingsDeUnidadIngesta(
  unidad: UnidadDeTrabajo,
  ambito: AmbitoCatalogo = {}
): Promise<ListingIngesta[]> {
  const service = createServiceClient()
  return fetchAll<ListingIngesta>((desde, hasta) => {
    let consulta = service
      .from('amazon_listings')
      .select(CAMPOS_INGESTA)
      .eq('connection_id', unidad.connectionId)
      .eq('marketplace_id', unidad.marketplaceId)
    if (ambito.skusFiltro && ambito.skusFiltro.length > 0) {
      consulta = consulta.in('sku', ambito.skusFiltro)
    }
    consulta = aplicarAmbito(consulta, ambito)
    // El SKU es único dentro de (conexión, marketplace): el orden ya termina en
    // columna única y .range() no repite ni se salta filas.
    return consulta.order('sku', { ascending: true }).range(desde, hasta)
  })
}

/**
 * Cuántos listings hay en el ámbito de un trabajo.
 *
 * Se cuenta EN LA BASE con `head: true`, sin traerse ninguna fila: es lo que da
 * la barra de progreso, y traerse trece mil filas para saber que son trece mil
 * sería el viaje más caro del trabajo.
 */
export async function contarListings(
  unidad: UnidadDeTrabajo,
  ambito: AmbitoCatalogo & { soloConAsin?: boolean } = {}
): Promise<number> {
  const service = createServiceClient()
  let consulta = service
    .from('amazon_listings')
    .select('id', { count: 'exact', head: true })
    .eq('connection_id', unidad.connectionId)
    .eq('marketplace_id', unidad.marketplaceId)
  if (ambito.soloConAsin) consulta = consulta.not('asin', 'is', null)
  if (ambito.skusFiltro && ambito.skusFiltro.length > 0) {
    consulta = consulta.in('sku', ambito.skusFiltro)
  }
  consulta = aplicarAmbito(consulta, ambito)

  const { count, error } = await consulta
  if (error) throw error
  return count ?? 0
}
