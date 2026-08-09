/**
 * PLATAFORMA · A5 — ACCESO A DATOS
 * ================================
 * SOLO SERVIDOR: importa el cliente de service_role.
 *
 * Todo lo que traduce entre las filas de Postgres y las estructuras puras de
 * completitud.ts, cruce.ts y plan.ts. Esos tres no saben que existe Supabase, y
 * este fichero es el motivo.
 *
 * LA REGLA DEL MÓDULO DE AMAZON, QUE AQUÍ TAMBIÉN VALE: no se lee
 * `amazon_connections.refresh_token_enc`. Las columnas se piden por su nombre,
 * nunca con `*`, salvo en las tablas propias de A5, donde no hay ningún secreto.
 *
 * CUMPLIMIENTO: todas las funciones de aquí toman un `clientId` y filtran por él.
 * No hay ninguna que devuelva costes de varios clientes: los costes de compra de
 * un vendedor son de lo más sensible que hay en esta base.
 */

import { createServiceClient } from '@/lib/supabase/service'
import type { CrossMapping } from '@/lib/stock-sync/engine'
import { fetchAll } from '../datos'
import { isMissingSchema } from '../eventos'
import type { FilaCoberturaCostes } from './completitud'
import type { ListingParaCruce } from './cruce'
import type { CosteAEscribir, Correccion } from './plan'
import {
  politicaPorDefecto,
  type AuditoriaCoste,
  type CosteA5,
  type ImportacionCostes,
  type ModoImportacion,
  type PerfilCostes,
  type PoliticaCostes,
} from './tipos'

export { isMissingSchema }

/** Cuántas filas se escriben de una vez. El mismo número que usa el volcado del
    censo: ni una a una ni todas juntas */
const CHUNK_ESCRITURA = 250

/* ------------------------------------------------------------------ */
/* Perfiles                                                            */
/* ------------------------------------------------------------------ */

export async function perfilesDeCliente(clientId: string): Promise<PerfilCostes[]> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('amazon_costes_perfiles')
    .select('*')
    .eq('client_id', clientId)
    .order('position', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw error
  return (data ?? []) as PerfilCostes[]
}

/** Un perfil suelto. null si ya no existe */
export async function perfilDe(id: string): Promise<PerfilCostes | null> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('amazon_costes_perfiles')
    .select('*')
    // maybeSingle() y no single(): un perfil que no existe es un 404 con
    // mensaje, no la excepción de «se esperaba una fila» que acaba en 500.
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as PerfilCostes | null) ?? null
}

/**
 * Columnas que la pantalla puede escribir.
 *
 * LISTA BLANCA Y NO LISTA NEGRA, igual que en los perfiles de stock: el cuerpo
 * de la petición llega del navegador, y sin esto un `id`, un `client_id` o un
 * `last_ok_at` colados en el JSON se escribirían tal cual. Con lista negra, cada
 * columna nueva nace escribible por olvido.
 */
const CAMPOS_EDITABLES = new Set([
  'name',
  'slug',
  'stock_client_id',
  'hoja',
  'hoja_indice',
  'fila_cabecera',
  'fila_datos',
  'csv_separador',
  'csv_codificacion',
  'col_referencia',
  'col_sku',
  'col_ean',
  'col_descripcion',
  'col_coste',
  'col_envio',
  'col_almacen',
  'col_flete',
  'col_moneda',
  'col_valido_desde',
  'moneda',
  'iva_incluido',
  'iva_porcentaje',
  'is_active',
  'position',
  'notes',
])

export function filtrarCamposPerfil(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [clave, valor] of Object.entries(patch)) {
    if (CAMPOS_EDITABLES.has(clave)) out[clave] = valor
  }
  return out
}

/**
 * Valores de fábrica de un perfil nuevo.
 *
 * Los alias NO se dejan vacíos: un perfil recién creado tiene que poder leer un
 * fichero normal a la primera para que el simulacro sirva desde el minuto uno.
 * Estos son los nombres que usan los ERP españoles que ya hemos visto; quien dé
 * de alta un cliente los ajusta con el fichero delante.
 *
 * La DIVISA se queda vacía a propósito y es lo único que hay que rellenar sí o
 * sí: sin ella la importación para. Ver el comentario de la columna en la 126.
 */
