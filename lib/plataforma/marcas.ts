/**
 * LAS MARCAS PROPIAS DEL CLIENTE.
 *
 * Un cliente MIXTO revende marcas de terceros y además tiene la suya. Aquí se
 * elige cuáles son suyas, y con eso queda clasificado su catálogo entero.
 *
 * Se marca POR MARCA y no por referencia porque es lo único que se puede
 * mantener: un cliente con 5.000 SKU no va a marcar 5.000 casillas, pero
 * marcas propias tiene dos o tres.
 *
 * De qué sirve estar marcado:
 *   - El BSR se mide a diario (ver modelo-negocio.ts). En un producto ajeno el
 *     ranking mide EL PRODUCTO, no la cuenta del cliente.
 *   - Es sobre esos productos sobre los que se hace marketing.
 *
 * LA LISTA MANDA, EL BOOLEANO ES EL RESULTADO. `amazon_listings.es_marca_propia`
 * se recalcula desde `amazon_marcas_propias`, nunca al revés. Es lo que hace que
 * las referencias que llegan en el censo de la semana que viene entren ya
 * clasificadas en vez de quedarse fuera sin que nadie se entere.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { fetchAll } from './datos'

/**
 * QUÉ HAY QUE LANZAR CUANDO LA BASE TODAVÍA NO TIENE ESTO.
 *
 * Comprobado contra la base de hoy: `amazon_marcas_propias` no existe y
 * `amazon_listings.marca_propia_origen` tampoco, así que esta pantalla entera
 * responde 503 hasta que se pegue el fichero. El mensaje genérico de
 * pantallas.ts nombra la 123 y la 125, que aquí NO son las que faltan: mandar a
 * alguien a lanzar el fichero equivocado es peor que no decirle nada.
 */
export const FALTA_MIGRACION_MARCAS =
  'Falta la tabla de marcas propias: lanza 126_marcas_propias.sql en el editor SQL de Supabase. ' +
  'Si tampoco están las tablas de la plataforma, lanza antes 123_plataforma_a1.sql.'

/**
 * La marca comparable.
 *
 * Amazon devuelve la marca tal y como la escribió quien creó el listing, así
 * que «Pikolinos», «PIKOLINOS» y «Pikolinos » conviven en el mismo catálogo.
 * Sin esto, marcar una dejaría las otras dos fuera y el cliente vería la mitad
 * de sus productos sin clasificar sin entender por qué.
 *
 * Se quitan los acentos porque también bailan («Martínez» / «Martinez») y no
 * distinguen dos marcas de verdad en ningún catálogo real.
 */
