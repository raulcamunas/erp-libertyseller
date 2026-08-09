/**
 * TAREAS · ATRIBUTOS DEL CATÁLOGO Y RANKING DE VENTAS
 * ==================================================
 * SOLO SERVIDOR. A1 SOLO LEE: aquí no se le escribe nada a Amazon.
 *
 * Las dos salen de la misma llamada —searchCatalogItems, 20 ASIN de golpe— y por
 * eso viven en el mismo fichero, construidas por la misma fábrica:
 *
 *   `enriquecer_catalogo` (SEMANAL, catálogo completo)
 *      Pide resúmenes + dimensiones + rankings, y escribe LAS DOS COSAS: los
 *      atributos en el catálogo y el BSR en su serie. El ranking sale GRATIS en
 *      la misma respuesta, así que no pedirlo sería tirar un dato que ya se ha
 *      pagado. Marca, categoría y medidas casi no cambian: con una pasada
 *      semanal sobra.
 *
 *   `snapshot_bsr` (DIARIO, solo el subconjunto en seguimiento)
 *      Pide SOLO los rankings y escribe solo la serie. El BSR sí se mueve todos
 *      los días, y es la señal de rotación que no se puede reconstruir hacia
 *      atrás: el día que no se guarda, se pierde para siempre.
 *
 *
 * LA TRAMPA QUE ESTA TAREA TIENE QUE TAPAR
 * ----------------------------------------
 * searchCatalogItems NO AVISA de los ASIN que no encuentra: pides veinte,
 * existen dieciocho, te llegan dieciocho, HTTP 200. Si nadie compara lo pedido
 * con lo devuelto, un ASIN que Amazon retira deja de refrescarse y su histórico
 * se congela sin que nadie lo note. Aquí se comparan y se cuentan como omitidos,
 * con un evento agrupado —no uno por SKU, que sería ruido— cuando pasan de unos
 * pocos.
 *
 *
 * POR QUÉ EL LOTE SON ASIN Y NO SKU
 * ---------------------------------
 * Porque los atributos son del PRODUCTO, no de la referencia. Un modelo de
 * zapato con doce tallas son doce SKU y un solo ASIN: pedir por SKU gastaría
 * doce veces el cupo para traer doce veces lo mismo. El cursor es el ASIN, en
 * orden ascendente, que es único y por tanto un cursor que no repite ni se salta
 * nada al reanudar.
 */

import { conexionDeTrabajo, marketplaceDeTrabajo } from '../amazon/conexion'
import {
  MAX_ASINS_POR_LLAMADA,
  leerCatalogoItems,
  type BloqueCatalogo,
} from '../amazon/catalogo-items'
import {
  contarListings,
  escribirAtributos,
  listingsDeAsins,
  siguientesAsins,
  type AmbitoCatalogo,
} from '../catalogo'
import type { UnidadDeTrabajo } from '../datos'
import { insertarBsr, type SnapshotBsrNuevo } from '../series'
import type { ContextoTarea, CuentasJob, Lote, ResultadoLote, Tarea } from '../motor'
import type { AmazonJobTipo } from '../tipos'

/**
 * A partir de cuántos ASIN ausentes en un mismo lote se levanta un evento.
 *
 * Uno o dos son normales —un listing recién creado tarda en indexarse, un ASIN
 * se retira— y un evento por cada uno convertiría la cola de incidencias en un
 * registro de depuración que nadie mira. Cinco de veinte ya es un patrón: o el
 * catálogo está desfasado o se está preguntando por el país equivocado.
 */
const AUSENTES_QUE_PREOCUPAN = 5

interface Config {
  tipo: AmazonJobTipo
  etiqueta: string
  bloques: BloqueCatalogo[]
  escribirAtributosDelCatalogo: boolean
  escribirRanking: boolean
  /** Si el trabajo se limita, por defecto, al subconjunto en seguimiento */
  soloActivosPorDefecto: boolean
}

function ambitoDe(ctx: ContextoTarea, config: Config): AmbitoCatalogo {
  const parametros = ctx.job.parametros ?? {}
  const pedido = parametros.soloActivos
  return {
    skusFiltro: ctx.job.skus_filtro,
    soloActivos: typeof pedido === 'boolean' ? pedido : config.soloActivosPorDefecto,
    // Lo pone el planificador cuando el cliente es MIXTO: en ese caso el BSR
    // solo tiene sentido sobre sus propias marcas. Ver modelo-negocio.ts.
    soloMarcaPropia: parametros.soloMarcaPropia === true,
  }
}

