/**
 * LOS PERFILES DE LECTURA: acceso a datos.
 *
 * Aquí vive todo lo que toca `stock_read_profiles` y `stock_profile_runs`. El
 * lector, las reglas, los frenos y el simulacro no saben que existe Postgres, y
 * este fichero es la razón: es el único sitio que traduce entre las filas de la
 * base y las estructuras puras.
 *
 * TODO CON service_role Y DESPUÉS DE HABER COMPROBADO EL ROL. La migración 120
 * deja estas tablas sin GRANT de escritura para `authenticated`, así que la
 * pantalla NO puede escribir directamente: pasa por las rutas de
 * /api/amazon/perfiles, que llaman a requireAmazonAdmin() antes de llegar aquí.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { driveServiceAccountEmail, isDriveConfigured } from '@/lib/google-drive'
import type { StockClient, StockProfileRun, StockReadProfile } from '@/lib/types/stock-sync'
import { conectoresPublicos, type ConectorPublico } from './origenes'

/** Supabase corta cualquier consulta a 1000 filas y un .limit() mayor NO lo salta */
const PAGE = 1000

/**
 * Copia deliberada de la de lib/employees/data.ts (la canónica) en vez de
 * importarla, por lo mismo que la de lib/amazon/data.ts: aquel módulo arrastra
 * el cálculo de nóminas entero y este no tiene por qué depender de él para
 * paginar.
 *
 * El orden lo fija quien llama y tiene que terminar SIEMPRE en una columna
 * única: .range() sobre un orden con empates repite filas o se las salta.
 */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    // No se hace `break`: quedarse a medias devolvería media lista sin dar
    // error visible, y media lista es indistinguible de una lista entera.
    if (error) throw error
    const chunk = (data as T[]) ?? []
    out.push(...chunk)
    if (chunk.length < PAGE) break
  }
  return out
}

/** Distingue «la migración no está lanzada» de cualquier otro error */
export function isMissingSchema(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return (
    code === 'PGRST205' || // PostgREST: la tabla no está en su caché de esquema
    code === '42P01' || //    Postgres: undefined_table
    code === 'PGRST204' || // PostgREST: la columna no está en su caché
    code === '42703' //       Postgres: undefined_column
  )
}

/* ------------------------------------------------------------------ */
/* Lo que necesita la pantalla                                         */
/* ------------------------------------------------------------------ */

/**
 * Una conexión de Amazon, RECORTADA a lo que hace falta para elegir destino.
 *
 * Lista de columnas explícita y escrita a mano: un `select('*')` sobre
 * amazon_connections metería `refresh_token_enc` en la respuesta que va al
 * navegador. Va cifrado, pero un ciphertext en el navegador es material que no
 * tiene ninguna razón para salir del servidor.
 */
export interface DestinoAmazon {
  id: string
  client_id: string
  name: string
  marketplace_ids: string[]
  default_marketplace_id: string | null
  status: string
  is_active: boolean
}

const DESTINO_FIELDS =
  'id, client_id, name, marketplace_ids, default_marketplace_id, status, is_active'

/**
 * UN CLIENTE QUE ESTÁ EN AMAZON PERO TODAVÍA NO EN EL SINCRONISMO.
 *
 * No tiene fila en `stock_clients`, así que no tiene id de sincronismo: lo único
 * que se puede usar para identificarlo es el SLUG, que es lo que comparten las
 * dos tablas (la 118 dice literalmente «misma forma que stock_clients.slug»).
 *
 * Existe porque la pestaña Origen tiene que poder decir «a este cliente NO le
 * hace falta sincronizar», y antes no podía: la lista salía solo de
 * `stock_clients`, así que un cliente que únicamente estaba en Amazon no
 * aparecía. Y a la vez Growth Partner le enlazaba aquí —«si el suyo tiene que
 * llegar, se dice en Amazon API · Origen»—, o sea que el enlace llevaba a una
 * lista donde ese cliente no estaba. Callejón sin salida.
 */
export interface ClienteSinAlta {
  slug: string
  name: string
  is_active: boolean
}

