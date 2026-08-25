/**
 * ENTRAIS · LOS QUE NO SE PUEDEN VENDER
 * =====================================
 * SOLO SERVIDOR.
 *
 * El proveedor marca artículos con `ENVIO_DIRECTO = SI`: no salen de su almacén,
 * los manda el fabricante. Esos NUNCA se publican en Amazon — ni con precio ni
 * con stock. Salen del ciclo con stock 0 y del motor de precios sin propuesta.
 *
 *
 * ============ EL DATO NO VIENE EN LA API. ESA ES TODA LA HISTORIA ============
 *
 * Su Swagger declara el objeto `Product` entero, y es esto:
 *
 *     code · description · family · brand · subfamily · ean · partNumber
 *     digital · price · digitalCanon · stock · entries · pricesPerQuantity
 *
 * `ENVIO_DIRECTO` no está. (Sí hay un `dropshipping`, pero cuelga de
 * `ShippingAddress` y dice a dónde se manda un pedido, no cómo es el artículo.)
 *
 * Y el ciclo de stock de Entrais lee LA API. Así que por el camino por el que
 * llegan los productos, el dato no llega nunca y no va a llegar.
 *
 * Por eso hay una tabla. Se llena desde el CSV de tarifa que el proveedor manda
 * por correo, y HAY QUE VOLVER A CARGARLA cuando llegue uno nuevo: mientras
 * tanto sabe de los artículos del fichero que se cargó y de ninguno posterior.
 *
 *
 * ============ AHORA MISMO NO HAY NINGUNO EXPUESTO ============
 *
 * Comprobados los 51 del fichero del 5 de agosto de 2026:
 *
 *     en Amazon ......................... 0 de 51
 *     en la respuesta de la API ......... 0 de 51
 *     en los ficheros de carga masiva ... 0 de 51
 *
 * El de en medio es el interesante: de los otros 6.665 artículos de la tarifa
 * solo falta en la API un 1,5 %; de los de envío directo falta el 100 %. El
 * proveedor ya los excluye de su feed.
 *
 * Esto NO hace que sobre el bloqueo, y conviene dejarlo escrito antes de que
 * alguien llegue a esa conclusión leyendo los ceros: es una foto de un día, y la
 * tarifa con la que se comparó era veinte días más vieja que la respuesta de la
 * API. Si el proveedor cambia el feed, o si dan de alta un artículo de envío
 * directo nuevo, nada avisa. Un freno que no salta no cuesta nada.
 */

import { createServiceClient } from '@/lib/supabase/service'
import type { FilaTarifa } from './tarifa'

export interface Bloqueado {
  sku: string
  motivo: 'envio_directo' | 'a_mano'
  nombre: string | null
  familia: string | null
  precio_proveedor: number | null
  tarifa_fecha: string | null
  nota: string | null
}

/**
 * Los SKU bloqueados, para preguntar por uno.
 *
 * Devuelve un Set y no la lista porque quien llama siempre está en mitad de un
 * bucle de 6.900 productos: un `includes` sobre un array ahí son cuarenta y
 * siete millones de comparaciones.
 */
export async function leerBloqueados(): Promise<Set<string>> {
  const service = createServiceClient()
  const { data, error } = await service.from('entrais_bloqueados').select('sku')
  if (error) throw error
  return new Set((data ?? []).map((b) => String((b as { sku: string }).sku)))
}

export async function listarBloqueados(): Promise<Bloqueado[]> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('entrais_bloqueados')
    .select('sku, motivo, nombre, familia, precio_proveedor, tarifa_fecha, nota')
    .order('precio_proveedor', { ascending: false, nullsFirst: false })
  if (error) throw error
  return (data ?? []) as unknown as Bloqueado[]
}

/* ------------------------------------------------------------------ */
/* Guardar                                                             */
/* ------------------------------------------------------------------ */

export interface ResultadoCarga {
  /** Artículos que traía el fichero */
  leidos: number
  /** Los que vienen marcados con envío directo */
  marcados: number
  /** De esos, los que ya estaban bloqueados */
  yaEstaban: number
  nuevos: string[]
  /**
   * Los que estaban bloqueados por envío directo y en este fichero YA NO lo
   * están. Se desbloquean, y se devuelven para poder decirlo.
   */
  desbloqueados: string[]
}

