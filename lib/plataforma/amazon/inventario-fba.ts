/**
 * FBA INVENTORY v1: EL STOCK QUE TIENE AMAZON
 * ===========================================
 * SOLO SERVIDOR.
 *
 *
 * LO ÚNICO QUE HAY QUE ENTENDER DE ESTE FICHERO
 * --------------------------------------------
 *   ESTA API SOLO CONOCE LA RED LOGÍSTICA DE AMAZON.
 *   UN SKU QUE GESTIONA EL VENDEDOR NO SALE EN LA RESPUESTA.
 *   NO SALE CON CANTIDAD CERO: NO SALE.
 *
 * Sin error, sin marca, sin hueco. Y ahí está el fallo que arrastraría todo lo
 * que se construya encima: si el código interpreta «no vino en la respuesta»
 * como «stock 0», entonces
 *
 *   · en el piloto (Liberty UpGrowth), el artículo de muestra que está en FBM
 *     aparece sin existencias, dispara una alerta de stock crítico falsa, y en
 *     A2 se diagnostica como «Sin stock → Reponer» cuando en realidad tiene
 *     inventario propio;
 *   · en ShoesF, que es mayoría FBM con ~13.700 referencias, el 90 % del
 *     catálogo aparece de golpe como agotado.
 *
 * Por eso esta función devuelve un MAPA de lo que Amazon ha dicho —ni más ni
 * menos— y NUNCA rellena huecos. Quién es FBM y quién no lo decide el canal de
 * logística del catálogo (`fulfillment_channel_code`, del informe del censo),
 * no la ausencia en esta respuesta. Ver lib/plataforma/tareas/inventario-fba.ts,
 * que es donde se cruzan las dos cosas y donde se escriben los tres estados
 * posibles: conocido / no_aplica / desconocido.
 *
 *
 * Y UNA COSA DE MECÁNICA: EL nextToken CADUCA A LOS 30 SEGUNDOS
 * ------------------------------------------------------------
 * O sea que la paginación NO SE PUEDE PARTIR entre dos pasadas del cron ni
 * pausar en medio. O se recorre entera de una vez, o se empieza otra vez desde
 * el principio. Por eso esta función pagina hasta el final por dentro y por eso
 * el cursor del trabajo que la usa es la unidad (conexión × marketplace) y no la
 * página. A 2 peticiones por segundo son medio segundo por página: hay margen de
 * sobra frente a los treinta segundos, pero no lo hay para dejarlo a medias.
 */

import { AmazonApiError } from '@/lib/amazon/errors'
import { spApiRequest, type AmazonCredentials } from '@/lib/amazon/sp-api'
import { isMfnChannel } from '@/lib/types/amazon'
import type { EstadoDatoInventario, OrigenSnapshotInventario } from '../tipos'

/** Cuántos SKU admite el filtro `sellerSkus` de esta operación */
export const MAX_SKUS_FILTRO = 50

export interface ExistenciasFba {
  sku: string
  asin: string | null
  fnsku: string | null
  /** Lo que se puede coger, empaquetar y enviar HOY */
  disponible: number | null
  /** Comprometido: pedidos pendientes, traslados entre centros, procesamiento */
  reservado: number | null
  inboundWorking: number | null
  inboundEnviado: number | null
  inboundRecibiendo: number | null
  /** Invendible: caducado, dañado, defectuoso. Es dinero parado que el cliente
      cree que tiene */
  invendible: number | null
  /** En investigación: extraviado o dañado dentro del almacén */
  investigando: number | null
  total: number | null
  actualizadoAt: string | null
}

export interface LecturaInventarioFba {
  /** Clave = SKU del vendedor. SOLO lo que Amazon ha devuelto */
  existencias: Map<string, ExistenciasFba>
  paginas: number
  requestId: string | null
  /** true si se alcanzó el tope de páginas y la lectura está incompleta */
  truncado: boolean
}

interface DetalleCrudo {
  fulfillableQuantity?: number
  inboundWorkingQuantity?: number
  inboundShippedQuantity?: number
  inboundReceivingQuantity?: number
  reservedQuantity?: { totalReservedQuantity?: number }
  unfulfillableQuantity?: { totalUnfulfillableQuantity?: number }
  researchingQuantity?: { totalResearchingQuantity?: number }
}