export interface PerfilesView {
  perfiles: StockReadProfile[]
  /** Los clientes del módulo de sincronismo; el perfil cuelga de uno */
  clientes: StockClient[]
  /**
   * Los que están en `amazon_clients` y NO en `stock_clients`.
   *
   * Se devuelven aparte y no mezclados en `clientes` a propósito: no tienen id
   * de sincronismo, y meterlos con un id inventado haría que la pantalla les
   * ofreciera botones que escriben contra una fila que no existe.
   */
  clientesSinAlta: ClienteSinAlta[]
  conexiones: DestinoAmazon[]
  conectores: ConectorPublico[]
  /** Últimas ejecuciones, para la pestaña de historial */
  runs: StockProfileRun[]
  /** Falta lanzar la migración 120 */
  missingTables: boolean
  /**
   * El correo con el que hay que compartir la carpeta de Drive. Se enseña en la
   * pantalla porque es el dato que hace falta ANTES de que nada funcione, y
   * pedirlo por chat cada vez es cómo se pierde media tarde.
   */
  driveEmail: string | null
  driveConfigurado: boolean
  /**
   * QUIÉN DECIDIÓ QUE UN CLIENTE NO SINCRONIZA: id de perfil -> nombre.
   *
   * Se resuelve aquí y no con un JOIN porque `profiles` no tiene relación
   * declarada con `stock_clients` en PostgREST, y son dos o tres nombres.
   *
   * Un id que no esté en este mapa NO es un error: es alguien que ya no está en
   * el ERP. La clave ajena es ON DELETE SET NULL, así que en ese caso la fecha y
   * el motivo —que es lo que de verdad se consulta— siguen ahí.
   */
  decididoPor: Record<string, string>
  /**
   * Falta lanzar la migración 127, la de «este cliente no sincroniza».
   *
   * Va aparte de `missingTables` porque el módulo funciona entero sin ella: lo
   * único que no se puede es tomar esa decisión. Cortar la pantalla por esto
   * dejaría sin orígenes a quien solo quiere tocar un perfil.
   */
  faltaMigracionNoSincroniza: boolean
}

const RUNS_RECIENTES = 40

export async function loadPerfiles(): Promise<PerfilesView> {
  const service = createServiceClient()

  const vacio: PerfilesView = {
    perfiles: [],
    clientes: [],
    clientesSinAlta: [],
    conexiones: [],
    conectores: conectoresPublicos(),
    runs: [],
    missingTables: true,
    driveEmail: driveServiceAccountEmail(),
    driveConfigurado: isDriveConfigured(),
    decididoPor: {},
    faltaMigracionNoSincroniza: false,
  }

  try {
    const perfiles = await fetchAll<StockReadProfile>((a, b) =>
      service
        .from('stock_read_profiles')
        .select('*')
        .order('position', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true })
        .order('id')
        .range(a, b)
    )

    const clientes = await fetchAll<StockClient>((a, b) =>
      service
        .from('stock_clients')
        .select('*')
        .order('position', { ascending: true, nullsFirst: false })
        .order('name', { ascending: true })
        .order('id')
        .range(a, b)
    )

    const conexiones = await fetchAll<DestinoAmazon>((a, b) =>
      service
        .from('amazon_connections')
        .select(DESTINO_FIELDS)
        .order('name', { ascending: true })
        .order('id')
        .range(a, b)
    )

    const { data: runs, error: errorRuns } = await service
      .from('stock_profile_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .order('id')
      .limit(RUNS_RECIENTES)
    if (errorRuns) throw errorRuns

    /**
     * ¿Está la 127 lanzada?
     *
     * Se mira en la FILA y no con una consulta al catálogo de Postgres: el
     * `select('*')` de arriba trae las columnas que existan, así que si la clave
     * no viene en ninguna fila es que la migración no está. Sin clientes no se
     * puede saber, y da igual: sin clientes no hay nada que marcar.
     */
    const faltaMigracionNoSincroniza =
      clientes.length > 0 && !('no_sincroniza_desde' in (clientes[0] as object))

    /**
     * Los clientes que solo están en Amazon, cruzados POR SLUG.
     *
     * Que `amazon_clients` no exista todavía no es un fallo de esta pantalla:
     * son dos módulos distintos con dos migraciones distintas, y el sincronismo
     * funcionaba antes de que existiera Amazon API. Si la tabla no está, esta
     * lista sale vacía y todo lo demás sigue igual.
     */
    const yaDadosDeAlta = new Set(clientes.map((c) => c.slug))
    let clientesSinAlta: ClienteSinAlta[] = []
    try {
      const deAmazon = await fetchAll<{ name: string; slug: string; is_active: boolean }>((a, b) =>
        service
          .from('amazon_clients')
          .select('name, slug, is_active')
          .order('name', { ascending: true })
          .range(a, b)
      )
      clientesSinAlta = deAmazon
        .filter((c) => !yaDadosDeAlta.has(c.slug))
        .map((c) => ({ slug: c.slug, name: c.name, is_active: c.is_active }))
    } catch (error) {
      if (!isMissingSchema(error)) throw error
    }

    return {
      perfiles,
      clientes,
      clientesSinAlta,
      conexiones,
      conectores: conectoresPublicos(),
      runs: (runs ?? []) as StockProfileRun[],
      missingTables: false,
      driveEmail: vacio.driveEmail,
      driveConfigurado: vacio.driveConfigurado,
      decididoPor: await nombresDeQuienDecidio(clientes),
      faltaMigracionNoSincroniza,
    }
  } catch (error) {
    // La migración se lanza a mano en el editor SQL de Supabase, así que el
    // código puede llegar desplegado antes que ella. Se devuelve como DATO para
    // que la pantalla pueda explicar qué fichero hay que pegar, en vez de
    // reventar con una pantalla negra.
    if (isMissingSchema(error)) return vacio
    throw error
  }
}

