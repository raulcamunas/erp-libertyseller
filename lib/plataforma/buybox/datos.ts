/**
 * PLATAFORMA · MÓDULO A2 — ACCESO A DATOS
 * =======================================
 * SOLO SERVIDOR: importa el cliente de service_role.
 *
 * Traduce entre las filas de Postgres y las estructuras puras de diagnostico.ts
 * y lectura.ts. Esos dos no saben que existe Supabase, y este es el motivo.
 *
 * Y la regla del módulo de Amazon, que vale igual aquí: NO se lee
 * `amazon_connections.refresh_token_enc`. Las columnas se piden por su nombre,
 * nunca con `*`, salvo en las tablas propias de A2 que no contienen credenciales.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { fetchAll, type UnidadDeTrabajo } from '../datos'
import { aplicarAmbito, type AmbitoCatalogo } from '../catalogo'
import type { ConfigDiagnostico } from './diagnostico'
import type {
  EstadoAmazonRetail,
  EstadoBuyBox,
  EstadoFoepA2,
  EstadoStock,
  FilaDiagnostico,
  OfertaGuardada,
  SnapshotBuyBox,
  Veredicto,
} from './tipos'

/** Cuántas filas por inserción. El mismo criterio que series.ts de A1 */
const CHUNK_INSERCION = 500

/** Cuántos SKU caben en un `.in(...)` sin que un proxy rechace la URL */
const CHUNK_FILTRO = 300

/** Cuántas lecturas seguidas se recuerdan para decidir si hay que alertar */
const MAX_HISTORIAL = 10

/* ------------------------------------------------------------------ */
/* 1. La configuración del cliente                                     */
/* ------------------------------------------------------------------ */

export interface ConfigBuyBox {
  id: string | null
  clientId: string
  condicion: string
  segmento: string
  foepRotacionDias: number
  /**
   * Cada cuántos minutos se le vuelve a pedir el FOEP a un mismo SKU.
   *
   * NULL = AUTOMÁTICO, y es lo normal: se calcula con las referencias CON STOCK
   * del cliente, al doble de lo que tarda un barrido. Ver cadenciaFoepAutomatica()
   * en rotacion.ts.
   *
   * El motivo de que sea automático es que el número bueno depende del stock, y
   * el stock se mueve solo: un cliente con 2.500 referencias con existencias hoy
   * puede tener 900 el mes que viene, y con el número a mano se queda pidiendo
   * cada dos horas algo que ya cabe en veinte minutos. Nadie revisa eso.
   *
   * Un número fija el reloj a mano. NULL no es «sin valor»: es «calcúlalo tú».
   */
  foepCadaMinutos: number | null
  foepMaxPorNoche: number | null
  foepColaActiva: boolean
  ofertasGuardadas: number
  margenMinimoPct: number | null
  deltaFoep: number | null
  deltaFoepTipo: 'absoluto' | 'porcentaje'
  precioSuelo: number | null
  precioTecho: number | null
  skusExcluidos: string[]
  escrituraAutorizada: boolean
  lecturasParaAlertar: number
  /** marketplaceId -> identificadores de vendedor de Amazon Retail */
  sellersAmazon: Record<string, string[]>
  notas: string | null
  updatedAt: string | null
}

/**
 * Los valores por defecto.
 *
 * TODO LO DE NEGOCIO A `null`. Lo único con número es lo técnico: la condición
 * («New»), el segmento («Consumer»), la cadencia de rotación del FOEP —que sale
 * del cálculo de la ventana nocturna, no de una regla de negocio— y las dos
 * lecturas seguidas antes de alertar, que existen para no avisar por el ruido de
 * la subasta de la Buy Box.
 */
export const CONFIG_BUYBOX_DEFECTO: Omit<ConfigBuyBox, 'clientId'> = {
  id: null,
  condicion: 'New',
  segmento: 'Consumer',
  /**
   * TODOS LOS DÍAS, no uno de cada siete.
   *
   * Los 7 días venían de cuando el FOEP barría el catálogo ENTERO: las 13.700
   * referencias de ShoesF son 2 h 53 min, y repartirlas en siete noches las
   * dejaba en 25 minutos.
   *
   * Desde que el ámbito es solo lo que tiene existencias, ese cliente baja a
   * ~2.500 referencias: 63 llamadas, 31 minutos, cabe en un día. Y tiene sentido
   * que quepa — un techo de precio de hace seis días no sirve para decidir hoy.
   *
   * El número sigue siendo por cliente: el día que entre un catálogo con 30.000
   * referencias CON STOCK habrá que repartirlo otra vez. La cuenta está en
   * minutosDeFoep() de rotacion.ts, y la pantalla la enseña al configurarlo.
   */
  foepRotacionDias: 1,
  /** Automático: lo calcula el ERP con las referencias con stock. Ver la 144 */
  foepCadaMinutos: null,
  foepMaxPorNoche: null,
  foepColaActiva: true,
  ofertasGuardadas: 10,
  margenMinimoPct: null,
  deltaFoep: null,
  deltaFoepTipo: 'absoluto',
  precioSuelo: null,
  precioTecho: null,
  skusExcluidos: [],
  escrituraAutorizada: false,
  lecturasParaAlertar: 2,
  sellersAmazon: {},
  notas: null,
  updatedAt: null,
}