export function perfilNuevo(params: {
  clientId: string
  nombre: string
  slug: string
  createdBy: string | null
}): Record<string, unknown> {
  return {
    client_id: params.clientId,
    name: params.nombre,
    slug: params.slug,
    created_by: params.createdBy,
    col_referencia: ['Articulo', 'Cod.Articulo', 'Codigo articulo', 'Referencia'],
    col_sku: ['SKU', 'SKU Amazon', 'Seller SKU'],
    col_ean: ['EAN', 'Codigo de Barras', 'GTIN'],
    col_descripcion: ['Descripcion', 'Descrip.Propia', 'Nombre'],
    col_coste: ['Coste', 'Coste de compra', 'Precio de compra', 'PVP compra', 'Coste medio'],
    col_envio: ['Coste de envio', 'Portes', 'Envio'],
    col_almacen: ['Almacenamiento', 'Storage'],
    col_flete: ['Flete', 'Flete de entrada', 'Transporte entrada'],
    col_moneda: ['Divisa', 'Moneda', 'Currency'],
    col_valido_desde: ['Fecha', 'Valido desde', 'Fecha tarifa'],
  }
}

export async function crearPerfil(fila: Record<string, unknown>): Promise<PerfilCostes> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('amazon_costes_perfiles')
    .insert(fila)
    .select('*')
    .single()
  if (error) throw error
  return data as PerfilCostes
}

export async function actualizarPerfil(
  id: string,
  patch: Record<string, unknown>
): Promise<PerfilCostes | null> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('amazon_costes_perfiles')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle()
  if (error) throw error
  return (data as PerfilCostes | null) ?? null
}

export async function borrarPerfil(id: string): Promise<boolean> {
  const service = createServiceClient()
  // .select() para saber si ha borrado de verdad: con RLS, un borrado sin
  // permiso no da error, simplemente no borra nada.
  const { data, error } = await service
    .from('amazon_costes_perfiles')
    .delete()
    .eq('id', id)
    .select('id')
  if (error) throw error
  return (data ?? []).length > 0
}

/**
 * Deja constancia del último intento en el propio perfil.
 *
 * NUNCA LANZA: ya se ha hecho el trabajo, y que no se pueda escribir la marca no
 * puede convertir una importación correcta en un error en pantalla.
 */
export async function marcarPerfil(
  id: string,
  patch: { last_run_at?: string; last_ok_at?: string | null; last_error?: string | null }
): Promise<void> {
  try {
    const service = createServiceClient()
    const { error } = await service.from('amazon_costes_perfiles').update(patch).eq('id', id)
    if (error) throw error
  } catch (error) {
    console.error('[costes] no se ha podido marcar el perfil:', error)
  }
}

/* ------------------------------------------------------------------ */
/* Política                                                            */
/* ------------------------------------------------------------------ */

/** La política de un cliente. Si no tiene fila, la de fábrica: nada decidido */
export async function politicaDe(clientId: string): Promise<PoliticaCostes> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('amazon_costes_politica')
    .select('*')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) throw error
  return (data as PoliticaCostes | null) ?? politicaPorDefecto(clientId)
}

export async function guardarPolitica(
  clientId: string,
  patch: {
    dias_caducidad?: number | null
    moneda_defecto?: string | null
    exigir_envio_propio?: boolean
    exigir_costes_fba?: boolean
    notes?: string | null
  },
  userId: string | null
): Promise<PoliticaCostes> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('amazon_costes_politica')
    .upsert(
      { client_id: clientId, ...patch, updated_by: userId },
      { onConflict: 'client_id' }
    )
    .select('*')
    .single()
  if (error) throw error
  return data as PoliticaCostes
}

/* ------------------------------------------------------------------ */
/* Lo que hace falta para cruzar                                       */
/* ------------------------------------------------------------------ */

/**
 * El mapeo verificado de UN cliente de la sincronización de stock.
 *
 * `stockClientId` sale del perfil, donde alguien lo eligió a mano. NUNCA se
 * deduce ni se traen todos: `stock_mappings` son los códigos del almacén de un
 * vendedor concreto, y cruzarlos con el fichero de otro sería mezclar datos de
 * dos clientes — exactamente lo que prohíbe el compromiso firmado ante Amazon.
 */