/**
 * Los nombres de quien decidió que un cliente no sincroniza.
 *
 * Gemela de loadSubmissionAuthors() de lib/amazon/data.ts, y copiada en vez de
 * importada por lo mismo que el resto de este fichero no importa de allí: aquel
 * módulo arrastra el cliente de la SP-API entero y este no tiene por qué
 * depender de él para resolver dos nombres.
 *
 * NUNCA LANZA. Que no se pueda leer un nombre no puede tumbar la pantalla de
 * orígenes: sin el nombre la decisión se sigue leyendo —queda la fecha y el
 * motivo— y con una excepción no se lee nada.
 */
async function nombresDeQuienDecidio(clientes: StockClient[]): Promise<Record<string, string>> {
  const ids = Array.from(
    new Set(
      clientes.map((c) => c.no_sincroniza_por).filter((v): v is string => typeof v === 'string')
    )
  )
  if (ids.length === 0) return {}

  try {
    const service = createServiceClient()
    const { data, error } = await service
      .from('profiles')
      .select('id, full_name, email')
      .in('id', ids)
    if (error) throw error

    const out: Record<string, string> = {}
    for (const p of (data ?? []) as Array<{
      id: string
      full_name: string | null
      email: string | null
    }>) {
      // Mismo orden de preferencia que en el historial de cambios y en
      // vacaciones: el nombre y, si no hay, el correo. Nunca el UUID.
      out[p.id] = p.full_name || p.email || 'Alguien que ya no está en el ERP'
    }
    return out
  } catch (error) {
    console.error('No se han podido resolver los nombres de las decisiones de sincronización:', error)
    return {}
  }
}

/**
 * MARCA O DESMARCA «ESTE CLIENTE NO HACE SINCRONIZACIÓN DE STOCK».
 *
 * Las tres columnas se escriben SIEMPRE JUNTAS, incluso al desmarcar, y no es
 * celo: la migración 127 lleva un CHECK que exige que motivo y autor solo
 * existan si hay fecha. Escribir la fecha a null y dejarse el motivo deja un
 * texto —«no tiene ERP»— colgado de un cliente que sí sincroniza, y ese texto se
 * lee meses después como si siguiera vigente. El CHECK lo impediría con un error
 * de Postgres; hacerlo bien aquí evita tener que traducirlo.
 *
 * LOS PERFILES DEL CLIENTE NO SE TOCAN. Un cliente puede dejar de sincronizar
 * tres meses y volver; tirar su configuración de columnas para ahorrar una fila
 * es un mal negocio. Quien se los salta es el ciclo (perfilesDelCiclo).
 */
