/**
 * PLATAFORMA · LO QUE LEEN Y ESCRIBEN LAS PANTALLAS DE A1
 * =======================================================
 * SOLO SERVIDOR: importa el cliente de service_role.
 *
 * Es el gemelo de datos.ts —que es lo que consumen los TRABAJOS— para lo que
 * consume la INTERFAZ. Están separados a propósito: un trabajo nocturno quiere
 * nueve columnas de trece mil filas y una pantalla quiere treinta columnas de
 * cincuenta, y mezclar las dos necesidades en las mismas funciones acaba
 * trayéndose el catálogo entero para pintar una tabla.
 *
 *
 * LAS DOS REGLAS QUE NO SE SALTAN AQUÍ
 * ------------------------------------
 *
 * 1. NO SE LEE `amazon_connections.refresh_token_enc`. Las columnas se piden por
 *    su nombre, nunca con `*`, y en este fichero además todo acaba en una
 *    respuesta HTTP: lo que se cuele aquí sale al navegador. Es la misma regla
 *    que encabeza datos.ts y catalogo.ts.
 *
 * 2. CUMPLIMIENTO ANTE AMAZON (§2.1 de la especificación). Todas las funciones
 *    de este fichero trabajan sobre UN cliente. La única que devuelve varios
 *    —`resumenClientes`— devuelve una fila independiente por cada uno con
 *    métricas de NUESTRO proceso (trabajos en cola, incidencias abiertas), nunca
 *    datos de negocio de la tienda de nadie: ni una media, ni un total del
 *    conjunto, ni un orden que ponga a un cliente por delante de otro por sus
 *    cifras. El orden es el manual de `position` y luego alfabético.
 */

import { createServiceClient } from '@/lib/supabase/service'
import {
  conexionesDeCliente,
  fetchAll,
  filtroMercadosActivos,
  type ConexionPlataforma,
} from './datos'
import { isMissingSchema } from './eventos'
import type {
  AmazonJobTipo,
  AmazonListingCatalogo,
  ReglaActivos,
  SnapshotBsr,
  SnapshotInventario,
} from './tipos'

export { isMissingSchema }

/**
 * ¿El fallo es «esa FUNCIÓN no existe»? PostgREST contesta PGRST202 y Postgres
 * 42883.
 *
 * Desde que isMissingSchema mira también estos dos códigos, esto es un
 * subconjunto suyo y `faltaEsquema` de abajo da lo mismo que él. Se deja porque
 * nombra el caso, no porque haga falta: el módulo de Buy Box y el de FBM → FBA
 * aliasaban el isMissingSchema CRUDO y se comían un 500 genérico donde Marcas y
 * Costes decían qué fichero pegar. La lección es que el sitio donde se arregla
 * esto es eventos.ts, no una copia por módulo.
 */
export function faltaFuncion(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === 'PGRST202' || code === '42883'
}

/** Lo que hay que pegar en el editor SQL de Supabase para que esto funcione */
export const FALTAN_MIGRACIONES =
  'Faltan migraciones de la plataforma: lanza 123_plataforma_a1.sql y ' +
  '125_plataforma_a1_pantallas.sql en el editor SQL de Supabase'

/** ¿El fallo es «esto todavía no está en la base»? */
export function faltaEsquema(error: unknown): boolean {
  return isMissingSchema(error) || faltaFuncion(error)
}

/* ------------------------------------------------------------------ */
/* 1 · El selector de cliente y el estado de su ingesta                 */
/* ------------------------------------------------------------------ */

/** Lo que cuenta la función plataforma_resumen_ingesta de la migración 125 */
export interface ResumenIngesta {
  pendientes: number
  en_curso: number
  pausados: number
  errores_24h: number
  eventos_abiertos: number
  eventos_graves_abiertos: number
  ultimo_movimiento: string | null
}

export interface ClienteConIngesta extends ResumenIngesta {
  id: string
  name: string
  slug: string
  /** Sin token. Ver la regla 1 de la cabecera */
  conexiones: ConexionPlataforma[]
}

