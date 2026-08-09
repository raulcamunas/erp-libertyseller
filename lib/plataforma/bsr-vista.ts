/**
 * PLATAFORMA · LOS RANKINGS DE UN CLIENTE, VISTOS DE CONJUNTO
 * ===========================================================
 * SOLO SERVIDOR: importa el cliente de service_role.
 *
 * La ficha de SKU (pestaña Ingesta) ya pinta la serie de UNA referencia. Lo que
 * falta y monta esto es la vista de CONJUNTO: qué se mueve, qué lleva semanas
 * cayendo, qué acaba de entrar en el top de su categoría — y, sobre todo, DE QUÉ
 * NO TENEMOS RANKING Y POR QUÉ.
 *
 *
 * TRES COSAS QUE DECIDEN SI ESTA PANTALLA DICE LA VERDAD
 * -----------------------------------------------------
 *
 * 1. UNA FILA POR (SKU × CATEGORÍA), NO POR SKU. Amazon devuelve dos jerarquías
 *    —`grupo` es el número grande de la categoría raíz, `categoria` es la
 *    subcategoría de la ficha— y varias entradas de cada una. Un puesto 113 de
 *    subcategoría y un 72.855 de categoría raíz en la misma serie la dejan sin
 *    significado. La migración 123 guarda `tipo` justo para esto y aquí se
 *    respeta: se pide un tipo, y dentro se separa por categoría.
 *
 * 2. UN DÍA SIN OBSERVACIÓN ES UN HUECO, NO UN VALOR. Aquí se devuelve un punto
 *    por DÍA OBSERVADO, y los días sin observación sencillamente no salen. Es la
 *    pantalla la que abre el hueco en la gráfica. Rellenarlo con el último valor
 *    conocido dibujaría una línea plana que nadie ha medido, en una pantalla
 *    desde la que se decide sobre el dinero de otro.
 *
 * 3. «SIN RANKING» SE EXPLICA, NO SE DEJA EN BLANCO. Con porQueSinBsr(): puede
 *    ser que el cliente sea de reventa y su BSR no se mida a diario a propósito
 *    —es una decisión tomada, no una avería— o que la referencia no sea de marca
 *    propia en un cliente mixto. Un hueco explicado no es un hueco.
 *
 *
 * EL TECHO DE OBSERVACIONES, Y POR QUÉ NO ES UN UMBRAL DE NEGOCIO
 * --------------------------------------------------------------
 * Se leen como mucho MAX_OBSERVACIONES filas, de la más reciente hacia atrás. No
 * es una regla del negocio: es el techo de una petición HTTP. Cuando se alcanza
 * se dice (`truncado`), porque una serie recortada en silencio parece una serie
 * corta y eso es exactamente la mentira que esta pantalla existe para no contar.
 *
 * En la práctica no se toca: el barrido diario de BSR solo lo tienen los
 * clientes de marca propia, que son los de catálogo corto. Los de reventa —los de
 * trece mil y treinta mil referencias— miden bajo demanda, que es justo la
 * decisión que hace que la ventana nocturna quepa.
 */

import { createServiceClient } from '@/lib/supabase/service'
import {
  cadenciaBsr,
  porQueSinBsr,
  type CadenciaBsr,
  type ModeloNegocio,
  type PoliticaBsr,
} from './modelo-negocio'
import { clienteDe } from './simulacro-activos'
import type { TipoRankBsr } from './tipos'

/** Filas de snapshot que se leen como mucho. Ver la cabecera */
const MAX_OBSERVACIONES = 20000

/** Series distintas que se devuelven como mucho */
const MAX_FILAS = 300

/**
 * Referencias medidas a las que se les busca su fila de catálogo.
 *
 * Sirve para dos cosas: ponerle nombre a las series que se pintan y contar
 * cuántas de las que están en seguimiento tienen ranking. Diez consultas de
 * doscientos SKU es el techo de lo que puede costar una petición; por encima se
 * dice `truncado` y los contadores se quedan cortos, nunca largos.
 */
const MAX_SKUS_NOMBRADOS = 2000

/** Cuántas referencias sin ranking se listan de ejemplo */
const MAX_SIN_RANKING = 60

/** Supabase corta cualquier consulta a 1000 filas */
const PAGE = 1000

/** Cuántos SKU caben en un `.in(...)` sin que la URL se pase de largo */
const CHUNK_SKUS = 200