export async function marcarNoSincroniza(
  clientId: string,
  opciones: {
    /** true = no se le sincroniza; false = vuelve a la normalidad */
    noSincroniza: boolean
    /** Por qué. Solo se guarda al marcar */
    motivo: string | null
    /** Quién lo decide. profiles.id de quien ha hecho la llamada */
    porUsuario: string | null
  }
): Promise<void> {
  const service = createServiceClient()

  const cambios = opciones.noSincroniza
    ? {
        no_sincroniza_desde: new Date().toISOString(),
        no_sincroniza_motivo: opciones.motivo,
        no_sincroniza_por: opciones.porUsuario,
      }
    : { no_sincroniza_desde: null, no_sincroniza_motivo: null, no_sincroniza_por: null }

  const { error } = await service.from('stock_clients').update(cambios).eq('id', clientId)

  if (error) {
    // El caso frecuente el primer día: el código desplegado y la migración sin
    // pegar en el editor de Supabase. El error de PostgREST dice «column does
    // not exist», que no le sirve a nadie.
    if (isMissingSchema(error)) {
      throw new Error(
        'Falta lanzar 127_origenes_no_sincroniza.sql en el editor SQL de Supabase: sin esas columnas no hay dónde apuntar la decisión.'
      )
    }
    throw error
  }
}

/**
 * DA DE ALTA EN EL SINCRONISMO A UN CLIENTE QUE SOLO ESTABA EN AMAZON.
 *
 * Devuelve el id de su fila en `stock_clients`, creándola si no la había.
 *
 * ============ POR QUÉ SE CREA LA FILA Y NO SE PIDE QUE LA CREEN ANTES ============
 *
 * Porque la decisión que se quiere tomar es «a este cliente NO le hace falta
 * sincronizar», y obligar a darlo de alta en el sincronismo para poder decir que
 * no sincroniza es pedirle a alguien que haga justo lo contrario de lo que ha
 * decidido. La fila no significa «le mandamos stock»: significa «alguien ha
 * mirado esto». Lo que significa que sí se le manda es tener un perfil activo.
 *
 * NO SE INVENTA NADA: el nombre y el slug se copian de `amazon_clients`, que es
 * la misma identidad —las dos tablas comparten la forma del slug a propósito— y
 * el cruce por slug es el que ya usa Growth Partner. Si la fila ya existe, no se
 * toca: esto es idempotente y no pisa un nombre que alguien haya corregido a
 * mano en el sincronismo.
 */
export async function altaDesdeAmazon(slug: string): Promise<string> {
  const service = createServiceClient()

  const { data: yaEsta, error: errorBusca } = await service
    .from('stock_clients')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()
  if (errorBusca) throw errorBusca
  if (yaEsta) return yaEsta.id

  const { data: enAmazon, error: errorAmazon } = await service
    .from('amazon_clients')
    .select('name, slug, is_active')
    .eq('slug', slug)
    .maybeSingle()
  if (errorAmazon) throw errorAmazon
  if (!enAmazon) {
    throw new Error('Ese cliente no existe en Amazon API, así que no hay identidad que copiar.')
  }

  const { data: creado, error: errorCrea } = await service
    .from('stock_clients')
    .insert({ name: enAmazon.name, slug: enAmazon.slug, is_active: enAmazon.is_active })
    .select('id')
    .single()
  if (errorCrea) throw errorCrea
  return creado.id
}

/** Un perfil suelto. null si ya no existe */
export async function loadPerfil(id: string): Promise<StockReadProfile | null> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('stock_read_profiles')
    .select('*')
    // maybeSingle() y no single(): un perfil que no existe es un 404 con
    // mensaje, no la excepción de «se esperaba una fila» que acaba en 500.
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as StockReadProfile | null) ?? null
}

/**
 * El perfil de EAN del mismo cliente, si lo tiene.
 *
 * Sin él el cruce pierde la vía 'ean_erp' ENTERA, que es la que desempata las
 * referencias que solo se diferencian en los ceros a la izquierda. Con los datos
 * reales de Shoplamp esa vía casa 245 de 395 filas: no es un extra.
 */
