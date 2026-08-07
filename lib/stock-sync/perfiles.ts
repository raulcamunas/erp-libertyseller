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

export interface PerfilesView {
  perfiles: StockReadProfile[]
  /** Los clientes del módulo de sincronismo; el perfil cuelga de uno */
  clientes: StockClient[]
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
}

const RUNS_RECIENTES = 40

export async function loadPerfiles(): Promise<PerfilesView> {
  const service = createServiceClient()

  const vacio: PerfilesView = {
    perfiles: [],
    clientes: [],
    conexiones: [],
    conectores: conectoresPublicos(),
    runs: [],
    missingTables: true,
    driveEmail: driveServiceAccountEmail(),
    driveConfigurado: isDriveConfigured(),
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

    return {
      perfiles,
      clientes,
      conexiones,
      conectores: conectoresPublicos(),
      runs: (runs ?? []) as StockProfileRun[],
      missingTables: false,
      driveEmail: vacio.driveEmail,
      driveConfigurado: vacio.driveConfigurado,
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
 */
export async function perfilesDelCiclo(): Promise<StockReadProfile[]> {
  const service = createServiceClient()
  return fetchAll<StockReadProfile>((a, b) =>
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
}