export const DIAS_POR_OMISION = 30
export const MAX_DIAS = 365

/* ------------------------------------------------------------------ */
/* Lo que sale                                                         */
/* ------------------------------------------------------------------ */

/** Una observación, ya reducida a una por día */
export interface PuntoBsr {
  /** 'YYYY-MM-DD' */
  dia: string
  rank: number
}

export interface FilaBsr {
  sku: string
  asin: string | null
  title: string | null
  marca: string | null
  esMarcaPropia: boolean
  /** Está en el refresco diario ahora mismo (manual gana sobre calculado) */
  enSeguimiento: boolean

  categoria: string
  categoriaId: string | null

  /** El último puesto medido en la ventana */
  ultimo: number
  ultimoAt: string
  /** El primero de la ventana. Con una sola observación, es el mismo */
  primero: number
  primeroAt: string
  /**
   * ultimo − primero. NEGATIVO ES MEJORAR: en el BSR el puesto 1 es el que más
   * vende. null cuando solo hay una observación, porque con un punto no hay
   * tendencia que contar y un cero diría que no se ha movido.
   */
  delta: number | null
  mejor: number
  peor: number
  observaciones: number
  puntos: PuntoBsr[]
}

export interface SinRanking {
  sku: string
  title: string | null
  esMarcaPropia: boolean
  /** Ya redactado por porQueSinBsr(). null = sí debería medirse y no está */
  motivo: string | null
}

export interface VistaBsr {
  cliente: { id: string; name: string; modelo: ModeloNegocio; politica: PoliticaBsr }
  connectionId: string
  connectionName: string
  marketplaceId: string
  dias: number
  tipo: TipoRankBsr

  /** La cadencia del cliente, ya resuelta */
  cadencia: CadenciaBsr
  /** Por qué no se mide a diario. null cuando sí se mide */
  porQueNoADiario: string | null

  totales: {
    catalogo: number
    enSeguimiento: number
    /** De los que están en seguimiento, cuántos tienen ranking en la ventana */
    conRanking: number
    /** enSeguimiento − conRanking */
    sinRanking: number
    observaciones: number
  }

  /**
   * La última vez que se midió algo de esta cuenta y país, SIN ventana.
   *
   * Es lo que separa «nunca se ha medido» de «no se ha medido últimamente», que
   * son dos noticias distintas: la primera es configuración, la segunda es una
   * ingesta parada.
   */
  ultimaMedicion: string | null

  filas: FilaBsr[]
  sinRankingMuestra: SinRanking[]

  /** Se ha llegado al techo de lectura o al de series. Ver la cabecera */
  truncado: boolean
  leidoAt: string
}

/* ------------------------------------------------------------------ */
/* La consulta                                                         */
/* ------------------------------------------------------------------ */

/** Lo mínimo de un snapshot para pintar la serie */
interface FilaSnapshot {
  sku: string
  asin: string | null
  fecha: string
  categoria: string
  categoria_id: string | null
  rank: number
}

/** Lo mínimo de un listing para poner nombre a una serie */
interface FilaListing {
  sku: string
  title: string | null
  asin: string | null
  marca: string | null
  es_marca_propia: boolean
  activo_calculado: boolean
  activo_manual: boolean | null
}

const LISTING_FIELDS =
  'sku, title, asin, marca, es_marca_propia, activo_calculado, activo_manual'

/**
 * Los rankings de una unidad de trabajo (conexión × marketplace).
 *
 * Devuelve `null` cuando la conexión no es de ese cliente. `connectionId` viaja
 * desde el navegador, así que sin esa puerta bastaría cambiarlo en la dirección
 * para leer el catálogo de otro cliente — es la misma comprobación que hacen
 * fichaSku() y marcarActivoManual().
 */