export async function loadPerfilEan(clientId: string): Promise<StockReadProfile | null> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('stock_read_profiles')
    .select('*')
    .eq('client_id', clientId)
    .eq('tipo', 'ean')
    .eq('is_active', true)
    .order('position', { ascending: true, nullsFirst: false })
    .order('id')
    .limit(1)
  if (error) throw error
  return ((data ?? [])[0] as StockReadProfile | undefined) ?? null
}

/* ------------------------------------------------------------------ */
/* Escritura                                                           */
/* ------------------------------------------------------------------ */

/**
 * Valores de fábrica de un perfil nuevo.
 *
 * Los alias de columna NO se dejan vacíos aunque la base solo exija que haya
 * alguno: un perfil recién creado tiene que poder leer un fichero normal a la
 * primera para que la pantalla de «Probar» sirva desde el minuto uno. Estos son
 * los nombres que usan los ERP españoles que ya hemos visto; quien dé de alta un
 * cliente los ajusta con el fichero delante.
 *
 * Y los frenos vienen puestos por la migración (20% / 30% / 15%): un perfil
 * nuevo nace FRENADO, no suelto.
 */
export function perfilNuevo(params: {
  clientId: string
  nombre: string
  slug: string
  tipo: 'stock' | 'ean'
}): Record<string, unknown> {
  const comun = {
    client_id: params.clientId,
    name: params.nombre,
    slug: params.slug,
    tipo: params.tipo,
    origen: 'manual',
    origen_config: {},
    col_referencia: ['Articulo', 'Cod.Articulo', 'Codigo articulo', 'Referencia', 'SKU'],
  }

  if (params.tipo === 'ean') {
    return {
      ...comun,
      col_ean: ['Codigo de Barras', 'Codigo barras', 'EAN', 'GTIN'],
      col_tipo: ['Tipo'],
    }
  }

  return {
    ...comun,
    col_stock: ['St. Real', 'St.Real', 'Stock real', 'Stock', 'Existencias', 'Unidades'],
    col_descripcion: ['Descrip.Propia', 'Descripcion', 'Descripción', 'Nombre'],
  }
}

/**
 * Columnas que la pantalla puede escribir.
 *
 * LISTA BLANCA Y NO LISTA NEGRA, que es lo que evita el problema de verdad: el
 * cuerpo de la petición llega del navegador, y sin esto un `id`, un `client_id`
 * o un `last_ok_at` colados en el JSON se escribirían tal cual. Con lista negra,
 * cada columna nueva que se añada a la tabla nace escribible por olvido.
 */
const CAMPOS_EDITABLES = new Set([
  'name',
  'slug',
  'tipo',
  'origen',
  'origen_config',
  'formato',
  'csv_separador',
  'csv_codificacion',
  'hoja',
  'hoja_indice',
  'fila_cabecera',
  'fila_datos',
  'col_referencia',
  'col_stock',
  'col_precio',
  'col_precio_respaldo',
  'col_coste',
  'col_ean',
  'col_descripcion',
  'col_familia',
  'col_tipo',
  'ean_solo_tipo',
  'reserva_unidades',
  'stock_minimo',
  'max_unidades',
  'fichero_parcial',
  'precio_modo',
  'margen_porcentaje',
  'iva_porcentaje',
  'precio_minimo',
  'precio_maximo',
  'moneda',
  'familias_excluidas',
  'referencias_excluidas',
  'enviar_stock',
  'enviar_precio',
  'connection_id',
  'marketplace_id',
  'freno_pct_a_cero',
  'freno_variacion_precio_pct',
  'freno_caida_lineas_pct',
  'freno_max_cambios',
  'lineas_referencia',
  'envio_automatico',
  'cadencia_minutos',
  'is_active',
  'position',
  'notes',
])

/** Se queda solo con lo que la pantalla puede tocar */
export function filtrarCampos(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [clave, valor] of Object.entries(patch)) {
    if (CAMPOS_EDITABLES.has(clave)) out[clave] = valor
  }
  return out
}

