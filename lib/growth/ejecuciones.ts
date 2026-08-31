/**
 * EL HISTORIAL DE EJECUCIONES DE UN CLIENTE
 * =========================================
 * SOLO SERVIDOR: importa el cliente de service_role.
 *
 * Qué se ha ejecutado, cuándo, y QUÉ VALOR CAMBIÓ EN CADA SKU — el de antes y
 * el de después.
 *
 *
 * ============ POR QUÉ ESTO SUSTITUYE A LA PANTALLA DE ANTES ============
 *
 * El submódulo enseñaba a todos los clientes la pantalla de SUBIR EL VOLCADO A
 * MANO y la tabla de mapeo. Eso es la forma de trabajar de UN cliente —el que
 * tiene su diccionario referencia→SKU importado a mano— y de una época en la
 * que el stock se subía dos veces por semana pulsando un botón.
 *
 * Ya no. El ciclo entra cada quince minutos, lee el fichero del origen, cruza y
 * manda. Nadie pulsa nada. Con esa pantalla delante, la pregunta que no tenía
 * respuesta era la única que importa: ¿qué le ha hecho el ERP a la cuenta de
 * este cliente hoy? Se veía un formulario para hacer algo que ya se estaba
 * haciendo solo.
 *
 *
 * ============ LAS DOS TABLAS Y POR QUÉ HACEN FALTA LAS DOS ============
 *
 *   stock_profile_runs  — UNA FILA POR LECTURA de fichero, se mande o no. Es la
 *     ejecución: cuándo, qué fichero, cuánto tardó, si frenó y por qué. Aquí
 *     están también las que NO mandaron nada, que son justo las que hay que
 *     poder ver: una ejecución frenada tres días seguidos no aparece en ningún
 *     sitio si solo se miran los cambios.
 *
 *   amazon_submissions  — UNA FILA POR CAMBIO enviado a Amazon, con
 *     `previous_value` y `new_value`. Es el «de 12 a 402» de un SKU concreto.
 *
 * Se unen por `batch_id`: el motor lo genera al mandar y lo escribe en las dos.
 * Una ejecución sin `batch_id` es una que no llegó a enviar, y eso no es un
 * agujero de datos sino la respuesta.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/stock-sync/perfiles'
import type { AmazonSubmission } from '@/lib/types/amazon'
import type { StockProfileRun } from '@/lib/types/stock-sync'

/**
 * Cuántas ejecuciones se traen de entrada.
 *
 * A cuatro por hora, 200 son unas dos jornadas de un cliente activo. Más no
 * cabe en una pantalla y se pagaría en cada carga del submódulo.
 */
/**
 * Cuántas pasadas se traen a la pantalla.
 *
 * Sube de 200 a 400 por el mismo cambio que hace que se apunten todas: a media
 * hora de cadencia son 48 filas diarias por cliente, así que 200 se quedaban en
 * cuatro días de historial cuando antes daban para semanas. Con 400 vuelven a
 * ser ocho días largos, y para un cliente que manda fichero dos veces por semana
 * siguen siendo meses.
 */
export const EJECUCIONES_LIMITE = 400

/** Cambios de un lote. Un envío grande son cientos; el tope evita el disgusto */
export const CAMBIOS_LIMITE = 2000

export interface EjecucionCliente extends StockProfileRun {
  /** El nombre del perfil de lectura, para cuando un cliente tiene más de uno */
  perfil_nombre: string | null
}

/**
 * Las ejecuciones de UN cliente, de la más reciente a la más vieja.
 *
 * Filtrado por `client_id` y nada más: los datos de un vendedor se usan
 * exclusivamente para operar su cuenta, así que aquí no hay ninguna consulta
 * que roce a otro ni que agregue entre varios.
 */
export async function ejecucionesDeCliente(
  clientId: string,
  limite: number = EJECUCIONES_LIMITE
): Promise<EjecucionCliente[]> {
  const service = createServiceClient()

  const { data, error } = await service
    .from('stock_profile_runs')
    .select('*, stock_read_profiles(name)')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    // El desempate termina en columna única: .order() sobre una fecha con
    // empates —y a cuatro ejecuciones por hora los hay— reparte las filas de
    // forma distinta en cada consulta.
    .order('id', { ascending: false })
    .limit(limite)

  if (error) throw error

  return (data ?? []).map((fila) => {
    const { stock_read_profiles: perfil, ...run } = fila as StockProfileRun & {
      stock_read_profiles: { name: string } | { name: string }[] | null
    }
    return {
      ...run,
      // PostgREST devuelve el objeto o un array de uno según cómo interprete la
      // relación, y esto ha cambiado entre versiones. Se aceptan las dos formas
      // en vez de fiarse de la de hoy.
      perfil_nombre: Array.isArray(perfil) ? (perfil[0]?.name ?? null) : (perfil?.name ?? null),
    }
  })
}

