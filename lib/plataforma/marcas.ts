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
}

interface FilaListing {
  marca: string | null
  es_marca_propia: boolean
  marca_propia_origen: string | null
  estado: string | null
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
export async function marcasDeCliente(clientId: string): Promise<{
  marcas: MarcaDelCatalogo[]
  sinMarca: number
  enriquecido: boolean
}> {
  const service = createServiceClient()

  const { data: conexiones, error: errorConn } = await service
    .from('amazon_connections')
    .select('id')
    .eq('client_id', clientId)
  if (errorConn) throw errorConn

  const ids = (conexiones ?? []).map((c: { id: string }) => c.id)
  if (ids.length === 0) return { marcas: [], sinMarca: 0, enriquecido: false }

  const filas = await fetchAll<FilaListing>((desde, hasta) =>
    service
      .from('amazon_listings')
      .select('marca, es_marca_propia, marca_propia_origen, estado')
      .in('connection_id', ids)
      .order('id', { ascending: true })
      .range(desde, hasta)
  )

  const propias = await marcasPropiasDe(clientId)
  const marcadas = new Set(propias.map((m) => m.marcaNorm))

  // Agrupado por marca normalizada, guardando la grafía más frecuente: es la
  // que el cliente reconoce cuando la ve en la lista.
  const grupos = new Map<
    string,
    { grafias: Map<string, number>; skus: number; activos: number; manuales: number }
  >()
  let sinMarca = 0

  for (const fila of filas) {
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
    if (fila.estado === 'ACTIVE') grupo.activos += 1
    if (fila.marca_propia_origen === 'manual') grupo.manuales += 1
  }

  const marcas: MarcaDelCatalogo[] = [...grupos.entries()]
    .map(([norm, g]) => ({
      marca: [...g.grafias.entries()].sort((a, b) => b[1] - a[1])[0][0],
      marcaNorm: norm,
      skus: g.skus,
      activos: g.activos,
      manuales: g.manuales,
      esPropia: marcadas.has(norm),
    }))
    .sort((a, b) => b.skus - a.skus || a.marca.localeCompare(b.marca, 'es'))

  return { marcas, sinMarca, enriquecido: marcas.length > 0 }
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
 */
export async function marcarListingAMano(params: {
  listingId: string
  esMarcaPropia: boolean
}): Promise<void> {
  const service = createServiceClient()
  const { error } = await service
    .from('amazon_listings')
    .update({ es_marca_propia: params.esMarcaPropia, marca_propia_origen: 'manual' })
    .eq('id', params.listingId)
  if (error) throw error
}