// `marketplaces_activos` va aquí porque la pantalla de Ingesta construye sus
// filas con mercadosDeConexion(), y sin esta columna esa función no vería
// ninguna elección hecha: listaría los once mercados que devuelve Amazon,
// incluidos los de sandbox, con un «nunca ha corrido» al lado de cada uno.
const CONEXION_FIELDS =
  'id, client_id, name, selling_partner_id, marketplace_ids, marketplaces_activos, ' +
  'default_marketplace_id, status, is_active, last_sync_at, last_sync_items'

const RESUMEN_VACIO: ResumenIngesta = {
  pendientes: 0,
  en_curso: 0,
  pausados: 0,
  errores_24h: 0,
  eventos_abiertos: 0,
  eventos_graves_abiertos: 0,
  ultimo_movimiento: null,
}

/**
 * Los clientes con conexión, con el estado de su ingesta al lado.
 *
 * TRES CONSULTAS EN TOTAL, no tres por cliente: la lista, las conexiones de
 * todos y el resumen de todos. Con dieciséis clientes la diferencia entre esto y
 * un bucle son cuarenta y ocho viajes a la base cada vez que alguien abre la
 * pantalla.
 *
 * Salen TAMBIÉN los clientes sin ninguna conexión autorizada, con la lista
 * vacía. No es un descuido: si se filtraran, un cliente que todavía no ha
 * conectado su cuenta sería invisible y nadie sabría que falta por hacer.
 */
export async function clientesConIngesta(): Promise<ClienteConIngesta[]> {
  const service = createServiceClient()

  const { data: clientes, error: errorClientes } = await service
    .from('amazon_clients')
    .select('id, name, slug')
    .eq('is_active', true)
    .order('position', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true })
    .order('id', { ascending: true })
  if (errorClientes) throw errorClientes

  const { data: conexiones, error: errorConexiones } = await service
    .from('amazon_connections')
    .select(CONEXION_FIELDS)
    .eq('is_active', true)
    .eq('status', 'activa')
    .order('name', { ascending: true })
    .order('id', { ascending: true })
  if (errorConexiones) throw errorConexiones

  const { data: resumenes, error: errorResumen } = await service.rpc('plataforma_resumen_ingesta', {
    p_client_id: null,
  })
  if (errorResumen) throw errorResumen

  const porCliente = new Map<string, ConexionPlataforma[]>()
  for (const conexion of (conexiones ?? []) as unknown as ConexionPlataforma[]) {
    const lista = porCliente.get(conexion.client_id)
    if (lista) lista.push(conexion)
    else porCliente.set(conexion.client_id, [conexion])
  }

  const resumenPorCliente = new Map<string, ResumenIngesta>()
  for (const fila of (resumenes ?? []) as Array<ResumenIngesta & { client_id: string }>) {
    resumenPorCliente.set(fila.client_id, {
      pendientes: Number(fila.pendientes) || 0,
      en_curso: Number(fila.en_curso) || 0,
      pausados: Number(fila.pausados) || 0,
      errores_24h: Number(fila.errores_24h) || 0,
      eventos_abiertos: Number(fila.eventos_abiertos) || 0,
      eventos_graves_abiertos: Number(fila.eventos_graves_abiertos) || 0,
      ultimo_movimiento: fila.ultimo_movimiento ?? null,
    })
  }

  return ((clientes ?? []) as Array<{ id: string; name: string; slug: string }>).map((cliente) => ({
    ...cliente,
    conexiones: porCliente.get(cliente.id) ?? [],
    ...(resumenPorCliente.get(cliente.id) ?? RESUMEN_VACIO),
  }))
}

/* ------------------------------------------------------------------ */
/* 2 · Cuándo terminó bien cada refresco                                */
/* ------------------------------------------------------------------ */

export interface UltimoRefresco {
  tipo: AmazonJobTipo
  connection_id: string | null
  marketplace_id: string | null
  terminado_at: string
  job_id: string
  procesados: number
  omitidos: number
  errores: number
  resumen: string | null
}