/**
 * Los cambios que salieron en un lote: SKU, campo, valor viejo y valor nuevo.
 *
 * SE FILTRA TAMBIÉN POR CLIENTE, aunque el `batch_id` sea único. No es
 * redundante por gusto: quien llama trae el batch de una lista que ya está
 * filtrada, y basta con un id copiado de otro sitio —una URL, una prueba— para
 * que esta función devuelva los cambios de OTRO vendedor. La comprobación va
 * aquí abajo, donde se toca la tabla, y no en quien llama, que puede olvidarla.
 *
 * El cruce con la conexión se hace por `stock_profile_runs`, que es quien sabe
 * de qué cliente era ese lote.
 */
export async function cambiosDeEjecucion(
  batchId: string,
  clientId: string,
  limite: number = CAMBIOS_LIMITE
): Promise<AmazonSubmission[]> {
  const service = createServiceClient()

  const { data: duenio, error: errorDuenio } = await service
    .from('stock_profile_runs')
    .select('id')
    .eq('batch_id', batchId)
    .eq('client_id', clientId)
    .limit(1)

  if (errorDuenio) throw errorDuenio
  // Ni un error ni una lista vacía: ese lote no es de este cliente y aquí se
  // acaba el viaje.
  if ((duenio ?? []).length === 0) return []

  const { data, error } = await service
    .from('amazon_submissions')
    .select('*')
    .eq('batch_id', batchId)
    .order('sku', { ascending: true })
    .order('field', { ascending: true })
    .limit(limite)

  if (error) throw error
  return (data ?? []) as AmazonSubmission[]
}

/** El estado VIVO de un perfil: qué está pasando ahora, no qué pasó */
export interface EstadoPerfil {
  id: string
  name: string
  is_active: boolean
  envio_automatico: boolean
  cadencia_minutos: number | null
  last_run_at: string | null
  last_ok_at: string | null
  last_error: string | null
  last_skipped_at: string | null
  last_skip_reason: string | null
}

/**
 * QUÉ ESTÁ PASANDO AHORA MISMO, que no es lo mismo que el historial.
 *
 * Y hace falta por un motivo concreto que costó una confusión: cuando un fallo
 * SE REPITE IGUAL, el ciclo lo reintenta en cada pasada pero NO escribe una fila
 * nueva —si no, con cadencia de quince minutos serían 96 filas idénticas al día
 * y el historial no contendría otra cosa—. Correcto para el historial, pero deja
 * la pantalla en un estado ambiguo: «no salen filas nuevas» y «se ha parado» se
 * ven exactamente igual, y lo primero que piensa quien lo mira es lo segundo.
 *
 * Estas columnas del perfil son las que sí se mueven en cada pasada, y son la
 * prueba de que el ciclo sigue entrando.
 */
export async function estadoDePerfiles(clientId: string): Promise<EstadoPerfil[]> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('stock_read_profiles')
    .select(
      'id, name, is_active, envio_automatico, cadencia_minutos, last_run_at, last_ok_at, last_error, last_skipped_at, last_skip_reason'
    )
    .eq('client_id', clientId)
    .eq('tipo', 'stock')
    .order('name')

  if (error) throw error
  return (data ?? []) as EstadoPerfil[]
}

/**
 * Si este cliente tiene tabla de mapeo importada a mano.
 *
 * Es lo que decide si se le enseña la pantalla de subida manual además del
 * historial. Hoy eso es UN cliente, y por eso se pregunta por el dato en vez de
 * escribir su nombre en el código: el día que otro importe su mapeo, le sale
 * sola; el día que ese deje de usarla, desaparece sin tocar nada.
 */
export async function tieneMapeoManual(clientId: string): Promise<boolean> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('stock_mappings')
    .select('id')
    .eq('client_id', clientId)
    .limit(1)

  if (error) throw error
  return (data ?? []).length > 0
}