/**
 * Deja la lista igual a lo que dice el fichero.
 *
 * SE SINCRONIZA EN LOS DOS SENTIDOS, y esa es la decisión que hay que pensar.
 * Lo cómodo sería solo añadir: nunca desbloquea nada y no puede «perder» un
 * bloqueo por un fichero raro. Pero entonces un artículo que el proveedor deja
 * de mandar por envío directo se queda bloqueado para siempre sin que nadie sepa
 * por qué, y la única forma de quitarlo sería entrar en la base.
 *
 * Los bloqueos de motivo `a_mano` NO se tocan: no salen de la tarifa y el
 * fichero no tiene nada que decir sobre ellos.
 *
 *
 * ============ EL FICHERO LO LEE LA PANTALLA, Y AQUÍ NO NOS FIAMOS ============
 *
 * Llegan las filas marcadas —unas decenas— y `leidos`, que es cuántas traía el
 * fichero entero. El fichero no sube: son veinte megas de descripciones que no
 * se usan, y el sitio donde eso muere es un límite de tamaño de cuerpo en algún
 * proxy.
 *
 * A cambio hay que desconfiar de lo que llega, porque el modo de fallo es feo y
 * silencioso: un fichero equivocado que se lea sin dar error deja `marcados` a
 * cero, esta función lo entiende como «ya no hay ninguno de envío directo» y
 * BORRA la lista entera. Después todo sigue funcionando y no bloquea nada.
 *
 * Contra eso hay dos cortes, y hacen falta los dos:
 *
 *   · `leerTarifa` se niega a leer un fichero sin las columnas COD_INTERNO y
 *     ENVIO_DIRECTO. Eso descarta «me he equivocado de fichero».
 *   · Y aquí: un vaciado completo con un fichero pequeño no se ejecuta. La
 *     tarifa real tiene casi siete mil líneas; si vienen cuatro y encima
 *     dejarían la lista a cero, el fichero está truncado.
 */
export async function cargarTarifa(
  marcados: FilaTarifa[],
  opciones: { leidos: number; fecha: string | null; usuario: string | null }
): Promise<ResultadoCarga> {
  const service = createServiceClient()

  const deseados = new Set(marcados.map((f) => f.sku))

  const { data: previos, error: errorPrevios } = await service
    .from('entrais_bloqueados')
    .select('sku')
    .eq('motivo', 'envio_directo')
  if (errorPrevios) throw errorPrevios
  const antes = new Set((previos ?? []).map((b) => String((b as { sku: string }).sku)))

  const nuevos = marcados.filter((f) => !antes.has(f.sku)).map((f) => f.sku)
  const desbloqueados = [...antes].filter((s) => !deseados.has(s))

  // Ver la nota de arriba. El corte es sobre el TAMAÑO DEL FICHERO y no sobre
  // cuántos vienen marcados, porque una tarifa legítima puede no traer ninguno
  // —el proveedor deja de vender por envío directo— y eso hay que poder hacerlo.
  const MINIMO_CREIBLE = 500
  if (marcados.length === 0 && antes.size > 0 && opciones.leidos < MINIMO_CREIBLE) {
    throw new Error(
      `El fichero solo traía ${opciones.leidos} artículos y ninguno de envío directo, y eso ` +
        `desbloquearía los ${antes.size} que hay. La tarifa del proveedor tiene casi siete mil ` +
        'líneas: lo que ha llegado está cortado o no es el fichero. No se ha tocado nada.'
    )
  }

  if (marcados.length > 0) {
    const { error } = await service.from('entrais_bloqueados').upsert(
      marcados.map((f) => ({
        sku: f.sku,
        motivo: 'envio_directo',
        nombre: f.nombre || null,
        familia: f.familia || null,
        precio_proveedor: f.precio,
        tarifa_fecha: opciones.fecha,
        updated_at: new Date().toISOString(),
        updated_by: opciones.usuario,
      })),
      { onConflict: 'sku' }
    )
    if (error) throw error
  }

  if (desbloqueados.length > 0) {
    const { error } = await service
      .from('entrais_bloqueados')
      .delete()
      .eq('motivo', 'envio_directo')
      .in('sku', desbloqueados)
    if (error) throw error
  }

  return {
    leidos: opciones.leidos,
    marcados: marcados.length,
    yaEstaban: marcados.length - nuevos.length,
    nuevos,
    desbloqueados,
  }
}
