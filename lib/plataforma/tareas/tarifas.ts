/**
 * TAREA · LAS TARIFAS QUE COBRA AMAZON
 * ====================================
 * SOLO SERVIDOR. Solo lee: aquí no se le escribe nada a Amazon.
 *
 * `getMyFeesEstimates` — 20 SKU por llamada, una llamada cada dos segundos.
 * Escribe en `amazon_fees_estimados`, que es de donde salen los márgenes de
 * FBM→FBA y los que va a enseñar el monitor de Buy Box.
 *
 *
 * ============ POR QUÉ ESTA TAREA ES LA LLAVE ============
 *
 * Sin ella, `margen()` contesta «hace falta una estimación de tarifas» a TODO, y
 * eso se lee en pantalla como «no hay datos» cuando en realidad es «nadie los ha
 * pedido nunca». La tabla existía desde la migración 123 y estaba vacía porque
 * el productor no se había escrito.
 *
 *
 * ============ LAS TRES DECISIONES QUE NO SON OBVIAS ============
 *
 * 1. A QUÉ PRECIO SE PIDE. No al precio actual: al PRECIO DE EVALUACIÓN, que es
 *    lo que devuelve precioDeEvaluacion() de A4 — `min(precio actual, FOEP)`
 *    cuando hay techo, y el precio actual cuando no.
 *
 *    Es la diferencia entre que la tarifa sirva o no sirva. La comisión de
 *    referencia es un porcentaje CON MÍNIMOS y la de logística depende del tramo
 *    de tamaño, así que `margen()` se NIEGA a usar una tarifa pedida a un precio
 *    que se aleje más de la tolerancia del cliente (1 % por defecto). Pedirla al
 *    precio actual y evaluar al del FOEP deja la tarifa fuera de tolerancia y el
 *    margen sale «no evaluable» — con la tabla llena.
 *
 * 2. EL FOEP SALE DEL DIAGNÓSTICO, NO DE LA SERIE DE PRECIOS. `amazon_snapshots_
 *    precio` guarda la lectura cruda de cada barrido; `amazon_buybox_diagnostico`
 *    guarda el veredicto, y es de ahí de donde el RPC de la migración 132 saca
 *    `foep`, `foep_estado` y `buybox_estado` para A4. Si esta tarea leyera de la
 *    otra tabla, pediría las tarifas a un precio distinto del que A4 va a usar
 *    para evaluarlas, y volvemos al punto 1.
 *
 * 3. SE PIDEN DOS ESCENARIOS POR SKU, y por eso la columna `canal` existe:
 *
 *      'propio' → con el canal que HOY tiene el SKU.
 *      'fba'    → forzando IsAmazonFulfilled, que es la ÚNICA forma de saber la
 *                 tarifa de logística de una referencia que hoy envía el cliente.
 *
 *    Las dos LATERAL de la 132 filtran por esa columna, así que una fila sin
 *    canal no la lee nadie. Y para un SKU que YA está en FBA los dos escenarios
 *    coinciden: se pide UNA vez y se escriben las dos filas, que ahorra la mitad
 *    de las llamadas en un cliente mayoritariamente FBA.
 */

import { conexionDeTrabajo, marketplaceDeTrabajo } from '../amazon/conexion'
import {
  MAX_SKUS_TARIFAS,
  leerTarifas,
  type PeticionTarifa,
  type TarifaSku,
} from '../amazon/tarifas'
import { siguientesSkus, ultimosDiagnosticos, type ListingBuyBox } from '../buybox/datos'
import { precioDeEvaluacion } from '../fbmfba/analisis'
import type { AmbitoCatalogo } from '../catalogo'
import { contarListings } from '../catalogo'
import type { UnidadDeTrabajo } from '../datos'
import type { ContextoTarea, CuentasJob, Lote, ResultadoLote, Tarea } from '../motor'
import { insertarTarifas, type TarifaEstimadaNueva } from '../series'
import type { EstadoBuyBox, EstadoFoepA2 } from '../buybox/tipos'