export function normalizarMarca(marca: string): string {
  return marca
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

export interface MarcaDelCatalogo {
  /** Como se ve. Si hay varias grafías, la más frecuente */
  marca: string
  marcaNorm: string
  /** Cuántas referencias suyas hay en el catálogo del cliente */
  skus: number
  /** Cuántas están hoy a la venta */
  activos: number
  /** Si ya está marcada como suya */
  esPropia: boolean
  /**
   * Referencias de esta marca con el valor puesto A MANO, que el recálculo no
   * toca. Se enseña porque explica por qué una marca marcada como propia puede
   * tener referencias que no lo son (y al revés).
   */
  manuales: number
  /**
   * ¿Sigue apareciendo en el catálogo?
   *
   * `false` es una marca que está GUARDADA como propia pero de la que hoy no
   * queda ni una referencia. Se devuelve igual, y no es un adorno: la pantalla
   * construye sus casillas con esta lista y manda la lista entera al guardar, así
   * que una marca que no viniera aquí se borraría sola en el siguiente guardado
   * sin que nadie lo pidiera. Con `skus: 0` no se dice «tiene cero referencias»:
   * se dice que no está en el catálogo, que es otra cosa.
   */
  enCatalogo: boolean
}

/** Todo lo que hace falta para pintar la pestaña de marcas de un cliente */
export interface ResumenMarcas {
  marcas: MarcaDelCatalogo[]
  /** Referencias sin marca ninguna. Las rellena el barrido semanal */
  sinMarca: number
  /**
   * Referencias del catálogo del cliente.
   *
   * Es lo que separa dos pantallas vacías que no significan lo mismo: con
   * `total` a 0 el catálogo todavía no se ha censado, y con `total` alto y
   * `sinMarca` igual de alto el censo está pero el enriquecido no ha pasado.
   */
  total: number
  /** Referencias hoy clasificadas como marca propia */
  propias: number
  /** Referencias con el valor puesto a mano en TODO el catálogo */
  manuales: number
  /** Cuántas conexiones tiene el cliente. 0 = no hay nada que mirar todavía */
  conexiones: number
  /** Hay al menos una marca en el catálogo: el enriquecido ya ha pasado */
  enriquecido: boolean
}

interface FilaListing {
  marca: string | null
  es_marca_propia: boolean
  marca_propia_origen: string | null
  listing_status: string[] | null
}

/**
 * ¿El listing está a la venta?
 *
 * BUYABLE es lo que importa; DISCOVERABLE es «se ve pero no se compra». La
 * definición canónica es `estaALaVenta()` de activos.ts, que no está exportada;
 * se repite aquí —una línea— en vez de tocar ese fichero, que ahora mismo lo
 * está editando otra pantalla.
 *
 * La columna es `listing_status` Y ES UN ARRAY. Este fichero pedía una columna
 * `estado` que NO EXISTE en amazon_listings: comprobado contra la base, la
 * consulta entera moría con «column amazon_listings.estado does not exist», así
 * que la lista de marcas no habría llegado a pintarse nunca.
 */
function aLaVenta(listingStatus: string[] | null): boolean {
  return (listingStatus ?? []).some((s) => s.toUpperCase() === 'BUYABLE')
}

/**
 * Las marcas que hay en el catálogo de un cliente, con cuánto pesa cada una.
 *
 * Ordenadas por número de referencias: la marca propia de un revendedor suele
 * ser pequeña al lado de las que distribuye, pero la que más pesa es la que
 * primero hay que descartar, así que arriba se pone lo que más ocupa.
 *
 * Devuelve vacío si el catálogo todavía no está enriquecido — la marca la
 * rellena Catalog Items en el barrido SEMANAL. Eso no es un fallo y quien lo
 * pinte tiene que decirlo, no enseñar una lista vacía que parece una avería.
 */
export async function marcasDeCliente(clientId: string): Promise<ResumenMarcas> {
  const service = createServiceClient()

  const { data: conexiones, error: errorConn } = await service
    .from('amazon_connections')
    .select('id')
    .eq('client_id', clientId)
  if (errorConn) throw errorConn

  const ids = (conexiones ?? []).map((c: { id: string }) => c.id)
  if (ids.length === 0) {
    return {
      marcas: [],
      sinMarca: 0,
      total: 0,
      propias: 0,
      manuales: 0,
      conexiones: 0,
      enriquecido: false,
    }
  }

  const filas = await fetchAll<FilaListing>((desde, hasta) =>
    service
      .from('amazon_listings')
      .select('marca, es_marca_propia, marca_propia_origen, listing_status')
      .in('connection_id', ids)
      .order('id', { ascending: true })
      .range(desde, hasta)
  )

  const listaPropias = await marcasPropiasDe(clientId)
  const marcadas = new Set(listaPropias.map((m) => m.marcaNorm))

  // Agrupado por marca normalizada, guardando la grafía más frecuente: es la
  // que el cliente reconoce cuando la ve en la lista.
  const grupos = new Map<
    string,
    { grafias: Map<string, number>; skus: number; activos: number; manuales: number }
  >()
  let sinMarca = 0
  let refsPropias = 0
  let manuales = 0

  for (const fila of filas) {
    if (fila.es_marca_propia) refsPropias += 1
    if (fila.marca_propia_origen === 'manual') manuales += 1

    const cruda = (fila.marca ?? '').trim()
    if (cruda === '') {
      sinMarca += 1
      continue
    }
    const norm = normalizarMarca(cruda)
    let grupo = grupos.get(norm)
    if (!grupo) {
      grupo = { grafias: new Map(), skus: 0, activos: 0, manuales: 0 }
      grupos.set(norm, grupo)
    }
    grupo.grafias.set(cruda, (grupo.grafias.get(cruda) ?? 0) + 1)
    grupo.skus += 1
    if (aLaVenta(fila.listing_status)) grupo.activos += 1
    if (fila.marca_propia_origen === 'manual') grupo.manuales += 1
  }

  const delCatalogo: MarcaDelCatalogo[] = [...grupos.entries()]
    .map(([norm, g]) => ({
      marca: [...g.grafias.entries()].sort((a, b) => b[1] - a[1])[0][0],
      marcaNorm: norm,
      skus: g.skus,
      activos: g.activos,
      manuales: g.manuales,
      esPropia: marcadas.has(norm),
      enCatalogo: true,
    }))
    .sort((a, b) => b.skus - a.skus || a.marca.localeCompare(b.marca, 'es'))

  // El enriquecido se decide con lo que hay EN EL CATÁLOGO, antes de añadir las
  // guardadas que ya no están: si no, una marca propia de un catálogo que
  // todavía no se ha enriquecido haría creer que sí lo está.
  const enriquecido = delCatalogo.length > 0

  // Las que están guardadas como propias y ya no aparecen en ninguna referencia.
  // Van al final y con `enCatalogo: false`, nunca fuera de la lista: la pantalla
  // manda la lista entera al guardar y omitirlas aquí las borraría solas.
  const vistas = new Set(delCatalogo.map((m) => m.marcaNorm))
  const huerfanas: MarcaDelCatalogo[] = listaPropias
    .filter((m) => !vistas.has(m.marcaNorm))
    .map((m) => ({
      marca: m.marca,
      marcaNorm: m.marcaNorm,
      skus: 0,
      activos: 0,
      manuales: 0,
      esPropia: true,
      enCatalogo: false,
    }))
    .sort((a, b) => a.marca.localeCompare(b.marca, 'es'))

  return {
    marcas: [...delCatalogo, ...huerfanas],
    sinMarca,
    total: filas.length,
    propias: refsPropias,
    manuales,
    conexiones: ids.length,
    enriquecido,
  }
}

export interface MarcaPropia {
  marca: string
  marcaNorm: string
}

export async function marcasPropiasDe(clientId: string): Promise<MarcaPropia[]> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('amazon_marcas_propias')
    .select('marca, marca_norm')
    .eq('client_id', clientId)
    .order('marca', { ascending: true })
  if (error) throw error
  return (data ?? []).map((f: { marca: string; marca_norm: string }) => ({
    marca: f.marca,
    marcaNorm: f.marca_norm,
  }))
}