/**
 * La configuración viva de un cliente.
 *
 * NUNCA devuelve null: si no hay fila, devuelve los valores por defecto con
 * `id: null`. Un cliente sin fila tiene que poder diagnosticarse igual —con
 * todos los umbrales sin decidir, que es el estado honesto— en vez de quedarse
 * fuera del barrido en silencio.
 */
export async function configDeCliente(clientId: string): Promise<ConfigBuyBox> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('amazon_buybox_config')
    .select('*')
    .eq('client_id', clientId)
    .eq('is_active', true)
    .limit(1)
  if (error) throw error

  const fila = (data ?? [])[0] as Record<string, unknown> | undefined
  if (!fila) return { ...CONFIG_BUYBOX_DEFECTO, clientId }

  return {
    id: String(fila.id),
    clientId,
    condicion: texto(fila.condicion) ?? 'New',
    segmento: texto(fila.segmento) ?? 'Consumer',
    foepRotacionDias: entero(fila.foep_rotacion_dias) ?? 1,
    // null = automático, y también es lo que sale si la columna todavía no
    // existe: las migraciones se lanzan a mano, así que el código puede llegar
    // antes. Que el valor por defecto de un hueco sea «calcúlalo» y no un número
    // fijo es lo correcto — un número inventado se queda ahí para siempre.
    foepCadaMinutos: entero(fila.foep_cada_minutos),
    foepMaxPorNoche: entero(fila.foep_max_por_noche),
    foepColaActiva: fila.foep_cola_activa !== false,
    ofertasGuardadas: entero(fila.ofertas_guardadas) ?? 10,
    margenMinimoPct: numero(fila.margen_minimo_pct),
    deltaFoep: numero(fila.delta_foep),
    deltaFoepTipo: fila.delta_foep_tipo === 'porcentaje' ? 'porcentaje' : 'absoluto',
    precioSuelo: numero(fila.precio_suelo),
    precioTecho: numero(fila.precio_techo),
    skusExcluidos: Array.isArray(fila.skus_excluidos) ? (fila.skus_excluidos as string[]) : [],
    escrituraAutorizada: fila.escritura_autorizada === true,
    lecturasParaAlertar: entero(fila.lecturas_para_alertar) ?? 2,
    sellersAmazon: mapaSellers(fila.sellers_amazon),
    notas: texto(fila.notas),
    updatedAt: texto(fila.updated_at),
  }
}

/** El trozo de la configuración que entiende el motor puro, para UN SKU */
export function configDelMotor(config: ConfigBuyBox, sku: string): ConfigDiagnostico {
  const excluido = config.skusExcluidos.includes(sku)
  return {
    toleranciaImporte: 0.01,
    margenMinimoPct: config.margenMinimoPct,
    deltaFoep: config.deltaFoep,
    deltaFoepTipo: config.deltaFoepTipo,
    precioSuelo: config.precioSuelo,
    precioTecho: config.precioTecho,
    excluidoDePropuesta: excluido,
    motivoExclusion: excluido
      ? 'Esta referencia está en la lista de excluidas de este cliente (precio mínimo impuesto por la marca o acuerdo comercial), así que no se propone ningún precio para ella.'
      : null,
  }
}