export async function vistaBsr(params: {
  clientId: string
  connectionId: string
  marketplaceId: string
  dias?: number
  tipo?: TipoRankBsr
}): Promise<VistaBsr | null> {
  const service = createServiceClient()
  const dias = Math.min(MAX_DIAS, Math.max(1, Math.round(params.dias ?? DIAS_POR_OMISION)))
  const tipo: TipoRankBsr = params.tipo === 'categoria' ? 'categoria' : 'grupo'

  const { data: conexiones, error: errorConexion } = await service
    .from('amazon_connections')
    .select('id, client_id, name, selling_partner_id, marketplace_ids')
    .eq('id', params.connectionId)
    .limit(1)
  if (errorConexion) throw errorConexion

  const conexion = ((conexiones ?? [])[0] ?? null) as {
    id: string
    client_id: string
    name: string
    selling_partner_id: string
    marketplace_ids: string[]
  } | null
  if (!conexion || conexion.client_id !== params.clientId) return null

  const cliente = await clienteDe(params.clientId)

  /* ---------- Cuántas referencias hay y cuántas se siguen ---------- */
  const catalogo = await contar(params.connectionId, params.marketplaceId, false)
  const enSeguimiento = await contar(params.connectionId, params.marketplaceId, true)

  /* ---------- La última medición, sin ventana ---------- */
  const { data: ultimas, error: errorUltima } = await service
    .from('amazon_snapshots_bsr')
    .select('fecha')
    .eq('selling_partner_id', conexion.selling_partner_id)
    .eq('marketplace_id', params.marketplaceId)
    .order('fecha', { ascending: false })
    .limit(1)
  if (errorUltima) throw errorUltima
  const ultimaMedicion = ((ultimas ?? [])[0] as { fecha: string } | undefined)?.fecha ?? null

  /* ---------- Las observaciones de la ventana ---------- */
  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString()
  const { filas: snapshots, truncado: truncadoLectura } = await leerSnapshots({
    sellingPartnerId: conexion.selling_partner_id,
    marketplaceId: params.marketplaceId,
    tipo,
    desde,
  })

  /* ---------- Una serie por (SKU × categoría) ---------- */
  const series = agruparEnSeries(snapshots)
  const truncadoSeries = series.length > MAX_FILAS
  // Las más recientes primero: si hay que cortar, se corta lo que lleva más
  // tiempo sin medirse, que es de lo que menos se puede decir hoy.
  series.sort((a, b) => (a.ultimoAt < b.ultimoAt ? 1 : a.ultimoAt > b.ultimoAt ? -1 : 0))
  const recortadas = series.slice(0, MAX_FILAS)

  /* ---------- Ponerles nombre ---------- */
  /**
   * Se leen los listings de TODAS las referencias medidas, no solo las de las
   * series que se van a pintar. Con las de la tabla bastaría para poner los
   * nombres, pero entonces el contador «con ranking» valdría 300 en cuanto
   * hubiera más de 300 series y «sin ranking» diría de más — justo la cifra que
   * esta pantalla existe para decir bien.
   */
  const skus = [...new Set(snapshots.map((s) => s.sku))]
  const truncadoNombres = skus.length > MAX_SKUS_NOMBRADOS
  const listings = await leerListings(
    params.connectionId,
    params.marketplaceId,
    skus.slice(0, MAX_SKUS_NOMBRADOS)
  )
  const porSku = new Map(listings.map((l) => [l.sku, l]))

  const filas: FilaBsr[] = recortadas.map((serie) => {
    const listing = porSku.get(serie.sku) ?? null
    return {
      sku: serie.sku,
      asin: listing?.asin ?? serie.asin,
      title: listing?.title ?? null,
      marca: listing?.marca ?? null,
      esMarcaPropia: listing?.es_marca_propia ?? false,
      enSeguimiento: listing ? (listing.activo_manual ?? listing.activo_calculado) : false,
      categoria: serie.categoria,
      categoriaId: serie.categoriaId,
      ultimo: serie.ultimo,
      ultimoAt: serie.ultimoAt,
      primero: serie.primero,
      primeroAt: serie.primeroAt,
      delta: serie.puntos.length > 1 ? serie.ultimo - serie.primero : null,
      mejor: serie.mejor,
      peor: serie.peor,
      observaciones: serie.observaciones,
      puntos: serie.puntos,
    }
  })

  /* ---------- De qué NO tenemos ranking, y por qué ---------- */
  // Sobre TODAS las referencias medidas, no solo las que caben en la tabla.
  const conRankingYSeguidas = new Set(
    [...porSku.values()]
      .filter((l) => (l.activo_manual ?? l.activo_calculado) === true)
      .map((l) => l.sku)
  )
  const seguidas = await leerSeguidas(params.connectionId, params.marketplaceId)
  const sinRankingMuestra: SinRanking[] = seguidas
    .filter((l) => !conRankingYSeguidas.has(l.sku))
    .slice(0, MAX_SIN_RANKING)
    .map((l) => ({
      sku: l.sku,
      title: l.title,
      esMarcaPropia: l.es_marca_propia,
      motivo: porQueSinBsr({
        modelo: cliente.modelo,
        politica: cliente.politica,
        esMarcaPropia: l.es_marca_propia,
      }),
    }))

  const conRanking = conRankingYSeguidas.size

  return {
    cliente: {
      id: cliente.id,
      name: cliente.name,
      modelo: cliente.modelo,
      politica: cliente.politica,
    },
    connectionId: conexion.id,
    connectionName: conexion.name,
    marketplaceId: params.marketplaceId,
    dias,
    tipo,
    cadencia: cadenciaBsr({
      modelo: cliente.modelo,
      politica: cliente.politica,
      // En «mix» la respuesta no existe a nivel de cliente: se resuelve
      // referencia a referencia, así que aquí se deja pasar y cada fila lo dice.
      esMarcaPropia: cliente.modelo === 'mix',
    }),
    porQueNoADiario: porQueSinBsr({
      modelo: cliente.modelo,
      politica: cliente.politica,
      esMarcaPropia: cliente.modelo === 'mix',
    }),
    totales: {
      catalogo,
      enSeguimiento,
      conRanking,
      // Nunca negativo: las dos cifras se cuentan sobre conjuntos distintos —una
      // en la base y otra en memoria— y un desfase de un segundo entre las dos
      // no puede acabar pintando un «−3 sin ranking».
      sinRanking: Math.max(0, enSeguimiento - conRanking),
      observaciones: snapshots.length,
    },
    ultimaMedicion,
    filas,
    sinRankingMuestra,
    truncado: truncadoLectura || truncadoSeries || truncadoNombres,
    leidoAt: new Date().toISOString(),
  }
}