/**
 * Guarda la lista de marcas propias y deja el catálogo clasificado.
 *
 * Las dos cosas van juntas a propósito: guardar la lista sin recalcular dejaría
 * la pantalla diciendo una cosa y los datos otra hasta el siguiente barrido, y
 * en ese hueco el BSR se mediría mal.
 */
export async function guardarMarcasPropias(params: {
  clientId: string
  marcas: string[]
  userId: string | null
}): Promise<{ marcas: number; listingsTocados: number }> {
  const service = createServiceClient()

  // Se normaliza y se quitan repetidas: la pantalla manda lo que ve el usuario,
  // y «Pikolinos» y «PIKOLINOS» son la misma para nosotros.
  const porNorm = new Map<string, string>()
  for (const cruda of params.marcas) {
    const marca = cruda.trim()
    if (marca === '') continue
    const norm = normalizarMarca(marca)
    if (norm !== '' && !porNorm.has(norm)) porNorm.set(norm, marca)
  }

  const { error: errorBorrado } = await service
    .from('amazon_marcas_propias')
    .delete()
    .eq('client_id', params.clientId)
  if (errorBorrado) throw errorBorrado

  if (porNorm.size > 0) {
    const { error } = await service.from('amazon_marcas_propias').insert(
      [...porNorm.entries()].map(([marcaNorm, marca]) => ({
        client_id: params.clientId,
        marca,
        marca_norm: marcaNorm,
        created_by: params.userId,
      }))
    )
    if (error) throw error
  }

  const listingsTocados = await recalcularMarcaPropia(params.clientId)
  return { marcas: porNorm.size, listingsTocados }
}