/** Guarda la configuración. Actualiza la viva; no crea una fila por guardado */
export async function guardarConfig(
  clientId: string,
  cambios: Partial<Omit<ConfigBuyBox, 'id' | 'clientId' | 'updatedAt'>>,
  userId: string | null
): Promise<ConfigBuyBox> {
  const service = createServiceClient()
  const actual = await configDeCliente(clientId)

  const fila: Record<string, unknown> = {}
  if (cambios.condicion !== undefined) fila.condicion = cambios.condicion
  if (cambios.segmento !== undefined) fila.segmento = cambios.segmento
  if (cambios.foepRotacionDias !== undefined) fila.foep_rotacion_dias = cambios.foepRotacionDias
  if (cambios.foepCadaMinutos !== undefined) fila.foep_cada_minutos = cambios.foepCadaMinutos
  if (cambios.foepMaxPorNoche !== undefined) fila.foep_max_por_noche = cambios.foepMaxPorNoche
  if (cambios.foepColaActiva !== undefined) fila.foep_cola_activa = cambios.foepColaActiva
  if (cambios.ofertasGuardadas !== undefined) fila.ofertas_guardadas = cambios.ofertasGuardadas
  if (cambios.margenMinimoPct !== undefined) fila.margen_minimo_pct = cambios.margenMinimoPct
  if (cambios.deltaFoep !== undefined) fila.delta_foep = cambios.deltaFoep
  if (cambios.deltaFoepTipo !== undefined) fila.delta_foep_tipo = cambios.deltaFoepTipo
  if (cambios.precioSuelo !== undefined) fila.precio_suelo = cambios.precioSuelo
  if (cambios.precioTecho !== undefined) fila.precio_techo = cambios.precioTecho
  if (cambios.skusExcluidos !== undefined) fila.skus_excluidos = cambios.skusExcluidos
  if (cambios.escrituraAutorizada !== undefined) {
    fila.escritura_autorizada = cambios.escrituraAutorizada
  }
  if (cambios.lecturasParaAlertar !== undefined) {
    fila.lecturas_para_alertar = cambios.lecturasParaAlertar
  }
  if (cambios.sellersAmazon !== undefined) fila.sellers_amazon = cambios.sellersAmazon
  if (cambios.notas !== undefined) fila.notas = cambios.notas

  if (actual.id) {
    const { error } = await service
      .from('amazon_buybox_config')
      .update(fila)
      .eq('id', actual.id)
      .eq('is_active', true)
    if (error) throw error
  } else {
    const { error } = await service
      .from('amazon_buybox_config')
      .insert({ ...fila, client_id: clientId, created_by: userId })
    if (error) throw error
  }

  return configDeCliente(clientId)
}

/* ------------------------------------------------------------------ */
/* 2. Recorrer el catálogo por SKU                                     */
/* ------------------------------------------------------------------ */

export interface ListingBuyBox {
  id: string
  sku: string
  asin: string | null
  is_fba: boolean
  fulfillment_channel_code: string | null
  price: number | null
  currency: string | null
  quantity: number | null
}

const CAMPOS_LISTING =
  'id, sku, asin, is_fba, fulfillment_channel_code, price, currency, quantity'

export interface TramoSkus {
  listings: ListingBuyBox[]
  /** El último SKU incluido. Es el cursor del trabajo */
  ultimo: string | null
  hayMas: boolean
}

/**
 * Los siguientes SKU del catálogo, en orden ascendente.
 *
 * EL ORDEN TERMINA EN COLUMNA ÚNICA a propósito: el SKU es único dentro de
 * (conexión, marketplace), así que el cursor «mayor que este» ni repite ni se
 * salta filas al reanudar. Con un orden con empates, una fila saltada es un SKU
 * que se queda sin diagnosticar y nadie lo nota.
 */
export async function siguientesSkus(
  unidad: UnidadDeTrabajo,
  cursor: string | null,
  cuantos: number,
  ambito: AmbitoCatalogo = {}
): Promise<TramoSkus> {
  const service = createServiceClient()

  let consulta = service
    .from('amazon_listings')
    .select(CAMPOS_LISTING)
    .eq('connection_id', unidad.connectionId)
    .eq('marketplace_id', unidad.marketplaceId)

  if (cursor) consulta = consulta.gt('sku', cursor)
  if (ambito.skusFiltro && ambito.skusFiltro.length > 0) {
    consulta = consulta.in('sku', ambito.skusFiltro)
  }
  consulta = aplicarAmbito(consulta, ambito)

  const { data, error } = await consulta
    .order('sku', { ascending: true })
    .limit(cuantos + 1)
  if (error) throw error

  const filas = (data ?? []) as unknown as ListingBuyBox[]
  const tomados = filas.slice(0, cuantos)

  return {
    listings: tomados,
    ultimo: tomados.length > 0 ? tomados[tomados.length - 1].sku : cursor,
    hayMas: filas.length > cuantos,
  }
}

/** Los listings de un puñado de SKU concretos. Es «una clave del lote → su fila» */
export async function listingsDeSkus(
  unidad: UnidadDeTrabajo,
  skus: string[]
): Promise<Map<string, ListingBuyBox>> {
  const salida = new Map<string, ListingBuyBox>()
  if (skus.length === 0) return salida
  const service = createServiceClient()

  for (let i = 0; i < skus.length; i += CHUNK_FILTRO) {
    const tramo = skus.slice(i, i + CHUNK_FILTRO)
    const filas = await fetchAll<ListingBuyBox>((a, b) =>
      service
        .from('amazon_listings')
        .select(CAMPOS_LISTING)
        .eq('connection_id', unidad.connectionId)
        .eq('marketplace_id', unidad.marketplaceId)
        .in('sku', tramo)
        .order('sku', { ascending: true })
        .range(a, b)
    )
    for (const fila of filas) salida.set(fila.sku, fila)
  }
  return salida
}

