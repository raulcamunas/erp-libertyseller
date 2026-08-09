/**
 * TAREA · INVENTARIO EN AMAZON
 * ============================
 * SOLO SERVIDOR. A1 SOLO LEE: aquí no se le escribe nada a Amazon.
 *
 * Lee getInventorySummaries y escribe una observación por SKU en la serie de
 * inventario.
 *
 *
 * EL PUNTO ENTERO DE ESTA TAREA: UN FBM NO ES UN CERO
 * --------------------------------------------------
 * FBA Inventory solo conoce la red logística de Amazon. Un SKU que gestiona el
 * vendedor NO SALE en la respuesta: no sale con cantidad cero, NO SALE. Sin
 * error, sin marca y sin hueco.
 *
 * Así que el canal NO se deduce de esa respuesta: se lee del espejo del catálogo
 * (`fulfillment_channel_code`, que llena el censo), y cada SKU acaba en uno de
 * TRES estados, no dos:
 *
 *   conocido    -> es de FBA y Amazon ha dicho cuánto tiene.
 *   no_aplica   -> lo gestiona el vendedor. Amazon no tiene existencias suyas, y
 *                  eso no es «cero». Se guarda además `stock_propio`, que es el
 *                  número que sí significa algo para ese SKU.
 *   desconocido -> o es de FBA y Amazon no lo ha devuelto, o no sabemos siquiera
 *                  quién lo gestiona. Tampoco es cero.
 *
 * Qué pasaría con dos estados en vez de tres, que es el motivo de todo esto:
 *
 *   · En el piloto (Liberty UpGrowth, mayoría FBA con un artículo de muestra en
 *     FBM), ese artículo aparecería sin existencias, dispararía una alerta de
 *     stock crítico falsa, y en A2 se diagnosticaría como «Sin stock → Reponer»
 *     teniendo el almacén lleno.
 *   · En ShoesF, que es mayoría FBM con ~13.700 referencias, el 90 % del
 *     catálogo aparecería agotado de un día para otro.
 *
 * Y la base ayuda: el CHECK amazon_snapshots_inventario_tri_estado impide
 * guardar cantidades cuando el estado no es 'conocido'. Aunque alguien se
 * equivoque más arriba, un cero no se puede colar donde había un «no lo sabemos».
 *
 *
 * POR QUÉ EL LOTE ES UNA UNIDAD ENTERA Y NO UN PUÑADO DE SKU
 * ---------------------------------------------------------
 * Porque el `nextToken` de esta operación CADUCA A LOS 30 SEGUNDOS: la
 * paginación no se puede partir entre dos pasadas del cron ni pausar en medio. O
 * se recorre entera de una vez, o se empieza otra vez desde el principio. El
 * cursor es, por tanto, la unidad (conexión × marketplace) terminada; un cliente
 * tiene unas pocas, así que reanudar cuesta como mucho repetir una — y repetirla
 * solo añade una observación más a una serie de solo inserción, que es un dato
 * correcto, no un duplicado.
 */

import { isMfnChannel } from '@/lib/types/amazon'
import { conexionDeTrabajo, marketplaceDeTrabajo } from '../amazon/conexion'
import {
  MAX_SKUS_FILTRO,
  clasificarExistencias,
  leerInventarioFba,
  type ExistenciasFba,
} from '../amazon/inventario-fba'
import { contarListings, listingsDeUnidadIngesta, type AmbitoCatalogo } from '../catalogo'
import { claveUnidad, conexionesDeCliente, unidadesDe, type UnidadDeTrabajo } from '../datos'
import { insertarInventario, type SnapshotInventarioNuevo } from '../series'
import type { ContextoTarea, CuentasJob, Lote, ResultadoLote, Tarea } from '../motor'

function ambitoDe(ctx: ContextoTarea): AmbitoCatalogo {
  const parametros = ctx.job.parametros ?? {}
  const pedido = parametros.soloActivos
  return {
    skusFiltro: ctx.job.skus_filtro,
    // Por defecto SOLO el subconjunto en seguimiento: esta es la lectura diaria,
    // y la especificación es explícita en que no se traen 13.700 SKU cada día.
    // Un trabajo semanal o a demanda lo apaga con soloActivos: false.
    soloActivos: typeof pedido === 'boolean' ? pedido : true,
  }
}