/**
 * Vuelve a clasificar el catálogo del cliente a partir de su lista de marcas.
 *
 * NO TOCA LAS FILAS CON ORIGEN 'manual'. Son las excepciones que ha puesto una
 * persona —una marca del cliente con cuatro referencias que en realidad
 * revende, o un producto suyo listado bajo la marca del fabricante— y pisarlas
 * en cada barrido haría que ese trabajo no durase ni una semana.
 *
 * Se llama al guardar la lista y también desde el refresco diario, que es lo
 * que recoge las referencias nuevas que trajo el censo.
 */
export async function recalcularMarcaPropia(clientId: string): Promise<number> {
  const service = createServiceClient()

  const { data: conexiones, error: errorConn } = await service
    .from('amazon_connections')
    .select('id')
    .eq('client_id', clientId)
  if (errorConn) throw errorConn
  const ids = (conexiones ?? []).map((c: { id: string }) => c.id)
  if (ids.length === 0) return 0

  const propias = await marcasPropiasDe(clientId)
  const marcadas = new Set(propias.map((m) => m.marcaNorm))

  const filas = await fetchAll<{ id: string; marca: string | null; es_marca_propia: boolean }>(
    (desde, hasta) =>
      service
        .from('amazon_listings')
        .select('id, marca, es_marca_propia')
        .in('connection_id', ids)
        // Las de origen 'manual' quedan fuera del recálculo. `is('...', null)`
        // aparte porque en PostgREST un `neq` NO devuelve las filas a NULL, y
        // las que nunca se han clasificado son justo esas.
        .or('marca_propia_origen.is.null,marca_propia_origen.eq.marca')
        .order('id', { ascending: true })
        .range(desde, hasta)
  )

  const aEncender: string[] = []
  const aApagar: string[] = []
  for (const fila of filas) {
    const deberia = marcadas.has(normalizarMarca(fila.marca ?? ''))
    if (deberia && !fila.es_marca_propia) aEncender.push(fila.id)
    if (!deberia && fila.es_marca_propia) aApagar.push(fila.id)
  }

  // En lotes: con 30.000 referencias, un `in` con todos los ids revienta el
  // límite de longitud de la URL de PostgREST mucho antes de llegar al final.
  const LOTE = 500
  for (const [ids_, valor] of [
    [aEncender, true],
    [aApagar, false],
  ] as Array<[string[], boolean]>) {
    for (let i = 0; i < ids_.length; i += LOTE) {
      const { error } = await service
        .from('amazon_listings')
        .update({ es_marca_propia: valor, marca_propia_origen: 'marca' })
        .in('id', ids_.slice(i, i + LOTE))
      if (error) throw error
    }
  }

  return aEncender.length + aApagar.length
}

/**
 * El valor de UNA referencia, puesto a mano.
 *
 * Queda con origen 'manual' y a partir de ahí el recálculo la respeta. Es la
 * válvula de escape para las excepciones que ninguna regla por marca cubre.
 *
 * `esMarcaPropia: null` DEVUELVE LA REFERENCIA A LA REGLA. Sin esa tercera
 * opción, marcar una a mano sería un viaje de ida: la fila quedaría con origen
 * 'manual' para siempre y ningún recálculo volvería a tocarla, ni siquiera
 * cuando la marca entera pasara a ser propia. Es la misma decisión ternaria que
 * ya toma `activo_manual` en la pestaña de seguimiento.
 *
 * PIDE EL CLIENTE ADEMÁS DE LA REFERENCIA, y no es una formalidad: es lo que
 * impide que un identificador equivocado escriba sobre el catálogo de otro
 * vendedor. Devuelve `null` si esa referencia no es de ese cliente.
 */