/** Cuántos SKU hay en el ámbito. Se cuenta en la base, sin traer filas */
export async function contarSkus(
  unidad: UnidadDeTrabajo,
  ambito: AmbitoCatalogo = {}
): Promise<number> {
  const service = createServiceClient()
  let consulta = service
    .from('amazon_listings')
    .select('id', { count: 'exact', head: true })
    .eq('connection_id', unidad.connectionId)
    .eq('marketplace_id', unidad.marketplaceId)
  if (ambito.skusFiltro && ambito.skusFiltro.length > 0) {
    consulta = consulta.in('sku', ambito.skusFiltro)
  }
  consulta = aplicarAmbito(consulta, ambito)
  const { count, error } = await consulta
  if (error) throw error
  return count ?? 0
}

/* ------------------------------------------------------------------ */
/* 3. Escribir la serie de precios                                     */
/* ------------------------------------------------------------------ */

export interface SnapshotNuevo {
  listingId: string | null
  connectionId: string
  sellingPartnerId: string
  marketplaceId: string
  sku: string
  asin: string | null

  precioPropio: number | null
  precioPropioEnvio: number | null
  moneda: string
  canalPropio: string | null

  buyboxEstado: EstadoBuyBox
  precioBuybox: number | null
  precioBuyboxEnvio: number | null
  canalGanador: string | null

  nCompetidores: number | null
  nOfertas: number | null
  nCompetidoresPrime: number | null
  hayOfertaPropia: boolean | null
  precioCompetidorMin: number | null
  precioCompetidorMinLanded: number | null

  amazonEstado: EstadoAmazonRetail

  foep: number | null
  foepEstado: EstadoFoepA2
  foepResultado: string | null
  foepMoneda: string | null

  condicion: string | null
  segmento: string | null
  ofertas: OfertaGuardada[] | null

  origen: 'pricing' | 'foep'
  requestId: string | null
  jobId: string | null
}

/**
 * Escribe lecturas de precio y Buy Box. SOLO INSERTA.
 *
 * ============ LOS DOS CANDADOS QUE SE APLICAN AQUÍ Y NO EN LA BASE ============
 *
 * La migración tiene CHECK para las dos cosas, pero un CHECK reventado tumba el
 * LOTE ENTERO —quinientas observaciones perdidas por una fila mal montada— así
 * que se normaliza antes de escribir:
 *
 *   · `tiene_buybox` se DERIVA de `buybox_estado`, nunca se pasa suelto. Son la
 *     misma verdad y no pueden contradecirse.
 *   · `amazon_en_asin` se DERIVA de `amazon_estado`, y el `indeterminado` se
 *     escribe como NULL. Es lo que hace imposible que un «no se puede saber»
 *     acabe guardado como «no».
 *
 * Y el FOEP: si el estado no es `disponible`, el importe se fuerza a null. El
 * CHECK de la 123 lo exigiría igual, pero perder el lote por eso sería perder la
 * observación de las otras trece mil referencias.
 */
export async function insertarSnapshots(filas: SnapshotNuevo[]): Promise<number> {
  if (filas.length === 0) return 0

  const payload = filas.map((f) => {
    const disponible = f.foepEstado === 'disponible'
    return {
      listing_id: f.listingId,
      connection_id: f.connectionId,
      selling_partner_id: f.sellingPartnerId,
      marketplace_id: f.marketplaceId,
      sku: f.sku,
      asin: f.asin,

      precio_propio: f.precioPropio,
      precio_propio_envio: f.precioPropioEnvio,
      moneda: f.moneda,
      canal_propio: f.canalPropio,

      buybox_estado: f.buyboxEstado,
      // DERIVADO. Ver la cabecera.
      tiene_buybox: booleanoDeBuybox(f.buyboxEstado),
      precio_buybox: f.precioBuybox,
      precio_buybox_envio: f.precioBuyboxEnvio,
      canal_ganador: f.canalGanador,

      n_competidores: f.nCompetidores,
      n_ofertas: f.nOfertas,
      n_competidores_prime: f.nCompetidoresPrime,
      hay_oferta_propia: f.hayOfertaPropia,
      precio_competidor_min: f.precioCompetidorMin,
      precio_competidor_min_landed: f.precioCompetidorMinLanded,

      amazon_estado: f.amazonEstado,
      // DERIVADO, y el `indeterminado` va a NULL: es lo que impide colapsarlo.
      amazon_en_asin: booleanoDeAmazon(f.amazonEstado),

      foep: disponible ? f.foep : null,
      foep_estado: f.foepEstado,
      foep_resultado: f.foepResultado,
      foep_moneda: disponible ? f.foepMoneda : null,

      condicion: f.condicion,
      segmento: f.segmento,
      ofertas: f.ofertas && f.ofertas.length > 0 ? f.ofertas : null,

      origen: f.origen,
      request_id: f.requestId,
      job_id: f.jobId,
    }
  })

  return insertarEnLotes('amazon_snapshots_precio', payload)
}