/* ------------------------------------------------------------------ */
/* Las publicaciones de precio                                         */
/* ------------------------------------------------------------------ */

/** Un lote de precios publicado FUERA del ciclo de stock. Ver la migración 167 */
export interface LotePrecio {
  batch_id: string
  connection_id: string | null
  marketplace_id: string
  created_at: string
  source: string | null
  source_ref: string | null
  total: number
  aceptados: number
  fallidos: number
  pendientes: number
  primer_error: string | null
}

/**
 * LOS PRECIOS QUE SE PUBLICARON SIN PASAR POR EL CICLO DE STOCK.
 *
 * El historial de ejecuciones sale de `stock_profile_runs`, y los precios del
 * motor de Entrais no pasan por ahí: los manda directamente sendChanges(). O
 * sea que la pantalla enseñaba lo que el ERP le hacía al stock de un cliente y
 * no lo que le hacía a sus precios, que es la otra mitad.
 *
 *
 * ============ EL FILTRO POR CLIENTE VA POR CONEXIÓN, Y NO ES UN ATAJO ============
 *
 * `amazon_submissions` no guarda el cliente: guarda la CONEXIÓN de Amazon. Así
 * que primero se mira qué conexiones son de este cliente —por sus perfiles de
 * sincronismo— y solo después se piden los lotes de esas conexiones.
 *
 * Si el cliente no tiene ninguna, la respuesta es una lista vacía y NO una
 * consulta sin filtro. Es la diferencia entre no enseñar nada y enseñar los
 * precios de otro vendedor, que es justo lo que el compromiso con Amazon
 * prohíbe: los datos de un vendedor se usan para operar su cuenta y ninguna más.
 */
export async function publicacionesDePrecios(
  clientId: string,
  limite = 60
): Promise<LotePrecio[]> {
  const service = createServiceClient()

  const { data: perfiles, error: errorPerfiles } = await service
    .from('stock_read_profiles')
    .select('connection_id')
    .eq('client_id', clientId)
    .not('connection_id', 'is', null)

  if (errorPerfiles) throw errorPerfiles

  const conexiones = [
    ...new Set(
      (perfiles ?? [])
        .map((p) => (p as { connection_id: string | null }).connection_id)
        .filter((c): c is string => Boolean(c))
    ),
  ]
  if (conexiones.length === 0) return []

  const { data, error } = await service
    .from('amazon_lotes_precio')
    .select('*')
    .in('connection_id', conexiones)
    .order('created_at', { ascending: false })
    .limit(limite)

  if (error) {
    /**
     * La vista se lanza a mano en Supabase, así que el código puede llegar
     * antes. Sin esto, la pestaña entera de un cliente se caería con un 500 por
     * una sección que es un añadido. Se devuelve vacío y se avisa por consola.
     */
    if (isMissingSchema(error)) {
      console.warn(
        'No hay historial de precios: falta lanzar 167_lotes_de_precio.sql en el editor SQL.'
      )
      return []
    }
    throw error
  }

  return (data ?? []) as unknown as LotePrecio[]
}

/**
 * Los cambios de un lote de PRECIOS. Mismo papel que cambiosDeEjecucion(), pero
 * la propiedad se comprueba por conexión y no por `stock_profile_runs`, que es
 * justo la tabla por la que estos lotes no pasan.
 */
export async function cambiosDeLotePrecio(
  batchId: string,
  clientId: string,
  limite: number = CAMBIOS_LIMITE
): Promise<AmazonSubmission[]> {
  const service = createServiceClient()

  const { data: perfiles } = await service
    .from('stock_read_profiles')
    .select('connection_id')
    .eq('client_id', clientId)
    .not('connection_id', 'is', null)

  const conexiones = new Set(
    (perfiles ?? [])
      .map((p) => (p as { connection_id: string | null }).connection_id)
      .filter((c): c is string => Boolean(c))
  )
  if (conexiones.size === 0) return []

  const { data, error } = await service
    .from('amazon_submissions')
    .select('*')
    .eq('batch_id', batchId)
    .order('sku', { ascending: true })
    .limit(limite)

  if (error) throw error

  const filas = (data ?? []) as AmazonSubmission[]
  // La comprobación va aquí abajo, sobre lo que se ha leído: un batch_id copiado
  // de otro sitio devolvería los envíos de otro vendedor.
  if (filas.length > 0 && !conexiones.has(filas[0].connection_id ?? '')) return []
  return filas
}