export async function crearPerfil(fila: Record<string, unknown>): Promise<StockReadProfile> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('stock_read_profiles')
    .insert(fila)
    .select('*')
    .single()
  if (error) throw error
  return data as StockReadProfile
}

export async function actualizarPerfil(
  id: string,
  patch: Record<string, unknown>
): Promise<StockReadProfile | null> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('stock_read_profiles')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle()
  if (error) throw error
  return (data as StockReadProfile | null) ?? null
}

export async function borrarPerfil(id: string): Promise<boolean> {
  const service = createServiceClient()
  // .select() para saber si ha borrado de verdad: con RLS, un borrado sin
  // permiso no da error, simplemente no borra nada.
  const { data, error } = await service
    .from('stock_read_profiles')
    .delete()
    .eq('id', id)
    .select('id')
  if (error) throw error
  return (data ?? []).length > 0
}

/* ------------------------------------------------------------------ */
/* Ejecuciones                                                         */
/* ------------------------------------------------------------------ */

/**
 * Deja constancia de una lectura, se haya mandado algo o no.
 *
 * NUNCA LANZA. Es lo último que pasa en el proceso y ya se ha hecho el trabajo:
 * que no se pueda escribir el registro no puede convertir un simulacro correcto
 * en un error en pantalla. Se avisa por consola y se sigue.
 */
export async function registrarRun(fila: Record<string, unknown>): Promise<string | null> {
  const service = createServiceClient()

  const insertar = async (payload: Record<string, unknown>) => {
    const { data, error } = await service
      .from('stock_profile_runs')
      .insert(payload)
      .select('id')
      .single()
    if (error) throw error
    return (data as { id: string }).id
  }

  try {
    return await insertar(fila)
  } catch (error) {
    /**
     * LA 122 SE LANZA A MANO EN SUPABASE, ASÍ QUE EL CÓDIGO PUEDE LLEGAR ANTES.
     *
     * Y si llega antes, esta fila se cae por una columna que todavía no existe
     * (`avisos`) o por un código de freno que el CHECK viejo no conoce
     * ('caida_unidades'). Perder la fila entera por eso es lo peor que puede
     * pasar aquí: es el único sitio donde consta que el sistema paró y por qué.
     * Se reintenta sin lo nuevo, que da una fila con menos detalle pero da una
     * fila.
     */
    const codigo = (error as { code?: string } | null)?.code
    const faltaEsquema = isMissingSchema(error)
    const chequeoViolado = codigo === '23514'

    if (faltaEsquema || chequeoViolado) {
      const { avisos, ...sinAvisos } = fila
      const reducida = { ...sinAvisos }
      if (chequeoViolado && reducida.freno === 'caida_unidades') {
        // El CHECK viejo no conoce este código. Se guarda el freno como el que
        // más se le parece de los que sí existen y la frase entera, que es lo
        // que de verdad se lee, queda intacta en freno_detalle.
        reducida.freno = 'max_cambios'
      }
      void avisos

      try {
        const id = await insertar(reducida)
        console.warn(
          'La ejecución se ha registrado SIN los campos nuevos: falta lanzar ' +
            '122_stock_frenos_fixes.sql en el editor SQL de Supabase.'
        )
        return id
      } catch (segundo) {
        console.error('No se ha podido registrar la ejecución del perfil:', segundo)
        return null
      }
    }

    console.error('No se ha podido registrar la ejecución del perfil:', error)
    return null
  }
}

/** Las ejecuciones de UN perfil, de la más reciente a la más antigua */
export async function runsDePerfil(
  profileId: string,
  limite = RUNS_RECIENTES
): Promise<StockProfileRun[]> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('stock_profile_runs')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    // El desempate por id no es cosmético: dos ejecuciones del mismo segundo
    // —pasa cuando el ciclo procesa y el envío falla rápido— saldrían en un
    // orden distinto en cada recarga de la pantalla.
    .order('id', { ascending: false })
    .limit(limite)
  if (error) throw error
  return (data ?? []) as StockProfileRun[]
}