/**
 * El último trabajo TERMINADO de cada refresco de este cliente.
 *
 * Es lo que contesta «cuándo fue el último barrido completo y el último
 * diario», que es la primera pregunta de quien abre la pantalla. Los filtros
 * (solo 'terminado', solo barridos completos, uno por unidad de trabajo) están
 * dentro de la función SQL de la migración 125 y explicados allí: los tres
 * deciden si el dato es verdad o es un consuelo.
 */
export async function ultimosRefrescos(clientId: string): Promise<UltimoRefresco[]> {
  const service = createServiceClient()
  const { data, error } = await service.rpc('plataforma_ultimos_refrescos', {
    p_client_id: clientId,
  })
  if (error) throw error

  /**
   * SE RECORTAN LOS MERCADOS QUE NO SE TRABAJAN.
   *
   * La función SQL expande cuenta × mercado dentro de Postgres y no sabe nada
   * de `marketplaces_activos` (migración 134). Sin este filtro, un cliente con
   * solo España elegida seguía viendo aquí sus once países —incluidos los de
   * sandbox— con un «nunca ha corrido» al lado, que además es mentira: no es
   * que no haya corrido todavía, es que no se va a programar nunca.
   *
   * Mismo recorte que ya hace resumenBuyBox(). Va en TypeScript y no en el SQL
   * porque filtrarlo allí obligaría a otra migración que lanzar a mano.
   */
  const seTrabaja = filtroMercadosActivos(await conexionesDeCliente(clientId))

  return ((data ?? []) as UltimoRefresco[])
    // Un refresco SIN marketplace es de cliente entero —«Recalcular SKU en
    // seguimiento»— y no se recorta: no va contra ningún país en concreto.
    .filter((fila) =>
      !fila.connection_id || !fila.marketplace_id
        ? true
        : seTrabaja(fila.connection_id, fila.marketplace_id)
    )
    .map((fila) => ({
      ...fila,
      procesados: Number(fila.procesados) || 0,
      omitidos: Number(fila.omitidos) || 0,
      errores: Number(fila.errores) || 0,
    }))
}

/* ------------------------------------------------------------------ */
/* 3 · Cobertura de datos                                              */
/* ------------------------------------------------------------------ */

/**
 * La cobertura de una unidad de trabajo.
 *
 * Los cuatro cajones del inventario NO son un capricho: 'no_aplica' es un SKU de
 * FBM, y eso no es un agujero de cobertura sino la respuesta correcta. Con dos
 * cajones, ShoesF —mayoría FBM— aparecería con un 10 % de cobertura y alguien
 * saldría a arreglar algo que no está roto. La explicación larga está en la
 * cabecera de la función SQL, en la migración 125.
 */
export interface CoberturaUnidad {
  connection_id: string
  connection_name: string
  selling_partner_id: string
  marketplace_id: string
  total: number
  en_seguimiento: number
  fba: number
  fbm: number
  a_la_venta: number
  con_asin: number
  con_precio: number
  con_atributos: number
  con_marca: number
  con_categoria: number
  con_dimensiones: number
  con_dimensiones_amazon: number
  con_bsr: number
  inv_conocido: number
  inv_no_aplica: number
  inv_desconocido: number
  inv_sin_leer: number
  catalogo_ultimo: string | null
  bsr_ultimo: string | null
  inv_ultimo: string | null
}

/** Las dos ventanas de frescura, en días. Son parámetros de la función SQL */
export const VENTANA_BSR_DIAS = 30
export const VENTANA_INVENTARIO_DIAS = 7

/**
 * Cuántos SKU de este cliente tienen cada dato.
 *
 * Devuelve una lista VACÍA cuando el cliente no tiene ni una conexión o su
 * espejo del catálogo está vacío, y quien la pinta tiene que distinguir eso de
 * «cobertura cero»: son dos cosas distintas y llevan a acciones distintas
 * (conectar la cuenta / lanzar el censo).
 */