interface RespuestaResumenes {
  payload?: {
    inventorySummaries?: Array<{
      sellerSku?: string
      asin?: string
      fnSku?: string
      totalQuantity?: number
      lastUpdatedTime?: string
      inventoryDetails?: DetalleCrudo
    }>
    /** En esta API el token viene DENTRO del payload, no en `pagination` */
    nextToken?: string
  }
  pagination?: { nextToken?: string }
}

/**
 * Lee el inventario de Amazon de un marketplace entero.
 *
 * `details: true` no es opcional: sin él, `inventoryDetails` NO VIENE y lo único
 * que se obtiene es la cantidad total. Es el error número uno con esta
 * operación, y se nota tarde: la lectura «funciona» y todas las columnas de
 * reservado, invendible e inbound salen a null.
 *
 * `skus` sirve para leer un subconjunto (hasta 50). Es lo que hace que un
 * trabajo se pueda probar sobre veinte referencias sin barrer el catálogo.
 */
export async function leerInventarioFba(
  creds: AmazonCredentials,
  params: {
    marketplaceId: string
    skus?: string[] | null
    maxPaginas?: number
  }
): Promise<LecturaInventarioFba> {
  const existencias = new Map<string, ExistenciasFba>()
  const maxPaginas = params.maxPaginas ?? 400

  const filtro = params.skus && params.skus.length > 0 ? [...new Set(params.skus)] : null
  if (filtro && filtro.length > MAX_SKUS_FILTRO) {
    throw new AmazonApiError({
      kind: 'peticion',
      message: `sellerSkus con ${filtro.length} valores`,
      humanMessage: `El filtro por SKU de esta lectura admite ${MAX_SKUS_FILTRO} referencias como mucho.`,
    })
  }

  let nextToken: string | undefined
  let paginas = 0
  let requestId: string | null = null

  do {
    const respuesta = await spApiRequest<RespuestaResumenes>(creds, 'getInventorySummaries', {
      method: 'GET',
      path: '/fba/inventory/v1/summaries',
      query: {
        granularityType: 'Marketplace',
        granularityId: params.marketplaceId,
        marketplaceIds: [params.marketplaceId],
        details: true,
        sellerSkus: filtro ?? undefined,
        nextToken,
      },
    })
    requestId = respuesta.requestId ?? requestId

    for (const fila of respuesta.data.payload?.inventorySummaries ?? []) {
      if (!fila.sellerSku) continue
      const d = fila.inventoryDetails
      existencias.set(fila.sellerSku, {
        sku: fila.sellerSku,
        asin: fila.asin ?? null,
        fnsku: fila.fnSku ?? null,
        disponible: entero(d?.fulfillableQuantity),
        reservado: entero(d?.reservedQuantity?.totalReservedQuantity),
        inboundWorking: entero(d?.inboundWorkingQuantity),
        inboundEnviado: entero(d?.inboundShippedQuantity),
        inboundRecibiendo: entero(d?.inboundReceivingQuantity),
        invendible: entero(d?.unfulfillableQuantity?.totalUnfulfillableQuantity),
        investigando: entero(d?.researchingQuantity?.totalResearchingQuantity),
        total: entero(fila.totalQuantity),
        actualizadoAt: fila.lastUpdatedTime ?? null,
      })
    }

    nextToken = respuesta.data.pagination?.nextToken ?? respuesta.data.payload?.nextToken
    paginas += 1
  } while (nextToken && paginas < maxPaginas)

  return {
    existencias,
    paginas,
    requestId,
    // Quedarse a medias tiene que verse: media lectura de inventario es
    // indistinguible de un catálogo con la mitad de los SKU sin stock.
    truncado: Boolean(nextToken),
  }
}

/**
 * Un entero, o null.
 *
 * `null` y `0` NO son lo mismo aquí y por eso no hay ningún `?? 0` en este
 * fichero: cero significa «Amazon tiene cero unidades», null significa «Amazon
 * no ha dicho nada de esto». La diferencia es la que separa una alerta de
 * reposición correcta de una falsa.
 */
function entero(valor: unknown): number | null {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0) return null
  return Math.round(valor)
}

/* ------------------------------------------------------------------ */
/* LA DECISIÓN: QUÉ SIGNIFICA QUE UN SKU NO ESTÉ EN LA RESPUESTA       */
/* ------------------------------------------------------------------ */