/**
 * Marca el resultado del último intento en el propio perfil.
 *
 * NUNCA LANZA, y por eso devuelve si lo consiguió: quien escribe la huella del
 * fichero DESPUÉS de enviar necesita saberlo. Si esa escritura falla en
 * silencio, la pasada siguiente encuentra una huella distinta, reprocesa el
 * mismo fichero y vuelve a llamar a sendChanges con los mismos cambios. Los
 * valores son absolutos, así que lo publicado no cambia, pero se duplican las
 * filas del historial de Amazon, se gasta cupo de todos los clientes y quedan
 * dos lotes idénticos sin ninguna explicación.
 */
export async function marcarPerfil(
  id: string,
  patch: {
    last_run_at?: string
    last_ok_at?: string | null
    last_error?: string | null
    last_file_fingerprint?: string | null
    last_skipped_at?: string | null
    last_skip_reason?: string | null
    lineas_referencia?: number | null
  }
): Promise<boolean> {
  try {
    const service = createServiceClient()
    const { error } = await service.from('stock_read_profiles').update(patch).eq('id', id)
    if (error) throw error
    return true
  } catch (error) {
    console.error('No se ha podido actualizar el estado del perfil:', error)
    return false
  }
}

/* ------------------------------------------------------------------ */
/* El cerrojo del ciclo automático                                     */
/* ------------------------------------------------------------------ */

/**
 * Intenta quedarse un perfil. Devuelve true solo si lo ha conseguido.
 *
 * SON DOS PASOS Y EL SEGUNDO ES EL QUE MANDA:
 *
 *   1. Recoger el cerrojo si está ABANDONADO. `caducadoAntes` es la fecha a
 *      partir de la cual se da por muerto el que lo tenía. Sin esto, un
 *      contenedor que se reinicia a mitad de proceso deja ese perfil congelado
 *      PARA SIEMPRE y nadie se entera, porque un perfil que no se procesa no da
 *      ningún error: el stock del cliente simplemente se queda viejo.
 *      Este paso es idempotente: que lo hagan dos a la vez da igual.
 *
 *   2. Cogerlo si está libre. ES UN ÚNICO UPDATE CONDICIONAL, y ahí está toda
 *      la garantía. Un UPDATE es atómico, y en READ COMMITTED el segundo que
 *      llega se queda esperando el bloqueo de fila y RE-EVALÚA su WHERE contra
 *      la versión ya escrita: encuentra `running_since` puesto y actualiza cero
 *      filas. Que vuelva o no vuelva fila es la respuesta, sin carreras.
 *
 * Leer primero y escribir después —el `if (!perfil.running_since) tomar()` que
 * pide el cuerpo— es exactamente el error que esto evita: entre la lectura y la
 * escritura cabe la otra ejecución entera.
 *
 * Los dos pasos usan filtros simples en vez de un `.or()` con una fecha dentro:
 * una marca de tiempo ISO lleva puntos y dos puntos, que son separadores en la
 * sintaxis de filtros de PostgREST, y un filtro mal interpretado aquí no daría
 * error — devolvería siempre «no lo he conseguido» y el ciclo no procesaría
 * nunca nada.
 */
export async function tomarCerrojo(
  profileId: string,
  token: string,
  ahora: Date,
  caducadoAntes: Date
): Promise<boolean> {
  const service = createServiceClient()

  const { error: errorCaducado } = await service
    .from('stock_read_profiles')
    .update({ running_since: null, running_token: null })
    .eq('id', profileId)
    .lt('running_since', caducadoAntes.toISOString())
  if (errorCaducado) throw errorCaducado

  const { data, error } = await service
    .from('stock_read_profiles')
    .update({ running_since: ahora.toISOString(), running_token: token })
    .eq('id', profileId)
    .is('running_since', null)
    .select('id')

  if (error) throw error
  return (data ?? []).length > 0
}

/**
 * Suelta el cerrojo, y SOLO SI SIGUE SIENDO SUYO.
 *
 * El `.eq('running_token', token)` es lo que hace que una ejecución que se
 * quedó colgada —y a la que ya le robaron el cerrojo por caducado— no le abra
 * la puerta a nadie al terminar tarde: soltaría un cerrojo que ahora tiene otro
 * y acabarían dos procesando el mismo perfil, que es justo lo que el cerrojo
 * existe para impedir.
 *
 * NUNCA LANZA: si esto fallara y se propagara, el error taparía el de la
 * ejecución, que es el que explica lo que pasó de verdad. Un cerrojo que no se
 * suelta se acaba soltando solo por caducidad.
 */