/** nuestra = true · de_otro y nadie = false · desconocido = null. NUNCA otra cosa */
export function booleanoDeBuybox(estado: EstadoBuyBox): boolean | null {
  if (estado === 'nuestra') return true
  if (estado === 'desconocido') return null
  return false
}

/** si = true · no = false · indeterminado = NULL. El NULL es el punto entero */
export function booleanoDeAmazon(estado: EstadoAmazonRetail): boolean | null {
  if (estado === 'si') return true
  if (estado === 'no') return false
  return null
}

/* ------------------------------------------------------------------ */
/* 4. Escribir los diagnósticos                                        */
/* ------------------------------------------------------------------ */

export interface DiagnosticoNuevo {
  listingId: string | null
  connectionId: string
  sellingPartnerId: string
  marketplaceId: string
  sku: string
  asin: string | null

  veredicto: Veredicto
  motivo: string
  accion: string
  prioridad: number

  buyboxEstado: EstadoBuyBox
  amazonEstado: EstadoAmazonRetail
  precioPropio: number | null
  moneda: string | null
  foep: number | null
  foepEstado: EstadoFoepA2

  datos: unknown
  precioPropuesto: number | null
  precioPropuestoMotivo: string | null
  snapshotId: string | null
  foepFecha: string | null
  jobId: string | null
}

export async function insertarDiagnosticos(filas: DiagnosticoNuevo[]): Promise<number> {
  if (filas.length === 0) return 0

  const payload = filas.map((f) => {
    const disponible = f.foepEstado === 'disponible'
    return {
      listing_id: f.listingId,
      connection_id: f.connectionId,
      selling_partner_id: f.sellingPartnerId,
      marketplace_id: f.marketplaceId,
      sku: f.sku,
      asin: f.asin,
      veredicto: f.veredicto,
      motivo: f.motivo,
      accion: f.accion,
      prioridad: f.prioridad,
      buybox_estado: f.buyboxEstado,
      amazon_estado: f.amazonEstado,
      precio_propio: f.precioPropio,
      moneda: f.moneda,
      foep: disponible ? f.foep : null,
      foep_estado: f.foepEstado,
      datos: f.datos ?? {},
      precio_propuesto: f.precioPropuesto,
      precio_propuesto_motivo: f.precioPropuestoMotivo,
      snapshot_id: f.snapshotId,
      foep_fecha: f.foepFecha,
      job_id: f.jobId,
    }
  })

  return insertarEnLotes('amazon_buybox_diagnostico', payload)
}

/* ------------------------------------------------------------------ */
/* 5. Leer lo último de cada SKU                                       */
/* ------------------------------------------------------------------ */

export interface UltimoDeSku {
  /** La última lectura de OFERTAS (la que sabe de Buy Box y competencia) */
  ofertas: SnapshotBuyBox | null
  /** La última lectura con FOEP, que puede ser de otra noche */
  foep: SnapshotBuyBox | null
  /**
   * Los estados de Buy Box de las últimas lecturas, de la más nueva a la más
   * vieja.
   *
   * Existe por UNA cosa: no alertar por el ruido de la subasta. La oferta
   * destacada rota entre ofertas empatadas varias veces al día, así que una sola
   * lectura sin Buy Box no significa que se haya perdido. Con dos lecturas
   * seguidas ya es una pérdida; con una, es una alerta falsa cada noche en cada
   * SKU empatado.
   */
  historial: EstadoBuyBox[]
}

const CAMPOS_SNAPSHOT =
  'id, sku, asin, fecha, precio_propio, precio_propio_envio, moneda, canal_propio, ' +
  'buybox_estado, tiene_buybox, precio_buybox, precio_buybox_envio, canal_ganador, ' +
  'n_competidores, n_ofertas, n_competidores_prime, hay_oferta_propia, ' +
  'precio_competidor_min, precio_competidor_min_landed, amazon_estado, amazon_en_asin, ' +
  'foep, foep_estado, foep_resultado, foep_moneda, origen'

/**
 * Las últimas lecturas de un puñado de SKU.
 *
 * SE PIDEN LAS DOS COSAS EN UNA SOLA CONSULTA y se separan en memoria, porque
 * son dos preguntas distintas sobre la misma serie:
 *
 *   · la última lectura de OFERTAS: quién tiene la Buy Box, a cuánto, cuántos
 *     competidores. Se refresca todas las noches.
 *   · la última lectura con FOEP: el techo. Con la rotación semanal puede tener
 *     seis días, y eso NO es un fallo: es el diseño que hace que la ventana
 *     nocturna quepa. Lo que sí hace falta es que el veredicto lo diga.
 *
 * La ventana en días acota la consulta: sin ella, la serie de un SKU con un año
 * de histórico son 365 filas por referencia para leer dos.
 */