async function unidadDe(ctx: ContextoTarea): Promise<UnidadDeTrabajo> {
  const conexion = await conexionDeTrabajo(ctx.job.connection_id)
  return {
    connectionId: ctx.job.connection_id as string,
    sellingPartnerId: conexion.sellingPartnerId,
    marketplaceId: marketplaceDeTrabajo(conexion, ctx.job.marketplace_id),
  }
}

function crearTarea(config: Config): Tarea {
  return {
    tipo: config.tipo,
    etiqueta: config.etiqueta,
    /** Veinte: el máximo que admite `identifiers`, y el número mágico de toda la
        Selling Partner API */
    tamanoLote: MAX_ASINS_POR_LLAMADA,

    async preparar(ctx) {
      const unidad = await unidadDe(ctx)
      // Es una COTA SUPERIOR, no el número exacto: cuenta SKU, y varios SKU
      // pueden compartir ASIN. Se prefiere pasarse a quedarse corto, porque una
      // barra que llega al 100 % y sigue trabajando es peor que una que avanza
      // despacio. Contar ASIN distintos exigiría un DISTINCT que PostgREST no
      // sabe hacer sin una vista.
      const total = await contarListings(unidad, { ...ambitoDe(ctx, config), soloConAsin: true })
      if (total === 0) {
        await ctx.evento({
          tipo: 'sin_asins',
          severidad: 'aviso',
          mensaje:
            'No hay ninguna referencia con ASIN en el ámbito de este trabajo, así que no hay nada ' +
            'que consultar en el catálogo de Amazon. Si esperabas lo contrario, lanza antes el ' +
            'censo del catálogo.',
        })
      }
      return { totalEstimado: total }
    },

    async siguienteLote(ctx, cursor, tamano): Promise<Lote> {
      const unidad = await unidadDe(ctx)
      const tramo = await siguientesAsins(unidad, cursor, tamano, ambitoDe(ctx, config))
      return {
        claves: tramo.asins,
        cursorSiguiente: tramo.ultimo,
        hayMas: tramo.hayMas,
      }
    },

    async procesarLote(ctx, lote): Promise<ResultadoLote> {
      const conexion = await conexionDeTrabajo(ctx.job.connection_id)
      const unidad = await unidadDe(ctx)
      const ambito = ambitoDe(ctx, config)

      // Los SKU de estos ASIN. Se piden ANTES de gastar la ficha de Amazon: si
      // entre el tramo y ahora se han borrado todos, no hay nada que consultar.
      const listings = await listingsDeAsins(unidad, lote.claves, ambito)
      if (listings.length === 0) return { procesados: 0 }

      const lectura = await leerCatalogoItems(conexion.credenciales, {
        marketplaceId: unidad.marketplaceId,
        asins: lote.claves,
        bloques: config.bloques,
      })

      // ---------- Los ASIN que Amazon no ha devuelto ----------
      if (lectura.ausentes.length >= AUSENTES_QUE_PREOCUPAN) {
        await ctx.evento({
          tipo: 'asins_no_encontrados',
          severidad: 'aviso',
          mensaje:
            `Amazon no ha devuelto ${lectura.ausentes.length} de los ${lote.claves.length} ASIN de ` +
            `este lote en ${unidad.marketplaceId}. No da error: sencillamente se los salta. Puede ` +
            'ser que ya no existan en ese país, que el listing se haya recreado con otro tipo de ' +
            'producto, o que nuestro catálogo esté desfasado. Esos SKU se quedan con los datos que ' +
            'tenían, no se ponen a cero.',
          detalle: { ausentes: lectura.ausentes.slice(0, 20) },
          requestId: lectura.requestId,
        })
      }

      const medidasRaras = lectura.items.filter((i) => i.medidasIncoherentes)
      if (medidasRaras.length > 0) {
        await ctx.evento({
          tipo: 'medidas_incoherentes',
          severidad: 'aviso',
          mensaje:
            `${medidasRaras.length} productos traen sus tres medidas en unidades distintas, así que ` +
            'se han descartado en vez de convertirlas a ojo. Sin dimensiones fiables, la tarifa de ' +
            'FBA de esos SKU es una estimación que no se puede usar para decidir.',
          detalle: { asins: medidasRaras.slice(0, 20).map((i) => i.asin) },
        })
      }

      // ---------- Atributos ----------
      let filasTocadas = 0
      if (config.escribirAtributosDelCatalogo && lectura.items.length > 0) {
        const escritura = await escribirAtributos(unidad, lectura.items, ctx.ahora)
        filasTocadas = escritura.filas
      }

      // ---------- Ranking de ventas ----------
      if (config.escribirRanking) {
        const porAsin = new Map(lectura.items.map((i) => [i.asin, i]))
        const snapshots: SnapshotBsrNuevo[] = []

        for (const listing of listings) {
          const item = listing.asin ? porAsin.get(listing.asin) : undefined
          if (!item) continue
          // Un ASIN sin ventas suficientes NO TRAE rankings. Ausencia no es un
          // puesto malísimo: es que no hay dato, y por eso no se escribe fila.
          for (const rank of item.ranks) {
            snapshots.push({
              listingId: listing.id,
              connectionId: unidad.connectionId,
              sellingPartnerId: unidad.sellingPartnerId,
              marketplaceId: unidad.marketplaceId,
              sku: listing.sku,
              asin: listing.asin,
              jobId: ctx.job.id,
              requestId: lectura.requestId,
              tipo: rank.tipo,
              categoria: rank.categoria,
              categoriaId: rank.categoriaId,
              rank: rank.rank,
            })
          }
        }

        await insertarBsr(snapshots)
      }

      // Se cuentan los SKU EN EL ÁMBITO DEL TRABAJO, no los ASIN ni las filas
      // escritas, para que cuadre con el total estimado (que también cuenta SKU
      // en el ámbito).
      //
      // `filasTocadas` puede ser MAYOR, y no es un error: escribirAtributos()
      // actualiza por ASIN, así que si un trabajo con `soloActivos` toca un ASIN
      // con doce tallas y solo tres están en seguimiento, las doce se llevan la
      // marca y las medidas. Eso está bien —los atributos son del producto, no
      // de la referencia— pero contarlas aquí haría que la barra de progreso
      // pasara del 100 %.
      const conDatos = listings.filter((l) => l.asin && !lectura.ausentes.includes(l.asin))
      if (filasTocadas > 0) {
        console.log(
          `[plataforma] catálogo ${unidad.marketplaceId}: ${lectura.items.length} ASIN leídos, ` +
            `${filasTocadas} filas del espejo actualizadas`
        )
      }
      return {
        procesados: conDatos.length,
        omitidos: listings.length - conDatos.length,
      }
    },

    resumir(_ctx, cuentas: CuentasJob): string {
      const base = `${cuentas.procesados} referencias leídas del catálogo de Amazon en ${cuentas.lotes} lotes de hasta ${MAX_ASINS_POR_LLAMADA} ASIN`
      return cuentas.omitidos > 0
        ? `${base}, y ${cuentas.omitidos} que Amazon no ha devuelto y se quedan con lo que tenían.`
        : `${base}.`
    },
  }
}