export async function mapeosDeStockClient(stockClientId: string): Promise<CrossMapping[]> {
  const service = createServiceClient()
  return fetchAll<CrossMapping>((desde, hasta) =>
    service
      .from('stock_mappings')
      .select('sku_amazon, ref_erp, asin, ean_amazon, ean_erp, ean_final, todos_ean_erp, origen_ean')
      .eq('client_id', stockClientId)
      .eq('is_active', true)
      .order('sku_amazon', { ascending: true })
      .range(desde, hasta)
  )
}

/** Lo que hace falta de un listing para el cruce y para saber su canal */
export interface ListingCoste {
  sku: string
  asin: string | null
  title: string | null
  is_fba: boolean
  marketplace_id: string
  connection_id: string
  codigo_externo: string | null
  /** Lo que decidió la regla de seguimiento de A1 */
  activo_calculado: boolean
  /** Lo que dijo una persona. GANA SIEMPRE. null = nadie se ha pronunciado */
  activo_manual: boolean | null
}

const LISTING_COSTE_FIELDS =
  'sku, asin, title, is_fba, marketplace_id, connection_id, codigo_externo, ' +
  'activo_calculado, activo_manual'

/**
 * El catálogo entero de un cliente, recortado a lo que necesita A5.
 *
 * Se trae ENTERO y no paginado por la pantalla, y conviene saber lo que cuesta:
 * en ShoesF son 13.700 filas de siete columnas cortas, o sea menos de un mega,
 * en catorce viajes de mil. Se hace así porque las dos preguntas de este módulo
 * —«¿qué SKU no tienen coste?» y «¿a qué SKU llega cada línea del fichero?»— no
 * se pueden contestar mirando una página: son del catálogo entero contra el
 * histórico entero. La cobertura, que es la que se pinta a menudo, NO pasa por
 * aquí: la calcula Postgres (ver coberturaDeCostes).
 */
export async function listingsDeCliente(clientId: string): Promise<ListingCoste[]> {
  const service = createServiceClient()

  const { data: conexiones, error: errorConexiones } = await service
    .from('amazon_connections')
    .select('id')
    .eq('client_id', clientId)
  if (errorConexiones) throw errorConexiones

  const ids = ((conexiones ?? []) as Array<{ id: string }>).map((c) => c.id)
  if (ids.length === 0) return []

  return fetchAll<ListingCoste>((desde, hasta) =>
    service
      .from('amazon_listings')
      .select(LISTING_COSTE_FIELDS)
      // El orden termina en columna única —(connection, marketplace, sku) es la
      // clave— así que .range() no repite ni se salta filas entre tramos.
      .in('connection_id', ids)
      .order('connection_id', { ascending: true })
      .order('marketplace_id', { ascending: true })
      .order('sku', { ascending: true })
      .range(desde, hasta)
  )
}

/** El catálogo reducido a lo que consume el cruce, con un SKU una sola vez */
export function paraCruce(listings: ListingCoste[]): ListingParaCruce[] {
  const porSku = new Map<string, ListingParaCruce>()
  for (const listing of listings) {
    const previo = porSku.get(listing.sku)
    // Se conserva el primer código externo que aparezca: un SKU que existe en
    // dos países es el mismo producto y su EAN no cambia de un país a otro.
    if (!previo) porSku.set(listing.sku, { sku: listing.sku, codigo_externo: listing.codigo_externo })
    else if (!previo.codigo_externo && listing.codigo_externo) {
      previo.codigo_externo = listing.codigo_externo
    }
  }
  return [...porSku.values()]
}

/* ------------------------------------------------------------------ */
/* Costes                                                              */
/* ------------------------------------------------------------------ */

/**
 * El histórico de costes de un cliente, con las columnas que añadió A5.
 *
 * Gemela de costesDeCliente() de A1 (lib/plataforma/datos.ts), que se quedó con
 * el tipo de A1 y se sigue usando desde allí. Aquí hace falta el tipo ancho.
 */
export async function costesDeCliente(clientId: string, skus?: string[]): Promise<CosteA5[]> {
  const service = createServiceClient()
  return fetchAll<CosteA5>((desde, hasta) => {
    let consulta = service.from('amazon_costes_producto').select('*').eq('client_id', clientId)
    if (skus && skus.length > 0) consulta = consulta.in('sku', skus)
    return consulta
      .order('sku', { ascending: true })
      .order('valido_desde', { ascending: true })
      .order('id', { ascending: true })
      .range(desde, hasta)
  })
}