export async function ultimosPorSku(
  unidad: UnidadDeTrabajo,
  skus: string[],
  ventanaDias: number
): Promise<Map<string, UltimoDeSku>> {
  const salida = new Map<string, UltimoDeSku>()
  if (skus.length === 0) return salida

  const service = createServiceClient()
  const desde = new Date(Date.now() - Math.max(1, ventanaDias) * 86400000).toISOString()

  for (let i = 0; i < skus.length; i += CHUNK_FILTRO) {
    const tramo = skus.slice(i, i + CHUNK_FILTRO)
    const filas = await fetchAll<SnapshotBuyBox>((desdeFila, hasta) =>
      service
        .from('amazon_snapshots_precio')
        .select(CAMPOS_SNAPSHOT)
        .eq('connection_id', unidad.connectionId)
        .eq('marketplace_id', unidad.marketplaceId)
        .in('sku', tramo)
        .gte('fecha', desde)
        .order('fecha', { ascending: false })
        // El desempate por id no es cosmético: dos lecturas del mismo instante
        // —pasa cuando el lote de ofertas y el de FOEP caen en el mismo
        // milisegundo— saldrían en un orden distinto en cada consulta y el
        // diagnóstico bailaría sin que nada hubiera cambiado.
        .order('id', { ascending: false })
        .range(desdeFila, hasta)
    )

    for (const fila of filas) {
      const actual = salida.get(fila.sku) ?? { ofertas: null, foep: null, historial: [] }
      // Las filas vienen de la más nueva a la más vieja: la PRIMERA que cumple
      // cada condición es la buena, y por eso no se compara ninguna fecha.
      if (actual.ofertas === null && fila.buybox_estado !== 'desconocido') {
        actual.ofertas = fila
      }
      if (actual.foep === null && fila.foep_estado !== 'no_consultado') {
        actual.foep = fila
      }
      // Las lecturas sin dato NO entran en el historial: una caída de red no es
      // una pérdida de Buy Box, y contarla como tal dispararía la alerta.
      if (fila.buybox_estado !== 'desconocido' && actual.historial.length < MAX_HISTORIAL) {
        actual.historial.push(fila.buybox_estado)
      }
      salida.set(fila.sku, actual)
    }
  }

  return salida
}

/* ------------------------------------------------------------------ */
/* 6. El stock, con sus tres estados                                   */
/* ------------------------------------------------------------------ */

/**
 * Las últimas existencias conocidas de un puñado de SKU.
 *
 * LOS TRES ESTADOS SE RESPETAN TAL CUAL VIENEN DE A1 y no se colapsan aquí:
 *
 *   conocido    -> `disponible` es de verdad (SKU de FBA).
 *   no_aplica   -> es de FBM: Amazon no tiene existencias suyas y eso NO ES
 *                  CERO. Las unidades son las del propio listing.
 *   desconocido -> no se pudo leer. TAMPOCO es cero.
 *
 * Si esto se colapsara a un número, el catálogo FBM entero de un cliente saldría
 * «sin stock → reponer» con el almacén lleno. Es el mismo error que a A1 le costó
 * un estado extra en la tabla.
 */
export async function stockPorSku(
  unidad: UnidadDeTrabajo,
  skus: string[],
  ventanaDias: number
): Promise<Map<string, EstadoStock>> {
  const salida = new Map<string, EstadoStock>()
  if (skus.length === 0) return salida

  const service = createServiceClient()
  const desde = new Date(Date.now() - Math.max(1, ventanaDias) * 86400000).toISOString()

  for (let i = 0; i < skus.length; i += CHUNK_FILTRO) {
    const tramo = skus.slice(i, i + CHUNK_FILTRO)
    const filas = await fetchAll<{
      sku: string
      fecha: string
      estado_dato: EstadoStock['estado']
      disponible: number | null
      stock_propio: number | null
    }>((a, b) =>
      service
        .from('amazon_snapshots_inventario')
        .select('sku, fecha, estado_dato, disponible, stock_propio')
        .eq('connection_id', unidad.connectionId)
        .eq('marketplace_id', unidad.marketplaceId)
        .in('sku', tramo)
        .gte('fecha', desde)
        .order('fecha', { ascending: false })
        .order('id', { ascending: false })
        .range(a, b)
    )

    for (const fila of filas) {
      if (salida.has(fila.sku)) continue // la primera es la más nueva
      salida.set(fila.sku, {
        estado: fila.estado_dato,
        unidades:
          fila.estado_dato === 'conocido'
            ? fila.disponible
            : fila.estado_dato === 'no_aplica'
              ? fila.stock_propio
              : null,
        leidoAt: fila.fecha,
      })
    }
  }

  return salida
}

/* ------------------------------------------------------------------ */
/* 7. La cola de FOEP                                                  */
/* ------------------------------------------------------------------ */

export type MotivoCola = 'perdida' | 'peticion' | 'analisis'