export async function coberturaDe(clientId: string): Promise<CoberturaUnidad[]> {
  const service = createServiceClient()
  const { data, error } = await service.rpc('plataforma_cobertura_a1', {
    p_client_id: clientId,
    p_dias_bsr: VENTANA_BSR_DIAS,
    p_dias_inventario: VENTANA_INVENTARIO_DIAS,
  })
  if (error) throw error

  // Mismo recorte que en ultimosRefrescos(): la función SQL no sabe de
  // `marketplaces_activos`, así que sin esto la cobertura salía con una fila por
  // cada país que Amazon devuelve, incluidos los de sandbox, todas a cero. Y una
  // cobertura del 0 % en un país donde no se trabaja no es un agujero: es ruido
  // que hace parecer rota una cuenta que está bien.
  const seTrabaja = filtroMercadosActivos(await conexionesDeCliente(clientId))

  // Postgres devuelve los `count(*)` como BIGINT, y supabase-js los entrega como
  // string. Sin este paso, `a + b` en la pantalla concatena en vez de sumar y
  // una cobertura de 12 sobre 100 se pinta como «12100».
  return ((data ?? []) as Array<Record<string, unknown>>)
    .filter((fila) => seTrabaja(String(fila.connection_id), String(fila.marketplace_id ?? '')))
    .map((fila) => ({
    connection_id: String(fila.connection_id),
    connection_name: String(fila.connection_name ?? ''),
    selling_partner_id: String(fila.selling_partner_id ?? ''),
    marketplace_id: String(fila.marketplace_id ?? ''),
    total: numero(fila.total),
    en_seguimiento: numero(fila.en_seguimiento),
    fba: numero(fila.fba),
    fbm: numero(fila.fbm),
    a_la_venta: numero(fila.a_la_venta),
    con_asin: numero(fila.con_asin),
    con_precio: numero(fila.con_precio),
    con_atributos: numero(fila.con_atributos),
    con_marca: numero(fila.con_marca),
    con_categoria: numero(fila.con_categoria),
    con_dimensiones: numero(fila.con_dimensiones),
    con_dimensiones_amazon: numero(fila.con_dimensiones_amazon),
    con_bsr: numero(fila.con_bsr),
    inv_conocido: numero(fila.inv_conocido),
    inv_no_aplica: numero(fila.inv_no_aplica),
    inv_desconocido: numero(fila.inv_desconocido),
    inv_sin_leer: numero(fila.inv_sin_leer),
    catalogo_ultimo: (fila.catalogo_ultimo as string | null) ?? null,
    bsr_ultimo: (fila.bsr_ultimo as string | null) ?? null,
    inv_ultimo: (fila.inv_ultimo as string | null) ?? null,
  }))
}

function numero(valor: unknown): number {
  const n = Number(valor)
  return Number.isFinite(n) ? n : 0
}

/* ------------------------------------------------------------------ */
/* 4 · El catálogo, para la tabla de SKU en seguimiento                */
/* ------------------------------------------------------------------ */

/**
 * Una fila de la tabla de SKU.
 *
 * Es un subconjunto EXPLÍCITO de `ListingConCatalogo`, no la fila entera: hay
 * treinta y tantas columnas en amazon_listings y esta tabla pinta doce. Pedirlas
 * por su nombre además es lo que impide que una columna nueva —o el token, si
 * algún día alguien lo mueve de tabla— acabe en el navegador por omisión.
 */
export interface FilaCatalogo
  extends Pick<
    AmazonListingCatalogo,
    | 'marca'
    | 'categoria'
    | 'clasificacion_item'
    | 'es_marca_propia'
    | 'dims_origen'
    | 'catalogo_visto_at'
    | 'activo_calculado'
    | 'activo_manual'
    | 'activo_motivo'
    | 'activo_evaluado_at'
  > {
  id: string
  connection_id: string
  marketplace_id: string
  sku: string
  asin: string | null
  title: string | null
  listing_status: string[]
  price: number | null
  currency: string | null
  quantity: number | null
  is_fba: boolean
  updated_at: string
}