/**
 * Los costes de un cliente cuyo tramo empieza en alguna de estas fechas.
 *
 * Es lo que necesita el planificador de una importación y NADA MÁS: para saber
 * si una línea del fichero es un alta o una corrección solo hace falta mirar si
 * ya existe ESE SKU con ESA fecha de entrada en vigor. Los demás tramos son
 * historia y no se tocan.
 *
 * Se filtra por fecha y no por SKU a propósito: un `.in('sku', ...)` con trece
 * mil valores construye una URL que no acepta ningún proxy, mientras que las
 * fechas distintas de un fichero son una, o unas pocas.
 */
export async function costesEnFechas(clientId: string, fechas: string[]): Promise<CosteA5[]> {
  if (fechas.length === 0) return []
  const service = createServiceClient()
  return fetchAll<CosteA5>((desde, hasta) =>
    service
      .from('amazon_costes_producto')
      .select('*')
      .eq('client_id', clientId)
      .in('valido_desde', fechas)
      .order('sku', { ascending: true })
      .order('valido_desde', { ascending: true })
      .order('id', { ascending: true })
      .range(desde, hasta)
  )
}

/** Todos los tramos de UN SKU, del más antiguo al más nuevo */
export async function tramosDeSku(clientId: string, sku: string): Promise<CosteA5[]> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('amazon_costes_producto')
    .select('*')
    .eq('client_id', clientId)
    .eq('sku', sku)
    .order('valido_desde', { ascending: false })
    .order('id', { ascending: false })
  if (error) throw error
  return (data ?? []) as CosteA5[]
}

export interface ResultadoEscritura {
  altas: number
  correcciones: number
  consultas: number
}

/**
 * Escribe el plan y deja el rastro.
 *
 * DOS COSAS QUE NO SE PUEDEN SEPARAR, aunque Postgres no las meta en la misma
 * transacción desde aquí: cada corrección pisa un valor que existía, y la fila
 * de auditoría con el ANTES es lo único que permite deshacerlo. Por eso la
 * auditoría se escribe ANTES que la corrección: si algo revienta por el camino,
 * lo que queda es una anotación de una corrección que no llegó a hacerse —que se
 * ve raro y se investiga— en vez de una corrección de la que no queda ni rastro.
 */
export async function aplicarPlan(
  clientId: string,
  plan: { altas: CosteAEscribir[]; correcciones: Correccion[] },
  contexto: { userId: string | null; importId: string | null; motivo?: string | null }
): Promise<ResultadoEscritura> {
  const service = createServiceClient()
  let consultas = 0

  // ---------- Auditoría primero ----------
  const auditoria = [
    ...plan.altas.map((alta) => ({
      client_id: clientId,
      sku: alta.sku,
      valido_desde: alta.valido_desde,
      import_id: contexto.importId,
      accion: 'alta' as const,
      origen: alta.origen,
      antes: null,
      despues: alta,
      motivo: contexto.motivo ?? null,
      created_by: contexto.userId,
    })),
    ...plan.correcciones.map((correccion) => ({
      client_id: clientId,
      sku: correccion.nuevo.sku,
      valido_desde: correccion.nuevo.valido_desde,
      coste_id: correccion.antes.id,
      import_id: contexto.importId,
      accion: 'correccion' as const,
      origen: correccion.nuevo.origen,
      antes: correccion.antes,
      despues: correccion.nuevo,
      motivo: contexto.motivo ?? null,
      created_by: contexto.userId,
    })),
  ]

  for (let i = 0; i < auditoria.length; i += CHUNK_ESCRITURA) {
    const { error } = await service
      .from('amazon_costes_auditoria')
      .insert(auditoria.slice(i, i + CHUNK_ESCRITURA))
    if (error) throw error
    consultas += 1
  }

  // ---------- Y ahora los costes ----------
  //
  // upsert por (client_id, sku, valido_desde), que es la clave única de la
  // tabla: el alta entra y la corrección pisa su tramo. Es lo que hace que
  // reimportar el mismo fichero sea inofensivo — y por tanto lo que hace que
  // «reanudar» una importación cortada sea simplemente volver a lanzarla.
  const filas = [
    ...plan.altas.map((alta) => aFila(clientId, alta, contexto)),
    ...plan.correcciones.map((c) => aFila(clientId, c.nuevo, contexto)),
  ]

  for (let i = 0; i < filas.length; i += CHUNK_ESCRITURA) {
    const { error } = await service
      .from('amazon_costes_producto')
      .upsert(filas.slice(i, i + CHUNK_ESCRITURA), { onConflict: 'client_id,sku,valido_desde' })
    if (error) throw error
    consultas += 1
  }

  return { altas: plan.altas.length, correcciones: plan.correcciones.length, consultas }
}

