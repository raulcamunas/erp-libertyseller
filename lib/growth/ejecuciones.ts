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
import type { AmazonSubmission } from '@/lib/types/amazon'
import type { StockProfileRun } from '@/lib/types/stock-sync'

/**
 * Cuántas ejecuciones se traen de entrada.
 *
 * A cuatro por hora, 200 son unas dos jornadas de un cliente activo. Más no
 * cabe en una pantalla y se pagaría en cada carga del submódulo.
 */
export const EJECUCIONES_LIMITE = 200

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