const FILA_CATALOGO_FIELDS =
  'id, connection_id, marketplace_id, sku, asin, title, listing_status, price, currency, ' +
  'quantity, is_fba, marca, categoria, clasificacion_item, es_marca_propia, dims_origen, ' +
  'catalogo_visto_at, activo_calculado, activo_manual, activo_motivo, activo_evaluado_at, updated_at'

/** Qué filas quiere ver quien mira la tabla */
export type FiltroSeguimiento = 'todos' | 'dentro' | 'fuera' | 'manual'

export interface ConsultaCatalogo {
  clientId: string
  /** Vacío = todas las conexiones del cliente */
  connectionId?: string | null
  marketplaceId?: string | null
  /** Busca en SKU, ASIN y título */
  q?: string | null
  filtro?: FiltroSeguimiento
  limite?: number
  desde?: number
}

export interface ResultadoCatalogo {
  filas: FilaCatalogo[]
  /** Cuántas cumplen el filtro EN TOTAL, no cuántas se devuelven */
  total: number
  desde: number
  limite: number
}

/** Tope por página. Cien filas de 28 px son tres pantallas: más es scroll infinito
    disfrazado, y la base tarda lo mismo en darlas que en darlas todas */
export const LIMITE_CATALOGO = 100

/**
 * El catálogo de un cliente, filtrado y paginado.
 *
 * SE PAGINA Y SE CUENTA EN LA BASE, nunca en el navegador. En ShoesF son 13.700
 * referencias: traérselas para filtrar en memoria funciona con el cliente piloto
 * —cinco SKU— y deja de funcionar con el que de verdad importa.
 *
 * El filtro de «en seguimiento» usa COALESCE(activo_manual, activo_calculado)
 * escrito como una condición OR de PostgREST, igual que soloEnSeguimiento() en
 * catalogo.ts: un `eq('activo_calculado', true)` a secas se saltaría lo que dijo
 * una persona y la tabla enseñaría lo contrario de la verdad justo en la
 * pantalla desde la que se decide.
 */
export async function catalogoDeCliente(consulta: ConsultaCatalogo): Promise<ResultadoCatalogo> {
  const service = createServiceClient()
  const limite = Math.min(LIMITE_CATALOGO, Math.max(1, consulta.limite ?? LIMITE_CATALOGO))
  const desde = Math.max(0, consulta.desde ?? 0)

  const conexiones = await conexionesDelCliente(consulta.clientId)
  const permitidas = consulta.connectionId
    ? conexiones.filter((c) => c.id === consulta.connectionId)
    : conexiones

  // Sin conexiones no hay catálogo, y con un `.in('connection_id', [])`
  // PostgREST devuelve todo el mundo. Cortar aquí no es una optimización: es lo
  // que impide que un cliente sin cuenta conectada vea el catálogo de otro.
  if (permitidas.length === 0) {
    return { filas: [], total: 0, desde, limite }
  }

  let base = service
    .from('amazon_listings')
    .select(FILA_CATALOGO_FIELDS, { count: 'exact' })
    .in(
      'connection_id',
      permitidas.map((c) => c.id)
    )

  if (consulta.marketplaceId) base = base.eq('marketplace_id', consulta.marketplaceId)

  const q = (consulta.q ?? '').trim()
  if (q !== '') {
    // Se escapan las comas y los paréntesis: son los separadores de la sintaxis
    // de filtros de PostgREST, y un SKU con una coma dentro rompería la consulta
    // en dos condiciones sin dar error.
    const patron = `*${q.replace(/[(),]/g, ' ')}*`
    base = base.or(`sku.ilike.${patron},asin.ilike.${patron},title.ilike.${patron}`)
  }

  switch (consulta.filtro ?? 'todos') {
    case 'dentro':
      base = base.or('activo_manual.eq.true,and(activo_manual.is.null,activo_calculado.eq.true)')
      break
    case 'fuera':
      base = base.or('activo_manual.eq.false,and(activo_manual.is.null,activo_calculado.eq.false)')
      break
    case 'manual':
      base = base.not('activo_manual', 'is', null)
      break
    case 'todos':
      break
  }

  const { data, count, error } = await base
    // El SKU es único dentro de (conexión, marketplace), así que el orden acaba
    // en columna única y .range() no repite ni se salta filas entre páginas.
    .order('sku', { ascending: true })
    .order('connection_id', { ascending: true })
    .order('marketplace_id', { ascending: true })
    .range(desde, desde + limite - 1)

  if (error) throw error

  return {
    filas: (data ?? []) as unknown as FilaCatalogo[],
    total: count ?? 0,
    desde,
    limite,
  }
}