function aFila(
  clientId: string,
  coste: CosteAEscribir,
  contexto: { userId: string | null; importId: string | null }
): Record<string, unknown> {
  return {
    client_id: clientId,
    sku: coste.sku,
    coste: coste.coste,
    moneda: coste.moneda,
    valido_desde: coste.valido_desde,
    coste_envio: coste.coste_envio,
    coste_almacen_fba: coste.coste_almacen_fba,
    coste_flete_fba: coste.coste_flete_fba,
    iva_incluido: coste.iva_incluido,
    iva_porcentaje: coste.iva_porcentaje,
    origen: coste.origen,
    fuente_ref: coste.fuente_ref,
    notes: coste.notes,
    // created_by solo tiene sentido en el alta, pero en un upsert no se puede
    // distinguir: se escribe siempre y `updated_by` guarda quién lo tocó la
    // última vez. Quién dio de alta cada tramo está en la auditoría, que es
    // insert-only y no lo pisa nadie.
    created_by: contexto.userId,
    updated_by: contexto.userId,
    import_id: contexto.importId,
  }
}

/**
 * Borra un tramo de coste. Deja constancia con el antes.
 *
 * Existe porque un tramo metido con la fecha equivocada no se arregla metiendo
 * otro: se queda ahí rigiendo un trozo de histórico. El motivo es obligatorio.
 */
export async function borrarTramo(
  clientId: string,
  id: string,
  contexto: { userId: string | null; motivo: string }
): Promise<boolean> {
  const motivo = contexto.motivo.trim()
  if (motivo === '') throw new Error('Hay que decir por qué se borra el tramo de coste')

  const service = createServiceClient()
  const { data: antes, error: errorLectura } = await service
    .from('amazon_costes_producto')
    .select('*')
    .eq('id', id)
    // El client_id va en el WHERE y no en un `if` previo: los ids viajan desde
    // el navegador, y así no hay ventana entre comprobar y borrar.
    .eq('client_id', clientId)
    .maybeSingle()
  if (errorLectura) throw errorLectura
  if (!antes) return false

  const fila = antes as CosteA5
  const { error: errorAuditoria } = await service.from('amazon_costes_auditoria').insert({
    client_id: clientId,
    sku: fila.sku,
    valido_desde: fila.valido_desde,
    coste_id: fila.id,
    accion: 'borrado',
    origen: 'manual',
    antes: fila,
    despues: null,
    motivo,
    created_by: contexto.userId,
  })
  if (errorAuditoria) throw errorAuditoria

  const { data, error } = await service
    .from('amazon_costes_producto')
    .delete()
    .eq('id', id)
    .eq('client_id', clientId)
    .select('id')
  if (error) throw error
  return (data ?? []).length > 0
}

/* ------------------------------------------------------------------ */
/* Importaciones y auditoría                                           */
/* ------------------------------------------------------------------ */

export async function registrarImportacion(
  fila: Record<string, unknown>
): Promise<string | null> {
  try {
    const service = createServiceClient()
    const { data, error } = await service
      .from('amazon_costes_importaciones')
      .insert(fila)
      .select('id')
      .single()
    if (error) throw error
    return (data as { id: string }).id
  } catch (error) {
    // NUNCA LANZA, igual que registrarRun() en la sincronización de stock: es lo
    // último que pasa y el trabajo ya está hecho. Perder la anotación no puede
    // convertir una importación correcta en un error en pantalla. Se avisa por
    // consola, que es donde se mira cuando falta una fila del historial.
    console.error('[costes] no se ha podido registrar la importación:', error)
    return null
  }
}

const IMPORTACIONES_RECIENTES = 30

export async function importacionesDe(
  clientId: string,
  limite = IMPORTACIONES_RECIENTES
): Promise<ImportacionCostes[]> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('amazon_costes_importaciones')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    // El desempate por id no es cosmético: dos importaciones del mismo segundo
    // —un simulacro y su aplicación— saldrían en orden distinto en cada recarga.
    .order('id', { ascending: false })
    .limit(limite)
  if (error) throw error
  return (data ?? []) as ImportacionCostes[]
}