export async function marcarListingAMano(params: {
  clientId: string
  listingId: string
  esMarcaPropia: boolean | null
}): Promise<{ esMarcaPropia: boolean; origen: 'manual' | null; marca: string | null } | null> {
  const service = createServiceClient()

  const { data: conexiones, error: errorConn } = await service
    .from('amazon_connections')
    .select('id')
    .eq('client_id', params.clientId)
  if (errorConn) throw errorConn
  const ids = (conexiones ?? []).map((c: { id: string }) => c.id)
  if (ids.length === 0) return null

  const { data: fila, error: errorFila } = await service
    .from('amazon_listings')
    .select('id, marca')
    .eq('id', params.listingId)
    .in('connection_id', ids)
    .maybeSingle()
  if (errorFila) throw errorFila
  if (!fila) return null

  const marca = (fila as { marca: string | null }).marca

  // Al volver a la regla no se deja el valor anterior congelado: se recalcula
  // AHORA desde la lista de marcas. Dejarlo como estaba haría que la referencia
  // dijera lo contrario que su marca hasta el siguiente barrido.
  let valor: boolean
  let origen: 'manual' | null
  if (params.esMarcaPropia === null) {
    const propias = await marcasPropiasDe(params.clientId)
    const marcadas = new Set(propias.map((m) => m.marcaNorm))
    valor = marcadas.has(normalizarMarca(marca ?? ''))
    origen = null
  } else {
    valor = params.esMarcaPropia
    origen = 'manual'
  }

  const { error } = await service
    .from('amazon_listings')
    .update({ es_marca_propia: valor, marca_propia_origen: origen })
    .eq('id', params.listingId)
  if (error) throw error

  return { esMarcaPropia: valor, origen, marca }
}

/* ------------------------------------------------------------------ */
/* La excepción: buscar UNA referencia suelta                          */
/* ------------------------------------------------------------------ */

export interface ReferenciaMarca {
  id: string
  sku: string
  asin: string | null
  title: string | null
  /** null = el enriquecido todavía no le ha puesto marca. NO es «sin marca» */
  marca: string | null
  esMarcaPropia: boolean
  /** 'marca' lo decidió la lista · 'manual' una persona · null nunca se clasificó */
  origen: 'marca' | 'manual' | null
  /** BUYABLE. Un listing que no está a la venta se decide igual, pero corre menos prisa */
  aLaVenta: boolean
}

/** Qué referencias quiere ver quien busca una excepción */
export type FiltroReferencias = 'todas' | 'manuales' | 'sin_marca' | 'propias'

/**
 * Busca referencias del cliente para marcarlas de una en una.
 *
 * CON TOPE Y DICIENDO SI HAY MÁS. Un catálogo de 13.700 referencias no cabe en
 * una pantalla y traerlo entero para que alguien cambie una es la forma más cara
 * de resolver una excepción. Si el tope se llena, quien busca tiene que saberlo:
 * una lista recortada que se presenta como completa hace creer que la referencia
 * que falta no existe.
 */