async function conexionesDelCliente(clientId: string): Promise<ConexionPlataforma[]> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('amazon_connections')
    .select(CONEXION_FIELDS)
    .eq('client_id', clientId)
    .order('name', { ascending: true })
    .order('id', { ascending: true })
  if (error) throw error
  return (data ?? []) as unknown as ConexionPlataforma[]
}

/* ------------------------------------------------------------------ */
/* 5 · Marcar un SKU a mano                                            */
/* ------------------------------------------------------------------ */

export interface MarcaManual {
  clientId: string
  listingIds: string[]
  /** null = se le devuelve la decisión a la regla */
  activo: boolean | null
  /** Obligatorio cuando `activo` no es null. Lo exige también un CHECK */
  motivo: string | null
}

/**
 * Pone o quita la marca manual de unos SKU.
 *
 * LOS TRES CUIDADOS, y ninguno sobra:
 *
 * 1. SE COMPRUEBA QUE LOS LISTINGS SON DE ESTE CLIENTE antes de escribir. El id
 *    de un listing viaja desde el navegador, y sin esta comprobación un id
 *    cambiado a mano en la petición dejaría escribir en el catálogo de otro
 *    cliente. Es exactamente lo que prohíbe el compromiso firmado ante Amazon.
 *    Va como una condición MÁS del propio UPDATE y no como una comprobación
 *    previa, para que no exista una ventana entre comprobar y escribir.
 *
 * 2. EL MOTIVO ES OBLIGATORIO. También lo exige el CHECK
 *    amazon_listings_activo_manual_ok de la migración 123, pero se corta antes
 *    para poder decirlo en español en vez de enseñar un error de Postgres. Sin
 *    motivo, dentro de tres meses nadie sabe por qué este SKU no se refresca.
 *
 * 3. NO SE TOCA `activo_calculado`. Es de la regla, y machacarlo desde aquí
 *    borraría lo que decidió el último recálculo: el día que alguien quite la
 *    marca manual, la fila tiene que volver a lo que dice el criterio, no a lo
 *    que escribió una persona.
 *
 * QUIÉN LO HIZO NO SE GUARDA EN LA FILA porque amazon_listings no tiene columna
 * para eso y no se le añade una desde una pantalla. La constancia la deja la
 * ruta de API con un evento de severidad 'info' y `created_by`, que es una tabla
 * que ya existe para esto y que —por el trigger de la 123— no hace sonar la
 * campana cuando detrás hay una persona.
 */
export async function marcarActivoManual(marca: MarcaManual): Promise<{ cambiados: number }> {
  const ids = [...new Set(marca.listingIds.filter((id) => typeof id === 'string' && id !== ''))]
  if (ids.length === 0) return { cambiados: 0 }

  const motivo = (marca.motivo ?? '').trim()
  if (marca.activo !== null && motivo === '') {
    throw new Error('Di por qué este SKU se sigue (o deja de seguirse) a mano')
  }

  const service = createServiceClient()

  const conexiones = await conexionesDelCliente(marca.clientId)
  if (conexiones.length === 0) {
    throw new Error('Ese cliente no tiene ninguna cuenta de Amazon conectada')
  }

  const { data, error } = await service
    .from('amazon_listings')
    .update(
      marca.activo === null
        ? {
            activo_manual: null,
            // El motivo también se borra: si se quedara, la fila diría «lo sacó
            // una persona» mientras la regla la ha vuelto a meter. El recálculo
            // siguiente lo escribe con el motivo de la regla.
            activo_motivo: null,
          }
        : {
            activo_manual: marca.activo,
            activo_motivo: motivo.slice(0, 400),
          }
    )
    .in('id', ids)
    .in(
      'connection_id',
      conexiones.map((c) => c.id)
    )
    .select('id')

  if (error) throw error
  return { cambiados: (data ?? []).length }
}