/* ------------------------------------------------------------------ */
/* Piezas                                                              */
/* ------------------------------------------------------------------ */

/** Cuántas referencias hay en una unidad. `soloSeguidas` aplica el valor
    efectivo COALESCE(activo_manual, activo_calculado), no activo_calculado */
async function contar(
  connectionId: string,
  marketplaceId: string,
  soloSeguidas: boolean
): Promise<number> {
  const service = createServiceClient()
  let consulta = service
    .from('amazon_listings')
    .select('id', { count: 'exact', head: true })
    .eq('connection_id', connectionId)
    .eq('marketplace_id', marketplaceId)
  if (soloSeguidas) {
    consulta = consulta.or('activo_manual.eq.true,and(activo_manual.is.null,activo_calculado.eq.true)')
  }
  const { count, error } = await consulta
  if (error) throw error
  return count ?? 0
}

/**
 * Las observaciones de la ventana, de la más reciente hacia atrás.
 *
 * DE LA MÁS RECIENTE HACIA ATRÁS Y NO AL REVÉS: si hay que cortar por el techo,
 * lo que se pierde es el pasado lejano y no el presente. Con el orden
 * ascendente, un catálogo grande devolvería veinte mil filas de hace tres meses
 * y ni un solo puesto de esta semana.
 */
async function leerSnapshots(params: {
  sellingPartnerId: string
  marketplaceId: string
  tipo: TipoRankBsr
  desde: string
}): Promise<{ filas: FilaSnapshot[]; truncado: boolean }> {
  const service = createServiceClient()
  const filas: FilaSnapshot[] = []

  for (let inicio = 0; inicio < MAX_OBSERVACIONES; inicio += PAGE) {
    const { data, error } = await service
      .from('amazon_snapshots_bsr')
      .select('sku, asin, fecha, categoria, categoria_id, rank')
      .eq('selling_partner_id', params.sellingPartnerId)
      .eq('marketplace_id', params.marketplaceId)
      .eq('tipo', params.tipo)
      .gte('fecha', params.desde)
      // El orden termina en columna única (id): sin eso, .range() sobre filas
      // con la misma fecha repite unas y se salta otras entre páginas.
      .order('fecha', { ascending: false })
      .order('id', { ascending: false })
      .range(inicio, inicio + PAGE - 1)
    if (error) throw error

    const tramo = (data ?? []) as unknown as FilaSnapshot[]
    filas.push(...tramo)
    if (tramo.length < PAGE) return { filas, truncado: false }
  }

  return { filas, truncado: true }
}