/**
 * Las unidades de este trabajo, en orden estable.
 *
 * Estable de verdad: el cursor es una posición dentro de esta lista, y si la
 * lista se reordenara entre pasadas, reanudar se saltaría unidades sin dar
 * ningún error. unidadesDe() ya las ordena.
 */
async function unidadesDelJob(ctx: ContextoTarea): Promise<UnidadDeTrabajo[]> {
  const conexiones = await conexionesDeCliente(ctx.job.client_id)
  const propias = ctx.job.connection_id
    ? conexiones.filter((c) => c.id === ctx.job.connection_id)
    : conexiones
  const unidades = unidadesDe(propias)
  return ctx.job.marketplace_id
    ? unidades.filter((u) => u.marketplaceId === ctx.job.marketplace_id)
    : unidades
}

export const tareaInventarioFba: Tarea = {
  tipo: 'inventario_fba',
  etiqueta: 'Inventario en Amazon',
  /** Una unidad por lote. Ver la cabecera */
  tamanoLote: 1,

  async preparar(ctx) {
    const unidades = await unidadesDelJob(ctx)
    if (unidades.length === 0) {
      await ctx.evento({
        tipo: 'sin_unidades',
        severidad: 'aviso',
        mensaje:
          'Este trabajo no tiene ninguna conexión activa con marketplaces que mirar, así que no ' +
          'hay inventario que leer.',
      })
      return { totalEstimado: 0 }
    }

    let total = 0
    for (const unidad of unidades) total += await contarListings(unidad, ambitoDe(ctx))
    return { totalEstimado: total }
  },

  async siguienteLote(ctx, cursor): Promise<Lote> {
    const unidades = await unidadesDelJob(ctx)
    // findIndex devuelve -1 cuando la unidad del cursor ya no existe (una
    // conexión desconectada a mitad de trabajo). El +1 lo deja en 0, o sea: se
    // empieza otra vez. Es inofensivo —la serie es de solo inserción— y
    // preferible a saltarse el resto en silencio.
    const posicion = cursor === null ? 0 : unidades.findIndex((u) => claveUnidad(u) === cursor) + 1
    const siguiente = unidades[posicion]
    if (!siguiente) return { claves: [], cursorSiguiente: cursor, hayMas: false }
    return {
      claves: [claveUnidad(siguiente)],
      cursorSiguiente: claveUnidad(siguiente),
      hayMas: posicion + 1 < unidades.length,
    }
  },

  async procesarLote(ctx, lote): Promise<ResultadoLote> {
    const unidades = await unidadesDelJob(ctx)
    const unidad = unidades.find((u) => claveUnidad(u) === lote.claves[0])
    if (!unidad) return { procesados: 0 }

    const conexion = await conexionDeTrabajo(ctx.job.connection_id)
    marketplaceDeTrabajo(conexion, unidad.marketplaceId)

    const listings = await listingsDeUnidadIngesta(unidad, ambitoDe(ctx))
    if (listings.length === 0) return { procesados: 0 }

    // ---------- Quién es de FBA, según NUESTRO catálogo ----------
    const deAmazon = listings.filter((l) => l.is_fba)
    const delVendedor = listings.filter((l) => isMfnChannel(l.fulfillment_channel_code))
    // Ni una cosa ni la otra: Amazon no nos ha devuelto su canal. NO se supone
    // nada. Es el mismo criterio que ya aplica el envío de stock, donde ante la
    // duda no se escribe.
    const sinCanal = listings.length - deAmazon.length - delVendedor.length

    // ---------- La lectura, solo si hace falta ----------
    // Un cliente 100 % FBM —ShoesF, sin ir más lejos— NO GASTA NI UNA PETICIÓN:
    // getInventorySummaries no tendría nada que devolverle. Es la operación más
    // lenta de todas (2 por segundo) y saltársela cuando no aplica es lo que hace
    // que la ventana nocturna dé de sí.
    let existencias = new Map<string, ExistenciasFba>()
    let requestId: string | null = null
    let truncado = false

    if (deAmazon.length > 0) {
      const filtro = ctx.job.skus_filtro
      const lectura = await leerInventarioFba(conexion.credenciales, {
        marketplaceId: unidad.marketplaceId,
        // El filtro por SKU solo se usa si cabe: por encima de 50 sale más
        // barato leer el marketplace entero que trocear la petición.
        skus: filtro && filtro.length > 0 && filtro.length <= MAX_SKUS_FILTRO ? filtro : null,
      })
      existencias = lectura.existencias
      requestId = lectura.requestId
      truncado = lectura.truncado

      if (truncado) {
        await ctx.evento({
          tipo: 'inventario_truncado',
          severidad: 'error',
          mensaje:
            `La lectura del inventario de «${conexion.nombre}» en ${unidad.marketplaceId} se ha ` +
            'quedado a medias: Amazon seguía devolviendo páginas y se ha alcanzado el tope. Los SKU ' +
            'que no se han llegado a leer quedan como «desconocido», nunca como cero.',
          requestId,
        })
      }
    }

    // ---------- Las observaciones ----------
    // La decisión de qué significa cada SKU está en clasificarExistencias(), que
    // es pura y vive con la lectura. Aquí solo se recorre y se cuenta.
    const snapshots: SnapshotInventarioNuevo[] = []
    let conocidos = 0
    let desconocidos = 0
    const ejemplosDesconocidos: string[] = []

    for (const listing of listings) {
      const clase = clasificarExistencias(
        {
          sku: listing.sku,
          canal: listing.fulfillment_channel_code,
          esFba: listing.is_fba,
          cantidadPropia: listing.quantity,
        },
        existencias
      )

      if (clase.estadoDato === 'conocido') conocidos += 1
      if (clase.estadoDato === 'desconocido') {
        desconocidos += 1
        if (ejemplosDesconocidos.length < 10) ejemplosDesconocidos.push(listing.sku)
      }

      const fba = clase.existencias
      snapshots.push({
        listingId: listing.id,
        connectionId: unidad.connectionId,
        sellingPartnerId: unidad.sellingPartnerId,
        marketplaceId: unidad.marketplaceId,
        sku: listing.sku,
        asin: listing.asin,
        jobId: ctx.job.id,
        requestId,
        canal: listing.fulfillment_channel_code,
        estadoDato: clase.estadoDato,
        origen: clase.origen,
        stockPropio: clase.stockPropio,
        disponible: fba?.disponible ?? null,
        reservado: fba?.reservado ?? null,
        inboundWorking: fba?.inboundWorking ?? null,
        inboundEnviado: fba?.inboundEnviado ?? null,
        inboundRecibiendo: fba?.inboundRecibiendo ?? null,
        invendible: fba?.invendible ?? null,
        investigando: fba?.investigando ?? null,
        total: fba?.total ?? null,
      })
    }

    const escritas = await insertarInventario(snapshots)

    // ---------- Lo que hay que contar en voz alta ----------
    if (desconocidos > 0) {
      // UN SOLO EVENTO con el recuento, no uno por SKU. Un barrido con
      // trescientos huecos generaría trescientas filas idénticas, y trescientas
      // filas idénticas en la cola de incidencias son cero incidencias.
      await ctx.evento({
        tipo: 'inventario_desconocido',
        severidad: desconocidos > listings.length / 2 ? 'error' : 'aviso',
        mensaje:
          `${desconocidos} de ${listings.length} referencias de «${conexion.nombre}» en ` +
          `${unidad.marketplaceId} se han guardado como «no se sabe» y NO como sin stock: o Amazon ` +
          'no las ha devuelto aunque nuestro catálogo las dé por FBA, o no consta quién gestiona su ' +
          'logística. Suele arreglarse lanzando el censo del catálogo.',
        detalle: { desconocidos, evaluados: listings.length, ejemplos: ejemplosDesconocidos },
        requestId,
      })
    }

    if (sinCanal > 0 && sinCanal === listings.length) {
      await ctx.evento({
        tipo: 'catalogo_sin_canal',
        severidad: 'error',
        mensaje:
          `Ninguna de las ${listings.length} referencias de esta cuenta dice quién gestiona su ` +
          'logística, así que no se puede leer inventario de ninguna. Lanza el censo del catálogo ' +
          'antes de volver a intentarlo.',
      })
    }

    console.log(
      `[plataforma] inventario ${unidad.marketplaceId}: ${escritas} observaciones · ` +
        `${conocidos} de Amazon, ${delVendedor.length} del vendedor, ${desconocidos} sin dato`
    )

    return { procesados: listings.length, omitidos: desconocidos }
  },

  resumir(_ctx, cuentas: CuentasJob): string {
    const base = `${cuentas.procesados} referencias con observación de inventario`
    return cuentas.omitidos > 0
      ? `${base}, de las cuales ${cuentas.omitidos} sin dato de Amazon (marcadas como «no se sabe», no como cero).`
      : `${base}.`
  },
}