/* ------------------------------------------------------------------ */
/* Las dos tareas                                                      */
/* ------------------------------------------------------------------ */

/**
 * Semanal, catálogo completo.
 *
 * Con 13.700 referencias son unas 685 llamadas a 2 por segundo: unos seis
 * minutos por cliente y país. Cabe de sobra en una ventana nocturna, pero
 * multiplicado por dieciséis clientes conviene que sea semanal y no diario —
 * marca, categoría y medidas casi no cambian—.
 */
export const tareaEnriquecerCatalogo: Tarea = crearTarea({
  tipo: 'enriquecer_catalogo',
  etiqueta: 'Atributos de catálogo',
  // `identifiers` no se pide: el ASIN ya lo tenemos, que es por donde estamos
  // preguntando. `images` tampoco, y no por tamaño: en marcas sin registro de
  // marca esa petición devuelve un error de «no hay marca registrada» que tira
  // la llamada entera, y aquí hay mucho catálogo de terceros.
  bloques: ['summaries', 'dimensions', 'salesRanks'],
  escribirAtributosDelCatalogo: true,
  escribirRanking: true,
  soloActivosPorDefecto: false,
})

/** Diario, solo el subconjunto en seguimiento */
export const tareaSnapshotBsr: Tarea = crearTarea({
  tipo: 'snapshot_bsr',
  etiqueta: 'Ranking de ventas (BSR)',
  bloques: ['salesRanks'],
  escribirAtributosDelCatalogo: false,
  escribirRanking: true,
  soloActivosPorDefecto: true,
})