/**
 * Cuántos días atrás vale un diagnóstico para decidir el precio de evaluación.
 *
 * El mismo criterio que la vigencia de A2: uno de hace tres semanas no es un
 * diagnóstico, es un recuerdo. Si no hay diagnóstico dentro de la ventana, se
 * pide la tarifa al precio actual y ya está — que es exactamente lo que hace
 * precioDeEvaluacion() cuando no hay techo.
 */
const VIGENCIA_DIAGNOSTICO_DIAS = 30

/**
 * A partir de cuántos fallos del mismo tipo en un lote se levanta un evento.
 *
 * Uno o dos son normales —un SKU recién creado, un ASIN que Amazon está
 * reindexando— y un evento por cada uno convierte la cola de incidencias en un
 * registro de depuración. Mismo umbral que en el resto de tareas.
 */
const FALLOS_QUE_PREOCUPAN = 3

function ambitoDe(ctx: ContextoTarea): AmbitoCatalogo {
  const parametros = ctx.job.parametros ?? {}
  const pedidoActivos = parametros.soloActivos
  return {
    skusFiltro: ctx.job.skus_filtro,
    /**
     * POR DEFECTO **NO** SE LIMITA AL SUBCONJUNTO EN SEGUIMIENTO.
     *
     * Y es una decisión con historia: el criterio de seguimiento de los clientes
     * de la cartera da CERO —tienen FBA marcado y catálogo FBM—, así que un
     * `soloActivos: true` por omisión haría que este trabajo terminara en verde
     * sin pedir una sola tarifa. Ya pasó con el monitor de Buy Box.
     */
    soloActivos: typeof pedidoActivos === 'boolean' ? pedidoActivos : false,
    /**
     * Sí se limita a lo que TIENE EXISTENCIAS, y esto es coste, no criterio.
     *
     * Con dos escenarios por SKU, un catálogo de 13.700 referencias son 1.370
     * llamadas a una cada dos segundos: 45 minutos por país. Limitándolo a lo que
     * tiene stock baja a unos ocho.
     *
     * Lo que se pierde: FBM→FBA enseña el catálogo entero, así que las
     * referencias sin existencias saldrán ahí con «falta la tarifa». Es honesto
     * —no se ha pedido— y se arregla lanzando el trabajo a mano con
     * `soloConStock: false` sobre el cliente que interese.
     */
    soloConStock: parametros.soloConStock !== false,
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

/** El canal de un listing, tal y como lo entiende A4 */
function esFbaHoy(listing: ListingBuyBox): boolean {
  return listing.is_fba === true
}

export const tareaTarifas: Tarea = {
  tipo: 'tarifas',
  etiqueta: 'Tarifas estimadas',
  /** 20: el máximo que admite getMyFeesEstimates por llamada */
  tamanoLote: MAX_SKUS_TARIFAS,

  async preparar(ctx) {
    const unidad = await unidadDe(ctx)
    const total = await contarListings(unidad, ambitoDe(ctx))
    return { totalEstimado: total }
  },

  async siguienteLote(ctx, cursor, tamano): Promise<Lote> {
    const unidad = await unidadDe(ctx)
    const tramo = await siguientesSkus(unidad, cursor, tamano, ambitoDe(ctx))
    return {
      claves: tramo.listings.map((l) => l.sku),
      cursorSiguiente: tramo.ultimo,
      hayMas: tramo.hayMas,
    }
  },

  async procesarLote(ctx, lote): Promise<ResultadoLote> {
    const conexion = await conexionDeTrabajo(ctx.job.connection_id)
    const unidad = await unidadDe(ctx)

    // Los listings de este tramo, con su precio, divisa y canal. Se vuelven a
    // pedir aquí y no se arrastran desde siguienteLote porque el motor guarda el
    // cursor entre pasadas: lo único que sobrevive es la clave.
    const tramo = await siguientesSkus(unidad, null, lote.claves.length, {
      ...ambitoDe(ctx),
      skusFiltro: lote.claves,
    })
    if (tramo.listings.length === 0) return { procesados: 0 }

    /**
     * El último veredicto de Buy Box de cada SKU: de ahí salen el FOEP y quién
     * tiene la oferta destacada, que es lo que decide el precio de evaluación.
     * Ver la nota 2 de la cabecera.
     */
    const diagnosticos = await ultimosDiagnosticos(
      unidad,
      lote.claves,
      VIGENCIA_DIAGNOSTICO_DIAS
    )

    /* ---------- A qué precio se pide cada SKU ---------- */
    const aPedir: Array<{ listing: ListingBuyBox; precio: number; moneda: string }> = []
    let sinPrecio = 0

    for (const listing of tramo.listings) {
      const diag = diagnosticos.get(listing.sku)
      /**
       * Los números viven en `datos`, no en columnas sueltas de la fila.
       *
       * `FilaDiagnostico` guarda el veredicto y su porqué; los valores con los
       * que se decidió van dentro de `datos` (DatosDelVeredicto), que es lo que
       * hace auditable un diagnóstico. Sin diagnóstico dentro de la ventana, los
       * valores por omisión llevan a precioDeEvaluacion() a devolver el precio
       * actual, que es lo correcto: sin techo no hay otro precio que evaluar.
       */
      const { precio } = precioDeEvaluacion({
        precioActual: listing.price,
        foep: diag?.datos.foep ?? null,
        foepEstado: (diag?.datos.foepEstado ?? 'no_consultado') as EstadoFoepA2,
        buybox: (diag?.datos.buybox ?? 'desconocido') as EstadoBuyBox,
      })

      // Sin precio no hay tarifa que pedir: la comisión es un porcentaje de algo
      // y Amazon exige el importe en la petición. No es un fallo del SKU.
      if (precio === null || !Number.isFinite(precio) || precio <= 0 || !listing.currency) {
        sinPrecio += 1
        continue
      }
      aPedir.push({ listing, precio, moneda: listing.currency })
    }

    if (aPedir.length === 0) {
      return { procesados: 0, omitidos: tramo.listings.length }
    }

    /* ---------- Escenario «propio»: el canal que tiene hoy ---------- */
    const peticionesPropio: PeticionTarifa[] = aPedir.map((p) => ({
      sku: p.listing.sku,
      precio: p.precio,
      moneda: p.moneda,
      esFba: esFbaHoy(p.listing),
    }))

    const propio = await leerTarifas(conexion.credenciales, {
      marketplaceId: unidad.marketplaceId,
      peticiones: peticionesPropio,
    })

    /**
     * Escenario «fba»: SOLO para los que hoy NO son de FBA.
     *
     * Para un SKU que ya está en FBA los dos escenarios son la misma pregunta,
     * así que se reutiliza la respuesta y se escriben las dos filas con una sola
     * llamada. En un cliente mayoritariamente FBA eso ahorra la mitad del cupo.
     */
    const soloFbm = aPedir.filter((p) => !esFbaHoy(p.listing))
    const fba =
      soloFbm.length > 0
        ? await leerTarifas(conexion.credenciales, {
            marketplaceId: unidad.marketplaceId,
            peticiones: soloFbm.map((p) => ({
              sku: p.listing.sku,
              precio: p.precio,
              moneda: p.moneda,
              esFba: true,
            })),
          })
        : null

    /* ---------- A filas ---------- */
    const filas: TarifaEstimadaNueva[] = []

    const filaDe = (
      p: { listing: ListingBuyBox; precio: number; moneda: string },
      t: TarifaSku,
      canal: 'fba' | 'propio',
      requestId: string | null
    ): TarifaEstimadaNueva => ({
      listingId: p.listing.id,
      connectionId: unidad.connectionId,
      sellingPartnerId: unidad.sellingPartnerId,
      marketplaceId: unidad.marketplaceId,
      sku: p.listing.sku,
      asin: p.listing.asin,
      jobId: ctx.job.id,
      requestId,
      precioReferencia: t.precioReferencia,
      moneda: t.moneda,
      referral: t.referral,
      fba: t.fba,
      otras: t.otras,
      total: t.total,
      canal,
    })

    for (const p of aPedir) {
      const suya = propio.porSku.get(p.listing.sku)
      if (!suya) continue

      filas.push(filaDe(p, suya, 'propio', propio.requestId))

      if (esFbaHoy(p.listing)) {
        // Ya está en FBA: el escenario de Amazon es el mismo que el suyo. Se
        // escribe también como 'fba' para que la LATERAL de la 132 lo encuentre.
        filas.push(filaDe(p, suya, 'fba', propio.requestId))
      } else {
        const enFba = fba?.porSku.get(p.listing.sku)
        if (enFba) filas.push(filaDe(p, enFba, 'fba', fba?.requestId ?? null))
      }
    }

    await insertarTarifas(filas)

    /* ---------- Lo que no ha ido bien ---------- */
    const fallos = [...propio.fallos, ...(fba?.fallos ?? [])]
    if (fallos.length >= FALLOS_QUE_PREOCUPAN && !ctx.memoria.has('tarifas:fallos')) {
      ctx.memoria.set('tarifas:fallos', true)
      await ctx.evento({
        tipo: 'tarifas_rechazadas',
        severidad: 'aviso',
        mensaje:
          `Amazon ha rechazado la estimación de tarifas de ${fallos.length} referencias de un lote ` +
          `en ${unidad.marketplaceId}. Sin tarifa no hay margen que calcular para esas referencias: ` +
          'saldrán como «no evaluable» en FBM→FBA y en Buy Box, no como margen cero. Este aviso ' +
          'sale una vez por pasada aunque se repita en más lotes.',
        detalle: {
          codigos: [...new Set(fallos.map((f) => f.codigo))].slice(0, 10),
          skus: fallos.slice(0, 20).map((f) => f.sku),
        },
        requestId: propio.requestId,
      })
    }

    const desconocidos = [...propio.tiposDesconocidos, ...(fba?.tiposDesconocidos ?? [])]
    if (desconocidos.length > 0 && !ctx.memoria.has('tarifas:tipos')) {
      ctx.memoria.set('tarifas:tipos', true)
      await ctx.evento({
        tipo: 'tarifas_tipo_desconocido',
        severidad: 'info',
        mensaje:
          `Amazon ha devuelto tipos de tarifa que el ERP no sabe clasificar: ` +
          `${[...new Set(desconocidos)].join(', ')}. Se suman en «otras», así que el total sigue ` +
          'cuadrando y el margen no se infla; pero conviene mirar si alguno merece columna propia.',
        detalle: { tipos: [...new Set(desconocidos)] },
      })
    }

    // Se cuentan los SKU con tarifa, no las filas escritas: un SKU que ya está
    // en FBA deja dos filas y sigue siendo una referencia. Contar filas haría que
    // la barra de progreso pasara del 100 %.
    const conTarifa = new Set(filas.map((f) => f.sku)).size
    return {
      procesados: conTarifa,
      omitidos: tramo.listings.length - conTarifa,
    }
  },

  resumir(_ctx, cuentas: CuentasJob): string {
    const base = `${cuentas.procesados} referencias con tarifas de Amazon estimadas en ${cuentas.lotes} lotes`
    return cuentas.omitidos > 0
      ? `${base}, y ${cuentas.omitidos} sin tarifa —sin precio o rechazadas por Amazon—, que quedan como «no evaluable».`
      : `${base}.`
  },
}