/* ------------------------------------------------------------------ */
/* 6 · La regla del cliente                                            */
/* ------------------------------------------------------------------ */

/** Los campos que se pueden editar desde la pantalla */
export type ReglaEditable = Pick<
  ReglaActivos,
  | 'name'
  | 'marketplace_ids'
  | 'incluir_fba'
  | 'incluir_fbm'
  | 'incluir_marca_propia'
  | 'min_unidades'
  | 'ventana_dias'
  | 'solo_listados_activos'
  | 'excluir_sin_precio'
  | 'excluir_variacion_padre'
  | 'marcas_excluidas'
  | 'skus_excluidos'
  | 'skus_incluidos'
  | 'tope_skus'
  | 'orden_tope'
  | 'notes'
>

/**
 * Guarda la regla viva de un cliente. La crea si no tenía ninguna.
 *
 * NO SE CREA UNA REGLA NUEVA EN CADA GUARDADO, y es una decisión con
 * consecuencias: la migración 123 deja `is_active=false` en las reglas viejas
 * «porque son el registro de con qué criterio se midió el histórico», o sea que
 * versionar tendría sentido. Se actualiza en su sitio porque el índice único
 * parcial solo permite una viva por cliente, y una pantalla que crea una fila
 * por cada tecleo dejaría cuarenta reglas muertas la primera tarde. El día que
 * haga falta el histórico de criterios, se versiona aquí y en ningún otro sitio.
 */
export async function guardarRegla(
  clientId: string,
  campos: ReglaEditable,
  userId: string | null
): Promise<ReglaActivos> {
  const service = createServiceClient()

  const { data: viva, error: errorLectura } = await service
    .from('amazon_tracking_rules')
    .select('id')
    .eq('client_id', clientId)
    .eq('is_active', true)
    .limit(1)
  if (errorLectura) throw errorLectura

  const fila = {
    name: campos.name.trim().slice(0, 120) || 'Criterio del cliente',
    marketplace_ids: campos.marketplace_ids,
    incluir_fba: campos.incluir_fba,
    incluir_fbm: campos.incluir_fbm,
    incluir_marca_propia: campos.incluir_marca_propia,
    min_unidades: campos.min_unidades,
    ventana_dias: campos.ventana_dias,
    solo_listados_activos: campos.solo_listados_activos,
    excluir_sin_precio: campos.excluir_sin_precio,
    excluir_variacion_padre: campos.excluir_variacion_padre,
    marcas_excluidas: campos.marcas_excluidas,
    skus_excluidos: campos.skus_excluidos,
    skus_incluidos: campos.skus_incluidos,
    tope_skus: campos.tope_skus,
    orden_tope: campos.orden_tope,
    notes: campos.notes,
  }

  const existente = ((viva ?? [])[0] as { id: string } | undefined) ?? null

  const { data, error } = existente
    ? await service
        .from('amazon_tracking_rules')
        .update(fila)
        .eq('id', existente.id)
        .select('*')
        .single()
    : await service
        .from('amazon_tracking_rules')
        .insert({ ...fila, client_id: clientId, is_active: true, created_by: userId })
        .select('*')
        .single()

  if (error) throw error
  return data as ReglaActivos
}

/* ------------------------------------------------------------------ */
/* 7 · La ficha de un SKU                                              */
/* ------------------------------------------------------------------ */