export async function auditoriaDeSku(
  clientId: string,
  sku: string,
  limite = 50
): Promise<AuditoriaCoste[]> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('amazon_costes_auditoria')
    .select('*')
    .eq('client_id', clientId)
    .eq('sku', sku)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limite)
  if (error) throw error
  return (data ?? []) as AuditoriaCoste[]
}

/* ------------------------------------------------------------------ */
/* Cobertura                                                           */
/* ------------------------------------------------------------------ */

/**
 * La cobertura de costes, calculada en Postgres.
 *
 * Devuelve HECHOS, no veredictos: quién los compone es clasificarCobertura(),
 * que es la misma función que juzga un coste suelto. El porqué está escrito en
 * la migración 126 y en completitud.ts.
 */
export async function coberturaDeCostes(
  clientId: string,
  fecha: string,
  soloSeguimiento = false
): Promise<FilaCoberturaCostes[]> {
  const service = createServiceClient()
  const { data, error } = await service.rpc('plataforma_cobertura_costes', {
    p_client_id: clientId,
    p_fecha: fecha,
    p_solo_seguimiento: soloSeguimiento,
  })
  if (error) throw error

  // Los BIGINT de Postgres llegan como texto en el JSON de PostgREST cuando se
  // pasan de 2^53; con Number() se normalizan los dos casos. Un NaN aquí pintaría
  // «—» en la pantalla, así que se corta a 0, que para un recuento es correcto.
  return ((data ?? []) as Array<Record<string, unknown>>).map((fila) => ({
    connection_id: String(fila.connection_id),
    marketplace_id: String(fila.marketplace_id),
    skus: Number(fila.skus) || 0,
    en_seguimiento: Number(fila.en_seguimiento) || 0,
    con_coste: Number(fila.con_coste) || 0,
    sin_coste: Number(fila.sin_coste) || 0,
    propio_sin_envio: Number(fila.propio_sin_envio) || 0,
    fba_sin_almacen: Number(fila.fba_sin_almacen) || 0,
    fba_sin_flete: Number(fila.fba_sin_flete) || 0,
    con_iva_sin_tipo: Number(fila.con_iva_sin_tipo) || 0,
    monedas: Array.isArray(fila.monedas) ? (fila.monedas as string[]) : [],
    coste_mas_antiguo: (fila.coste_mas_antiguo as string | null) ?? null,
    coste_mas_nuevo: (fila.coste_mas_nuevo as string | null) ?? null,
    dias_mediana:
      fila.dias_mediana === null || fila.dias_mediana === undefined
        ? null
        : Number(fila.dias_mediana),
  }))
}

/* ------------------------------------------------------------------ */
/* Clientes de la sincronización de stock                              */
/* ------------------------------------------------------------------ */

export interface StockClienteBreve {
  id: string
  name: string
  slug: string
  /** Cuántas filas de mapeo tiene. Es lo que dice si enlazarlo sirve de algo */
  mapeos: number
}

/**
 * Los clientes de la sincronización de stock, para poder elegir de cuál se toma
 * el mapeo referencia -> SKU.
 *
 * ES LA ÚNICA LISTA DE ESTE MÓDULO QUE CRUZA VARIOS CLIENTES, y son nombres de
 * censo, no datos de tienda: ni un SKU, ni un precio, ni una unidad. Hace falta
 * para poder elegir, y la elección la hace una persona a conciencia. A partir de
 * ahí, todo lo que se lee es de ESE cliente.
 */
export async function clientesDeStock(): Promise<StockClienteBreve[]> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('stock_clients')
    .select('id, name, slug')
    .eq('is_active', true)
    .order('position', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw error

  const clientes = (data ?? []) as Array<{ id: string; name: string; slug: string }>
  const salida: StockClienteBreve[] = []

  for (const cliente of clientes) {
    // Se cuenta en la base con head:true: traerse trece mil filas de mapeo para
    // saber que son trece mil sería el viaje más caro de la pantalla.
    const { count } = await service
      .from('stock_mappings')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', cliente.id)
      .eq('is_active', true)
    salida.push({ ...cliente, mapeos: count ?? 0 })
  }

  return salida
}

/** Para poder decir en la pantalla de qué modo se importó */
export type { ModoImportacion }