/**
 * Mete SKU en la cola de FOEP.
 *
 * UPSERT sobre (conexión, marketplace, sku): pedir dos veces el mismo SKU no
 * duplica la fila, la reabre. Y se reabre a propósito —`servido_at` vuelve a
 * null— porque «lo pedí ayer y ya se sirvió» y «lo vuelvo a necesitar hoy» son
 * dos cosas distintas.
 */
export async function encolarFoep(
  unidad: UnidadDeTrabajo,
  skus: string[],
  motivo: MotivoCola,
  userId: string | null = null
): Promise<number> {
  const limpios = [...new Set(skus.map((s) => s.trim()).filter((s) => s !== ''))]
  if (limpios.length === 0) return 0

  const service = createServiceClient()
  const ahora = new Date().toISOString()
  let escritas = 0

  for (let i = 0; i < limpios.length; i += CHUNK_INSERCION) {
    const tramo = limpios.slice(i, i + CHUNK_INSERCION)
    const { error } = await service.from('amazon_buybox_cola_foep').upsert(
      tramo.map((sku) => ({
        connection_id: unidad.connectionId,
        marketplace_id: unidad.marketplaceId,
        sku,
        motivo,
        pedido_at: ahora,
        servido_at: null,
        created_by: userId,
      })),
      { onConflict: 'connection_id,marketplace_id,sku' }
    )
    if (error) throw error
    escritas += tramo.length
  }
  return escritas
}

/**
 * LOS SKU A LOS QUE YA SE LES HA PEDIDO EL FOEP DESDE UNA FECHA.
 *
 * EXISTE PARA QUE LA FRECUENCIA DEL TRABAJO NO MULTIPLIQUE EL COSTE DEL FOEP.
 *
 * La rotación decide de quién es el turno con el DÍA (`leTocaFoep`), no con
 * cuándo se le preguntó por última vez. Mientras el trabajo corría una vez por
 * noche eso daba igual: mismo día, misma tanda, una vez. Al subir «Precios y Buy
 * Box» a cada quince minutos, la misma tanda salía elegida 96 veces al día y a
 * cada SKU se le pedía el FOEP 96 veces — la operación más cara de la
 * plataforma, una petición cada treinta segundos.
 *
 * No habría dado ningún error: el cubo de fichas simplemente habría puesto a
 * esperar al resto de trabajos de todos los clientes, y la cola se habría ido
 * llenando sin que nada dijera por qué.
 *
 * Sale del índice parcial `idx_amazon_snap_precio_foep`, que existe justo para
 * esta pregunta.
 */
export async function skusConFoepDesde(
  unidad: UnidadDeTrabajo,
  desdeIso: string
): Promise<Set<string>> {
  const service = createServiceClient()
  const filas = await fetchAll<{ sku: string }>((desde, hasta) =>
    service
      .from('amazon_snapshots_precio')
      .select('sku')
      .eq('connection_id', unidad.connectionId)
      .eq('marketplace_id', unidad.marketplaceId)
      .neq('foep_estado', 'no_consultado')
      .gte('fecha', desdeIso)
      // El orden termina en columna única dentro de la unidad, que es lo que
      // exige fetchAll() para que `.range()` no repita ni se salte filas.
      .order('fecha', { ascending: true })
      .order('sku', { ascending: true })
      .range(desde, hasta)
  )
  return new Set(filas.map((f) => f.sku))
}

/**
 * CUÁNDO SE PIDIÓ EL FOEP POR ÚLTIMA VEZ EN CADA CUENTA Y PAÍS.
 *
 * El FOEP NO es un trabajo: es una fase dentro de «Precios y Buy Box». Por eso
 * no sale en `plataforma_ultimos_refrescos`, que mira amazon_jobs, y por eso
 * hace falta esto para poder enseñarlo en la rejilla de «Al día» al lado de los
 * demás. Sin él, la fila de arriba dice cada cuánto se pide y abajo no hay forma
 * de comprobar si se está pidiendo de verdad — que es el fallo que toda esta
 * pantalla existe para evitar.
 *
 * Una consulta por unidad, con `limit(1)`: es un salto al índice parcial
 * `idx_amazon_snap_precio_foep`, que está ordenado justo por esto. Con once
 * países son once saltos.
 */
export async function ultimoFoepPorUnidad(
  unidades: UnidadDeTrabajo[]
): Promise<Record<string, string>> {
  const service = createServiceClient()
  const salida: Record<string, string> = {}

  await Promise.all(
    unidades.map(async (u) => {
      try {
        const { data, error } = await service
          .from('amazon_snapshots_precio')
          .select('fecha')
          .eq('connection_id', u.connectionId)
          .eq('marketplace_id', u.marketplaceId)
          .neq('foep_estado', 'no_consultado')
          .order('fecha', { ascending: false })
          .limit(1)
        if (error) throw error
        const fecha = (data ?? [])[0]?.fecha
        if (fecha) salida[`${u.connectionId}|${u.marketplaceId}`] = String(fecha)
      } catch {
        // Sin la tabla —migración sin lanzar— no hay fecha y la fila dirá
        // «nunca». Es la verdad: no se ha pedido ninguno.
      }
    })
  )

  return salida
}