/** Lo que hace falta saber de un SKU, sacado del espejo del catálogo */
export interface SkuParaInventario {
  sku: string
  /** El canal crudo de Amazon: 'DEFAULT' es del vendedor, lo demás es de Amazon */
  canal: string | null
  /** La columna generada is_fba del espejo */
  esFba: boolean
  /** Stock del propio vendedor. Solo significa algo si el SKU es de FBM */
  cantidadPropia: number | null
}

export interface Clasificacion {
  estadoDato: EstadoDatoInventario
  origen: OrigenSnapshotInventario
  /** Las cantidades de Amazon. null salvo cuando el estado es 'conocido' */
  existencias: ExistenciasFba | null
  stockPropio: number | null
  /** Por qué, en español. Es lo que se cuenta cuando hay muchos iguales */
  motivo: string
}

/**
 * Decide qué se guarda de un SKU. ES PURA: sin red y sin base de datos.
 *
 * ESTA FUNCIÓN ES EL MOTIVO DE QUE EL MÓDULO SEA CORRECTO, así que conviene
 * leerla entera. El orden de las tres preguntas no es intercambiable:
 *
 *   1. ¿LO GESTIONA EL VENDEDOR? Se pregunta PRIMERO y al catálogo, nunca a la
 *      respuesta de Amazon. Un SKU de FBM no sale en getInventorySummaries, así
 *      que si se mirara la respuesta antes que el canal, todo el FBM caería en
 *      «no ha venido» y de ahí a «cero» hay un paso que alguien acaba dando.
 *      Con canal 'DEFAULT' la respuesta es: Amazon no tiene nada de esto y ESO
 *      ESTÁ BIEN. no_aplica, y se guarda el stock propio, que es el número que
 *      sí significa algo para ese SKU.
 *
 *   2. ¿SABEMOS SIQUIERA QUIÉN LO GESTIONA? Si el canal no consta —Amazon a
 *      veces no devuelve el bloque de logística— no se supone nada:
 *      'desconocido'. Es el mismo criterio que ya aplica el envío de stock, que
 *      ante la duda no escribe. Suponer FBM aquí y guardar un cero sería
 *      inventarse un dato de la tienda de un cliente.
 *
 *   3. ¿ES DE FBA Y AMAZON LO HA DEVUELTO? Solo entonces las cantidades son de
 *      verdad. Si es de FBA y NO ha venido, 'desconocido': puede que el listing
 *      se haya pasado a FBM y nuestro espejo esté viejo, o que sea un SKU
 *      archivado. Lo que no puede ser es cero.
 *
 * Nunca devuelve cero por ausencia. Ni una vez.
 */
export function clasificarExistencias(
  sku: SkuParaInventario,
  existencias: Map<string, ExistenciasFba>
): Clasificacion {
  // ---------- 1) FBM ----------
  if (isMfnChannel(sku.canal)) {
    return {
      estadoDato: 'no_aplica',
      // 'listings' y no 'fba_inventory': el dato que se guarda sale de nuestro
      // espejo del catálogo. La API de inventario no ha dicho una palabra de
      // este SKU, y apuntar que sí sería atribuirle una lectura que no hizo.
      origen: 'listings',
      existencias: null,
      stockPropio: sku.cantidadPropia,
      motivo:
        'Lo gestiona el vendedor: Amazon no guarda existencias suyas. No es que no tenga stock, ' +
        'es que su stock no está en Amazon.',
    }
  }

  // ---------- 2) Canal desconocido ----------
  if (!sku.esFba) {
    return {
      estadoDato: 'desconocido',
      origen: 'listings',
      existencias: null,
      stockPropio: null,
      motivo:
        'No consta quién gestiona la logística de este SKU, así que no se puede saber si Amazon ' +
        'debería tener existencias suyas. Refresca el catálogo.',
    }
  }

  // ---------- 3) FBA ----------
  const fba = existencias.get(sku.sku)
  if (!fba) {
    return {
      estadoDato: 'desconocido',
      origen: 'fba_inventory',
      existencias: null,
      stockPropio: null,
      motivo:
        'Nuestro catálogo lo da por FBA pero Amazon no lo ha devuelto. Puede que haya pasado a ' +
        'gestión del vendedor, o que esté archivado. No se guarda como cero.',
    }
  }

  return {
    estadoDato: 'conocido',
    origen: 'fba_inventory',
    existencias: fba,
    stockPropio: null,
    motivo: 'Lo gestiona Amazon y ha devuelto sus existencias.',
  }
}
