/**
 * PLATAFORMA · ACCESO A DATOS
 * ===========================
 * SOLO SERVIDOR: importa el cliente de service_role.
 *
 * Aquí vive todo lo que traduce entre las filas de Postgres y las estructuras
 * puras de activos.ts, ventas.ts y costes.ts. Esos tres ficheros no saben que
 * existe Supabase, y este es el motivo.
 *
 * LO QUE ESTE FICHERO NO HACE, Y ES LA REGLA MÁS IMPORTANTE DEL MÓDULO DE
 * AMAZON: no lee `amazon_connections.refresh_token_enc`. Ese es EL ÚNICO
 * fichero que puede hacerlo (lib/amazon/data.ts) y aquí se pide una lista de
 * columnas EXPLÍCITA, sin `*`, para que un cambio en la tabla no meta el token
 * en una respuesta por error. Va cifrado, pero un ciphertext que llega al
 * navegador es material que no tenía ninguna razón para salir del servidor.
 */

import { createServiceClient } from '@/lib/supabase/service'
import type { DecisionActivo } from './activos'
import { isMissingSchema } from './eventos'
import type { CosteProducto, ReglaActivos } from './tipos'
import type { FilaVentas } from './ventas'

export { isMissingSchema }

/** Supabase corta cualquier consulta a 1000 filas y un .limit() mayor NO lo salta */
const PAGE = 1000

/**
 * Consulta paginada. Copia deliberada de la de lib/employees/data.ts (la
 * canónica) en vez de importarla, por lo mismo que hacen lib/amazon/data.ts y
 * lib/stock-sync/perfiles.ts: aquel módulo arrastra el cálculo de nóminas entero
 * y este no tiene por qué depender de él para paginar.
 *
 * El orden lo fija quien llama y TIENE QUE TERMINAR SIEMPRE EN UNA COLUMNA
 * ÚNICA: .range() sobre un orden con empates repite filas o se las salta entre
 * tramos, y aquí una fila saltada es un SKU que se queda fuera del seguimiento
 * sin que nadie lo note.
 */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    // No se hace `break`: quedarse a medias devolvería medio catálogo sin dar
    // error visible, y medio catálogo es indistinguible de uno entero.
    if (error) throw error
    const chunk = (data as T[]) ?? []
    out.push(...chunk)
    if (chunk.length < PAGE) break
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Conexiones (SIN TOKEN)                                              */
/* ------------------------------------------------------------------ */

/** Una conexión recortada a lo que necesita la plataforma. Sin token */
export interface ConexionPlataforma {
  id: string
  client_id: string
  name: string
  selling_partner_id: string
  marketplace_ids: string[]
  /**
   * En cuáles de esos mercados se trabaja de verdad. VACÍO = en todos los que
   * el ERP sepa nombrar, que es como se comportaba antes de existir la columna
   * (migración 134).
   *
   * Existe porque `marketplace_ids` es lo que dice AMAZON, y dice de más: en la
   * cuenta piloto devuelve ocho, y cuatro son de sandbox. Además un cliente
   * puede vender en cuatro países y a nosotros interesarnos solo uno.
   */
  marketplaces_activos: string[]
  default_marketplace_id: string | null
  status: string
  is_active: boolean
}

const CONEXION_FIELDS =
  'id, client_id, name, selling_partner_id, marketplace_ids, marketplaces_activos, ' +
  'default_marketplace_id, status, is_active'

/** Las conexiones vivas de un cliente. Las rotas quedan fuera: insistir contra
    una cuenta que nos ha retirado el acceso no la recupera */
export async function conexionesDeCliente(clientId: string): Promise<ConexionPlataforma[]> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('amazon_connections')
    .select(CONEXION_FIELDS)
    .eq('client_id', clientId)
    .eq('is_active', true)
    .eq('status', 'activa')
    .order('name', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as ConexionPlataforma[]
}

/**
 * Las unidades de trabajo de un cliente: una por conexión y marketplace.
 *
 * Es el grano al que se recorre casi todo en esta plataforma, porque es el grano
 * de los datos: el mismo SKU tiene precio, stock y Buy Box distintos en España y
 * en Francia, y el cupo de Amazon se cuenta por vendedor y región.
 */