export interface FichaSku {
  listing: FilaCatalogo & {
    product_type: string | null
    fulfillment_channel_code: string | null
    fba_quantity: number | null
    fba_fulfillable_quantity: number | null
    last_seen_at: string
    codigo_externo: string | null
    codigo_externo_tipo: string | null
    categoria_id: string | null
    peso: number | null
    peso_unidad: string | null
    largo: number | null
    ancho: number | null
    alto: number | null
    dims_unidad: string | null
    peso_paquete: number | null
    peso_paquete_unidad: string | null
    largo_paquete: number | null
    ancho_paquete: number | null
    alto_paquete: number | null
    dims_paquete_unidad: string | null
  }
  connection: ConexionPlataforma
  bsr: SnapshotBsr[]
  inventario: SnapshotInventario[]
  /** Días de histórico que se han pedido */
  dias: number
}

const FICHA_FIELDS =
  `${FILA_CATALOGO_FIELDS}, product_type, fulfillment_channel_code, fba_quantity, ` +
  'fba_fulfillable_quantity, last_seen_at, codigo_externo, codigo_externo_tipo, categoria_id, ' +
  'peso, peso_unidad, largo, ancho, alto, dims_unidad, ' +
  'peso_paquete, peso_paquete_unidad, largo_paquete, ancho_paquete, alto_paquete, dims_paquete_unidad'

/** Tope de días de histórico que se pueden pedir de una vez */
export const MAX_DIAS_FICHA = 365

/**
 * Todo lo que sabemos de un SKU, con sus dos series.
 *
 * LAS SERIES SE BUSCAN POR LA IDENTIDAD CONGELADA (vendedor + marketplace +
 * SKU), NO POR `listing_id`. Es la misma decisión que documenta la migración
 * 123: las series no tienen clave ajena porque el listing se borra de verdad
 * —purgeMissingListings() se lleva lo que Amazon deja de devolver— y su
 * histórico tiene que sobrevivir a eso. Buscar por listing_id haría que un SKU
 * que se dio de baja y se volvió a dar de alta apareciera sin pasado.
 *
 * Y por eso mismo el índice que sirve la consulta es
 * (selling_partner_id, marketplace_id, sku, fecha DESC), que es exactamente el
 * orden en el que se piden.
 */
export async function fichaSku(params: {
  clientId: string
  connectionId: string
  marketplaceId: string
  sku: string
  dias?: number
}): Promise<FichaSku | null> {
  const service = createServiceClient()
  const dias = Math.min(MAX_DIAS_FICHA, Math.max(1, Math.round(params.dias ?? 90)))

  const conexiones = await conexionesDelCliente(params.clientId)
  const connection = conexiones.find((c) => c.id === params.connectionId)
  // La misma puerta que en marcarActivoManual: el id viene del navegador, así
  // que se comprueba que la cuenta es de este cliente antes de leer nada suyo.
  if (!connection) return null

  const { data, error } = await service
    .from('amazon_listings')
    .select(FICHA_FIELDS)
    .eq('connection_id', params.connectionId)
    .eq('marketplace_id', params.marketplaceId)
    .eq('sku', params.sku)
    .limit(1)
  if (error) throw error

  const listing = (((data ?? []) as unknown[])[0] as FichaSku['listing'] | undefined) ?? null
  if (!listing) return null

  const desde = new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString()

  const bsr = await fetchAll<SnapshotBsr>((a, b) =>
    service
      .from('amazon_snapshots_bsr')
      .select('*')
      .eq('selling_partner_id', connection.selling_partner_id)
      .eq('marketplace_id', params.marketplaceId)
      .eq('sku', params.sku)
      .gte('fecha', desde)
      .order('fecha', { ascending: true })
      .order('id', { ascending: true })
      .range(a, b)
  )

  const inventario = await fetchAll<SnapshotInventario>((a, b) =>
    service
      .from('amazon_snapshots_inventario')
      .select('*')
      .eq('selling_partner_id', connection.selling_partner_id)
      .eq('marketplace_id', params.marketplaceId)
      .eq('sku', params.sku)
      .gte('fecha', desde)
      .order('fecha', { ascending: true })
      .order('id', { ascending: true })
      .range(a, b)
  )

  return { listing, connection, bsr, inventario, dias }
}