export async function buscarReferencias(params: {
  clientId: string
  q?: string | null
  filtro?: FiltroReferencias
  limite?: number
}): Promise<{ filas: ReferenciaMarca[]; hayMas: boolean; limite: number }> {
  const service = createServiceClient()
  const limite = Math.min(200, Math.max(1, params.limite ?? 50))

  const { data: conexiones, error: errorConn } = await service
    .from('amazon_connections')
    .select('id')
    .eq('client_id', params.clientId)
  if (errorConn) throw errorConn
  const ids = (conexiones ?? []).map((c: { id: string }) => c.id)
  if (ids.length === 0) return { filas: [], hayMas: false, limite }

  let consulta = service
    .from('amazon_listings')
    .select('id, sku, asin, title, marca, es_marca_propia, marca_propia_origen, listing_status')
    .in('connection_id', ids)

  const q = (params.q ?? '').trim()
  if (q !== '') {
    // Las comas y los paréntesis son los separadores de la sintaxis de filtros de
    // PostgREST: un SKU con una coma dentro partiría la consulta en dos
    // condiciones sin dar ningún error. Mismo tratamiento que en pantallas.ts.
    const patron = `*${q.replace(/[(),]/g, ' ')}*`
    consulta = consulta.or(
      `sku.ilike.${patron},asin.ilike.${patron},title.ilike.${patron},marca.ilike.${patron}`
    )
  }

  switch (params.filtro ?? 'todas') {
    case 'manuales':
      consulta = consulta.eq('marca_propia_origen', 'manual')
      break
    case 'sin_marca':
      // `is null` y no «vacío»: el enriquecido escribe la marca solo cuando la
      // trae, así que la ausencia siempre es NULL y nunca la cadena vacía.
      consulta = consulta.is('marca', null)
      break
    case 'propias':
      consulta = consulta.eq('es_marca_propia', true)
      break
    case 'todas':
      break
  }

  // Se pide UNA de más para saber si hay más sin tener que contar la tabla
  // entera, que en un catálogo grande cuesta más que la propia consulta.
  const { data, error } = await consulta
    .order('sku', { ascending: true })
    .order('id', { ascending: true })
    .limit(limite + 1)
  if (error) throw error

  const crudas = (data ?? []) as Array<{
    id: string
    sku: string
    asin: string | null
    title: string | null
    marca: string | null
    es_marca_propia: boolean
    marca_propia_origen: string | null
    listing_status: string[] | null
  }>

  const hayMas = crudas.length > limite
  const filas: ReferenciaMarca[] = crudas.slice(0, limite).map((f) => ({
    id: f.id,
    sku: f.sku,
    asin: f.asin,
    title: f.title,
    marca: f.marca,
    esMarcaPropia: f.es_marca_propia,
    origen:
      f.marca_propia_origen === 'manual' || f.marca_propia_origen === 'marca'
        ? f.marca_propia_origen
        : null,
    aLaVenta: aLaVenta(f.listing_status),
  }))

  return { filas, hayMas, limite }
}

/* ------------------------------------------------------------------ */
/* Por qué la lista puede estar vacía                                  */
/* ------------------------------------------------------------------ */

/**
 * El estado de un trabajo, contado en lo justo para explicar una lista vacía.
 * `null` = nunca se ha lanzado ese trabajo para este cliente.
 */
export interface UltimoBarrido {
  estado: string
  creadoAt: string
  terminadoAt: string | null
  error: string | null
}

/**
 * QUÉ CONTESTAR CUANDO NO HAY NI UNA MARCA.
 *
 * La marca no la trae el censo: la rellena el enriquecido de catálogo, que corre
 * UNA VEZ POR SEMANA. Con un cliente recién conectado esta pantalla está vacía
 * durante días y eso no es una avería, pero decir «no hay marcas» y callarse es
 * indistinguible de que algo se haya roto.
 *
 * Se devuelven los dos trabajos porque la respuesta correcta es distinta:
 *   · sin censo      -> todavía no sabemos ni qué referencias tiene
 *   · censo pero sin enriquecido -> las referencias están, la marca no ha llegado
 *   · los dos hechos y sin marcas -> Amazon no da marca para ese catálogo
 */
export async function estadoDelEnriquecido(clientId: string): Promise<{
  censo: UltimoBarrido | null
  enriquecido: UltimoBarrido | null
}> {
  const service = createServiceClient()

  async function ultimo(tipo: string): Promise<UltimoBarrido | null> {
    const { data, error } = await service
      .from('amazon_jobs')
      .select('estado, created_at, terminado_at, error_message')
      .eq('client_id', clientId)
      .eq('tipo', tipo)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    if (!data) return null
    const fila = data as {
      estado: string
      created_at: string
      terminado_at: string | null
      error_message: string | null
    }
    return {
      estado: fila.estado,
      creadoAt: fila.created_at,
      terminadoAt: fila.terminado_at,
      error: fila.error_message,
    }
  }

  const [censo, enriquecido] = await Promise.all([
    ultimo('censo_catalogo'),
    ultimo('enriquecer_catalogo'),
  ])
  return { censo, enriquecido }
}