export interface UnidadDeTrabajo {
  connectionId: string
  sellingPartnerId: string
  marketplaceId: string
}

export function unidadesDe(
  conexiones: ConexionPlataforma[],
  marketplacesPermitidos: string[] = []
): UnidadDeTrabajo[] {
  const filtro = new Set(marketplacesPermitidos)
  const unidades: UnidadDeTrabajo[] = []
  for (const conexion of conexiones) {
    /**
     * LO QUE HA ELEGIDO EL USUARIO MANDA SOBRE LO QUE DICE AMAZON.
     *
     * `marketplace_ids` son todos los que Amazon devuelve como participantes, y
     * devuelve de más: en la cuenta piloto son ocho y cuatro son de sandbox.
     * `marketplaces_activos` es la elección hecha en Amazon API · Cuentas.
     *
     * Vacío = todos, que es como se comportaba antes de la migración 134. Así
     * pegar el fichero no cambia el comportamiento de ninguna conexión que ya
     * estuviera funcionando; solo manda cuando alguien elige.
     */
    const elegidos = new Set(conexion.marketplaces_activos ?? [])
    for (const marketplaceId of conexion.marketplace_ids) {
      if (elegidos.size > 0 && !elegidos.has(marketplaceId)) continue
      if (filtro.size > 0 && !filtro.has(marketplaceId)) continue
      unidades.push({
        connectionId: conexion.id,
        sellingPartnerId: conexion.selling_partner_id,
        marketplaceId,
      })
    }
  }
  // Orden estable: el cursor de un trabajo es una posición dentro de esta lista,
  // así que tiene que dar lo mismo en todas las pasadas.
  unidades.sort((a, b) =>
    a.connectionId === b.connectionId
      ? a.marketplaceId.localeCompare(b.marketplaceId)
      : a.connectionId.localeCompare(b.connectionId)
  )
  return unidades
}

/**
 * ¿SE TRABAJA EN ESTE MERCADO DE ESTA CUENTA?
 *
 * Existe porque media plataforma NO pasa por `unidadesDe()`: las pantallas
 * grandes —el resumen de Buy Box, el de FBM→FBA, la cobertura— se resuelven con
 * funciones SQL que expanden cuenta × mercado dentro de Postgres. Filtrarlas
 * allí obligaría a otra migración; filtrarlas aquí vale igual y entra hoy.
 *
 * Sin esto pasaba lo que se vio en pantalla: un cliente con España elegida y los
 * otros diez países tachados en Amazon API seguía ofreciendo Francia en el
 * desplegable de Buy Box. La elección se respetaba al ENCOLAR trabajos pero no
 * al MIRAR datos, que es donde el usuario la había hecho.
 *
 * Vacío = todos, igual que en unidadesDe(). Ver la migración 134.
 */
export function filtroMercadosActivos(
  conexiones: ConexionPlataforma[]
): (connectionId: string, marketplaceId: string) => boolean {
  const porConexion = new Map<string, Set<string>>()
  for (const c of conexiones) {
    const elegidos = c.marketplaces_activos ?? []
    if (elegidos.length > 0) porConexion.set(c.id, new Set(elegidos))
  }

  return (connectionId, marketplaceId) => {
    const elegidos = porConexion.get(connectionId)
    // Sin elección hecha para esa conexión, pasa todo: es lo que había antes.
    if (!elegidos) return true
    return elegidos.has(marketplaceId)
  }
}

export function claveUnidad(unidad: UnidadDeTrabajo): string {
  return `${unidad.connectionId}|${unidad.marketplaceId}`
}

/* ------------------------------------------------------------------ */
/* El criterio de SKU activo                                           */
/* ------------------------------------------------------------------ */

/**
 * La regla viva de un cliente. null cuando no tiene ninguna.
 *
 * Que sea null NO es un caso normal: la migración 123 siembra una para cada
 * cliente. Si aparece, es que alguien la desactivó sin poner otra, y el trabajo
 * que la consulta tiene que decirlo en voz alta en vez de saltarse ese cliente
 * en silencio.
 */