/** Los SKU que esperan FOEP, del más antiguo al más nuevo */
export async function colaFoepPendiente(
  unidad: UnidadDeTrabajo,
  limite: number
): Promise<string[]> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('amazon_buybox_cola_foep')
    .select('sku')
    .eq('connection_id', unidad.connectionId)
    .eq('marketplace_id', unidad.marketplaceId)
    .is('servido_at', null)
    .order('pedido_at', { ascending: true })
    .order('sku', { ascending: true })
    .limit(Math.max(1, limite))
  if (error) throw error
  return ((data ?? []) as Array<{ sku: string }>).map((f) => f.sku)
}

/** Marca servidos los SKU a los que ya se les ha pedido el FOEP */
export async function marcarColaServida(
  unidad: UnidadDeTrabajo,
  skus: string[]
): Promise<void> {
  if (skus.length === 0) return
  const service = createServiceClient()
  const ahora = new Date().toISOString()

  for (let i = 0; i < skus.length; i += CHUNK_FILTRO) {
    const tramo = skus.slice(i, i + CHUNK_FILTRO)
    const { error } = await service
      .from('amazon_buybox_cola_foep')
      .update({ servido_at: ahora })
      .eq('connection_id', unidad.connectionId)
      .eq('marketplace_id', unidad.marketplaceId)
      .in('sku', tramo)
      .is('servido_at', null)
    if (error) throw error
  }
}

/** Cuántos esperan. Para la pantalla */
export async function contarColaFoep(unidad: UnidadDeTrabajo): Promise<number> {
  const service = createServiceClient()
  const { count, error } = await service
    .from('amazon_buybox_cola_foep')
    .select('id', { count: 'exact', head: true })
    .eq('connection_id', unidad.connectionId)
    .eq('marketplace_id', unidad.marketplaceId)
    .is('servido_at', null)
  if (error) throw error
  return count ?? 0
}

/* ------------------------------------------------------------------ */
/* 8. Leer diagnósticos                                                */
/* ------------------------------------------------------------------ */

/** El último diagnóstico de un SKU. Para la ficha y para la cola de alertas */
export async function ultimosDiagnosticos(
  unidad: UnidadDeTrabajo,
  skus: string[],
  ventanaDias = 30
): Promise<Map<string, FilaDiagnostico>> {
  const salida = new Map<string, FilaDiagnostico>()
  if (skus.length === 0) return salida

  const service = createServiceClient()
  const desde = new Date(Date.now() - Math.max(1, ventanaDias) * 86400000).toISOString()

  for (let i = 0; i < skus.length; i += CHUNK_FILTRO) {
    const tramo = skus.slice(i, i + CHUNK_FILTRO)
    const filas = await fetchAll<FilaDiagnostico>((a, b) =>
      service
        .from('amazon_buybox_diagnostico')
        .select('*')
        .eq('connection_id', unidad.connectionId)
        .eq('marketplace_id', unidad.marketplaceId)
        .in('sku', tramo)
        .gte('fecha', desde)
        .order('fecha', { ascending: false })
        .order('id', { ascending: false })
        .range(a, b)
    )
    for (const fila of filas) {
      if (!salida.has(fila.sku)) salida.set(fila.sku, fila)
    }
  }

  return salida
}

/* ------------------------------------------------------------------ */
/* Utilidad                                                            */
/* ------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-explicit-any */
async function insertarEnLotes(tabla: string, filas: Record<string, any>[]): Promise<number> {
  if (filas.length === 0) return 0
  const service = createServiceClient()
  let escritas = 0
  for (let i = 0; i < filas.length; i += CHUNK_INSERCION) {
    const tramo = filas.slice(i, i + CHUNK_INSERCION)
    const { error } = await service.from(tabla).insert(tramo)
    if (error) throw error
    escritas += tramo.length
  }
  return escritas
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function texto(valor: unknown): string | null {
  if (typeof valor !== 'string') return null
  const limpio = valor.trim()
  return limpio === '' ? null : limpio
}

function numero(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null
  const n = Number(valor)
  return Number.isFinite(n) ? n : null
}

function entero(valor: unknown): number | null {
  const n = numero(valor)
  return n === null ? null : Math.round(n)
}

function mapaSellers(valor: unknown): Record<string, string[]> {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return {}
  const salida: Record<string, string[]> = {}
  for (const [clave, lista] of Object.entries(valor as Record<string, unknown>)) {
    if (Array.isArray(lista)) {
      salida[clave] = lista.filter((v): v is string => typeof v === 'string')
    }
  }
  return salida
}