interface SerieCruda {
  sku: string
  asin: string | null
  categoria: string
  categoriaId: string | null
  puntos: PuntoBsr[]
  ultimo: number
  ultimoAt: string
  primero: number
  primeroAt: string
  mejor: number
  peor: number
  observaciones: number
}

/**
 * De filas sueltas a series, con UNA OBSERVACIÓN POR DÍA.
 *
 * Se queda la ÚLTIMA lectura de cada día y no la media ni la mejor: un puesto es
 * una foto de un instante, y promediar dos fotos del mismo día inventa un número
 * que Amazon nunca dio. Los días sin observación no aparecen; el hueco lo abre la
 * pantalla al dibujar.
 *
 * Las filas llegan de la más reciente a la más antigua, así que la primera vez
 * que se ve un día es su última lectura.
 */
function agruparEnSeries(filas: FilaSnapshot[]): SerieCruda[] {
  const porSerie = new Map<string, SerieCruda>()
  /** clave de serie -> días ya vistos */
  const diasVistos = new Map<string, Set<string>>()

  for (const fila of filas) {
    const claveCategoria = fila.categoria_id ?? fila.categoria
    const clave = `${fila.sku}\x00${claveCategoria}`
    const dia = fila.fecha.slice(0, 10)

    let serie = porSerie.get(clave)
    if (!serie) {
      serie = {
        sku: fila.sku,
        asin: fila.asin,
        categoria: fila.categoria,
        categoriaId: fila.categoria_id,
        puntos: [],
        ultimo: fila.rank,
        ultimoAt: fila.fecha,
        primero: fila.rank,
        primeroAt: fila.fecha,
        mejor: fila.rank,
        peor: fila.rank,
        observaciones: 0,
      }
      porSerie.set(clave, serie)
      diasVistos.set(clave, new Set())
    }

    serie.observaciones += 1
    // Mejor es el número MÁS BAJO. Es el error que más veces se cuela.
    if (fila.rank < serie.mejor) serie.mejor = fila.rank
    if (fila.rank > serie.peor) serie.peor = fila.rank
    // Vienen en orden descendente, así que la última que llega es la más
    // antigua de la ventana.
    serie.primero = fila.rank
    serie.primeroAt = fila.fecha

    const vistos = diasVistos.get(clave)!
    if (vistos.has(dia)) continue
    vistos.add(dia)
    serie.puntos.push({ dia, rank: fila.rank })
  }

  // Los puntos se han ido metiendo de más nuevo a más viejo: se les da la vuelta
  // para que la gráfica se lea de izquierda a derecha.
  for (const serie of porSerie.values()) serie.puntos.reverse()

  return [...porSerie.values()]
}

async function leerListings(
  connectionId: string,
  marketplaceId: string,
  skus: string[]
): Promise<FilaListing[]> {
  if (skus.length === 0) return []
  const service = createServiceClient()
  const salida: FilaListing[] = []

  for (let i = 0; i < skus.length; i += CHUNK_SKUS) {
    const tramo = skus.slice(i, i + CHUNK_SKUS)
    const { data, error } = await service
      .from('amazon_listings')
      .select(LISTING_FIELDS)
      .eq('connection_id', connectionId)
      .eq('marketplace_id', marketplaceId)
      .in('sku', tramo)
    if (error) throw error
    salida.push(...((data ?? []) as unknown as FilaListing[]))
  }

  return salida
}

/**
 * Una muestra de las referencias que HOY están en el refresco diario.
 *
 * Es una MUESTRA y no el conjunto: en un catálogo grande son miles, y la
 * pregunta que contesta esta lista —«¿por qué esta no tiene ranking?»— se
 * responde igual con veinte. El número exacto sale del contador, que se cuenta
 * en la base.
 */
async function leerSeguidas(
  connectionId: string,
  marketplaceId: string
): Promise<FilaListing[]> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('amazon_listings')
    .select(LISTING_FIELDS)
    .eq('connection_id', connectionId)
    .eq('marketplace_id', marketplaceId)
    .or('activo_manual.eq.true,and(activo_manual.is.null,activo_calculado.eq.true)')
    .order('sku', { ascending: true })
    .limit(MAX_SIN_RANKING + MAX_FILAS)
  if (error) throw error
  return (data ?? []) as unknown as FilaListing[]
}