export async function reglaActivaDe(clientId: string): Promise<ReglaActivos | null> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('amazon_tracking_rules')
    .select('*')
    .eq('client_id', clientId)
    .eq('is_active', true)
    .limit(1)
  if (error) throw error
  return ((data ?? [])[0] as ReglaActivos | undefined) ?? null
}

/* ------------------------------------------------------------------ */
/* Catálogo                                                            */
/* ------------------------------------------------------------------ */

/**
 * Lo que hace falta de un listing para decidir si va en seguimiento.
 *
 * Lista de columnas explícita y corta a propósito: en ShoesF esto son 13.700
 * filas y traerse las treinta columnas de la tabla son varios megas por unidad
 * de trabajo, cada noche, para usar nueve campos.
 */
export interface ListingParaActivos {
  id: string
  sku: string
  marketplace_id: string
  is_fba: boolean
  es_marca_propia: boolean
  clasificacion_item: string | null
  listing_status: string[]
  price: number | null
  marca: string | null
  activo_calculado: boolean
  activo_manual: boolean | null
  activo_motivo: string | null
}

const LISTING_ACTIVOS_FIELDS =
  'id, sku, marketplace_id, is_fba, es_marca_propia, clasificacion_item, listing_status, ' +
  'price, marca, activo_calculado, activo_manual, activo_motivo'

/**
 * El catálogo de una unidad de trabajo.
 *
 * `skusFiltro` es el subconjunto de prueba: cuando viene, solo se miran esos SKU
 * y solo se escriben esos. Es lo que permite probar un criterio nuevo sobre
 * veinte referencias antes de soltarlo sobre trece mil.
 */
export async function listingsDeUnidad(
  unidad: UnidadDeTrabajo,
  skusFiltro: string[] | null
): Promise<ListingParaActivos[]> {
  const service = createServiceClient()
  return fetchAll<ListingParaActivos>((desde, hasta) => {
    let consulta = service
      .from('amazon_listings')
      .select(LISTING_ACTIVOS_FIELDS)
      .eq('connection_id', unidad.connectionId)
      .eq('marketplace_id', unidad.marketplaceId)
    if (skusFiltro && skusFiltro.length > 0) consulta = consulta.in('sku', skusFiltro)
    // El SKU es único dentro de (conexión, marketplace), así que el orden ya
    // termina en columna única y .range() no repite ni se salta filas.
    return consulta.order('sku', { ascending: true }).range(desde, hasta)
  })
}

/* ------------------------------------------------------------------ */
/* Ventas                                                              */
/* ------------------------------------------------------------------ */

const VENTAS_FIELDS = 'sku, marketplace_id, fecha, unidades, sesiones, origen'

/**
 * Las ventas de un cliente en un marketplace desde una fecha.
 *
 * `desde` es 'YYYY-MM-DD' y se compara en la base: convertir a Date aquí haría
 * que la zona horaria del contenedor moviera el corte un día, que en una ventana
 * de treinta días es un 3 % de error silencioso en el filtro de rotación.
 */
export async function ventasDesde(
  clientId: string,
  marketplaceId: string,
  desde: string
): Promise<FilaVentas[]> {
  const service = createServiceClient()
  return fetchAll<FilaVentas>((a, b) =>
    service
      .from('amazon_ventas_externas')
      .select(VENTAS_FIELDS)
      .eq('client_id', clientId)
      .eq('marketplace_id', marketplaceId)
      .gte('fecha', desde)
      .order('fecha', { ascending: true })
      .order('sku', { ascending: true })
      .order('origen', { ascending: true })
      .range(a, b)
  )
}

/* ------------------------------------------------------------------ */
/* Costes                                                              */
/* ------------------------------------------------------------------ */

/**
 * El histórico de costes de un cliente.
 *
 * Se trae entero y se resuelve la vigencia en memoria (costesVigentesPorSku).
 * Son miles de filas, no millones —una por SKU y cambio de tarifa—, y una
 * consulta por SKU serían trece mil viajes para pintar una tabla.
 */