export async function soltarCerrojo(profileId: string, token: string): Promise<void> {
  try {
    const service = createServiceClient()
    const { error } = await service
      .from('stock_read_profiles')
      .update({ running_since: null, running_token: null })
      .eq('id', profileId)
      .eq('running_token', token)
    if (error) throw error
  } catch (error) {
    console.error('No se ha podido soltar el cerrojo del perfil:', error)
  }
}

/**
 * Los perfiles que el ciclo automático tiene que mirar.
 *
 * Los de subida a mano quedan fuera por definición: no hay de dónde traer nada
 * sin una persona delante. Los de tipo 'ean' también, y no es un olvido: el
 * fichero de códigos de barras no se procesa por su cuenta, lo lee el perfil de
 * stock del mismo cliente como apoyo del cruce.
 *
 * El orden es por `last_run_at` ascendente con los nulos primero: el que lleva
 * más tiempo sin mirarse va delante. Con eso, si una pasada se queda sin tiempo
 * y deja perfiles sin tocar, la siguiente empieza por ellos y ninguno se queda
 * atrás indefinidamente.
 *
 * Y QUEDAN FUERA LOS CLIENTES MARCADOS COMO «NO SINCRONIZA» (migración 127). Es
 * lo que convierte esa marca en una decisión de verdad y no en una etiqueta de
 * pantalla: sin este filtro, marcar un cliente cuya configuración se conserva
 * —que es lo que se conserva a propósito— seguiría mandándole stock a Amazon
 * cada cuarto de hora mientras la pantalla dice que no.
 */
export async function perfilesDelCiclo(): Promise<StockReadProfile[]> {
  const service = createServiceClient()

  const perfiles = await fetchAll<StockReadProfile>((a, b) =>
    service
      .from('stock_read_profiles')
      .select('*')
      .eq('is_active', true)
      .eq('tipo', 'stock')
      .neq('origen', 'manual')
      .order('last_run_at', { ascending: true, nullsFirst: true })
      .order('id')
      .range(a, b)
  )
  if (perfiles.length === 0) return perfiles

  const excluidos = await clientesQueNoSincronizan()
  return excluidos.size === 0 ? perfiles : perfiles.filter((p) => !excluidos.has(p.client_id))
}

/**
 * Los clientes a los que se ha decidido no sincronizarles el stock.
 *
 * SI FALLA, DEVUELVE EL CONJUNTO VACÍO Y LO DEJA DICHO EN EL REGISTRO. La
 * alternativa —propagar— dejaría el ciclo entero parado cada cuarto de hora
 * porque la migración 127 todavía no está pegada, y eso son dieciséis clientes
 * sin stock por una columna que solo afecta a los que se hubieran marcado, que
 * mientras la migración no exista son cero.
 *
 * Es un fallo hacia el lado seguro EN ESTE CASO CONCRETO, y conviene saber por
 * qué: hasta que la 127 esté lanzada nadie ha podido marcar a nadie, así que la
 * respuesta honesta y la respuesta vacía coinciden. Con la migración puesta, un
 * fallo de esta consulta ya no es «no hay marcados» y por eso deja rastro.
 */
async function clientesQueNoSincronizan(): Promise<Set<string>> {
  try {
    const service = createServiceClient()
    const { data, error } = await service
      .from('stock_clients')
      .select('id')
      .not('no_sincroniza_desde', 'is', null)
    if (error) throw error
    return new Set((data ?? []).map((c) => (c as { id: string }).id))
  } catch (error) {
    if (isMissingSchema(error)) {
      // Sin la 127 no hay nadie marcado. Ni una línea de registro: sería un
      // error cada quince minutos de algo que ya se sabe, y un error repetido
      // acaba tapando los de verdad.
      return new Set()
    }
    console.error(
      '[stock-sync] no se ha podido leer qué clientes están excluidos de la sincronización; esta pasada los trata a todos como incluidos:',
      error
    )
    return new Set()
  }
}