export async function costesDeCliente(
  clientId: string,
  skus?: string[]
): Promise<CosteProducto[]> {
  const service = createServiceClient()
  return fetchAll<CosteProducto>((a, b) => {
    let consulta = service.from('amazon_costes_producto').select('*').eq('client_id', clientId)
    if (skus && skus.length > 0) consulta = consulta.in('sku', skus)
    return consulta
      .order('sku', { ascending: true })
      .order('valido_desde', { ascending: true })
      .order('id', { ascending: true })
      .range(a, b)
  })
}

/* ------------------------------------------------------------------ */
/* Escribir el resultado del criterio                                  */
/* ------------------------------------------------------------------ */

export interface EscrituraActivos {
  /** Filas que había que cambiar */
  cambiadas: number
  /** Las que ya estaban como debían y no se han tocado */
  sinCambio: number
  /** Consultas que ha costado */
  consultas: number
}

/** Cuántos ids caben en un `.in(...)`. Ni uno a uno ni todos juntos: una URL de
    PostgREST con trece mil UUID dentro no la acepta ningún proxy */
const CHUNK_IDS = 400

/**
 * Escribe el resultado del criterio en el catálogo.
 *
 * DOS DECISIONES QUE CONVIERTEN 13.700 ESCRITURAS EN UNAS POCAS DECENAS:
 *
 * 1. SOLO SE ESCRIBE LO QUE CAMBIA. En un catálogo estable, una noche normal
 *    cambian unas pocas filas. La primera ejecución escribe todo; a partir de
 *    ahí, casi nada. Además de ser rápido, deja `updated_at` diciendo la verdad:
 *    la fila que se movió ayer se distingue de las que llevan meses igual.
 *
 * 2. SE AGRUPA POR (activo, motivo). Los motivos se repiten muchísimo —«El
 *    listing no está a la venta en Amazon...» es idéntico para miles de filas—,
 *    así que agrupar por el texto exacto y mandar un UPDATE con `.in('id', ...)`
 *    por grupo convierte trece mil peticiones en unas cuantas.
 *
 * Las decisiones MANUALES no se escriben nunca: son las de la persona, no las de
 * la regla. Consecuencia que conviene saber: mientras `activo_manual` esté
 * puesto, `activo_calculado` de esa fila se queda con el último valor que
 * calculó la regla y no se actualiza. No pasa nada porque el valor efectivo es
 * COALESCE(activo_manual, activo_calculado) y el manual gana; el día que alguien
 * borre la marca manual, la fila vuelve a la regla en el recálculo siguiente.
 */
export async function escribirActivos(
  listings: ListingParaActivos[],
  decisiones: DecisionActivo[],
  ahora: Date
): Promise<EscrituraActivos> {
  const service = createServiceClient()
  const porSku = new Map(listings.map((l) => [l.sku, l]))

  /** '1|motivo' -> ids */
  const grupos = new Map<string, string[]>()
  let sinCambio = 0

  for (const decision of decisiones) {
    if (decision.manual) continue
    const listing = porSku.get(decision.sku)
    if (!listing) continue

    if (listing.activo_calculado === decision.activo && listing.activo_motivo === decision.motivo) {
      sinCambio += 1
      continue
    }

    const clave = `${decision.activo ? '1' : '0'}|${decision.motivo}`
    const ids = grupos.get(clave)
    if (ids) ids.push(listing.id)
    else grupos.set(clave, [listing.id])
  }

  let cambiadas = 0
  let consultas = 0
  const evaluadoAt = ahora.toISOString()

  for (const [clave, ids] of grupos) {
    const separador = clave.indexOf('|')
    const activo = clave.slice(0, separador) === '1'
    const motivo = clave.slice(separador + 1)

    for (let i = 0; i < ids.length; i += CHUNK_IDS) {
      const tramo = ids.slice(i, i + CHUNK_IDS)
      const { error } = await service
        .from('amazon_listings')
        .update({
          activo_calculado: activo,
          activo_motivo: motivo,
          activo_evaluado_at: evaluadoAt,
        })
        .in('id', tramo)
      if (error) throw error
      cambiadas += tramo.length
      consultas += 1
    }
  }

  return { cambiadas, sinCambio, consultas }
}
