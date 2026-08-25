/**
 * LAS TARIFAS QUE COBRA AMAZON POR VENDER UN SKU
 * ==============================================
 * SOLO SERVIDOR. Solo lee: aquí no se le escribe nada a Amazon.
 *
 * `getMyFeesEstimates` — hasta 20 SKU por llamada, una llamada cada dos
 * segundos. Devuelve la comisión de referencia y, si el SKU lo gestiona Amazon,
 * la tarifa de logística.
 *
 *
 * ============ LO QUE HAY QUE ENTENDER ANTES DE TOCAR ESTO ============
 *
 * 1. LA TARIFA SE PIDE A UN PRECIO, Y ESE PRECIO FORMA PARTE DEL DATO.
 *
 *    La comisión de referencia es un porcentaje CON MÍNIMOS, y la de logística
 *    depende del tramo de tamaño y peso. La tarifa que Amazon calcula para 30 €
 *    NO sirve para evaluar una venta a 18 €: por debajo del mínimo el porcentaje
 *    deja de aplicarse y el número real es otro.
 *
 *    Por eso se guarda `precio_referencia` junto a los importes, y por eso
 *    lib/plataforma/fbmfba/margen.ts se niega a usar una tarifa pedida a un
 *    precio que se aleja demasiado del que se está evaluando. Extrapolar sería
 *    inventarse la cifra, y hacia el lado bueno: siempre saldría un margen mejor
 *    del real.
 *
 * 2. `IsAmazonFulfilled` DECIDE SI VIENE LA TARIFA DE FBA, y no es una opción de
 *    presentación: es la pregunta. Con `true` Amazon incluye la tarifa de
 *    gestión logística; con `false` solo la comisión, porque el envío lo pone el
 *    vendedor y Amazon no lo sabe.
 *
 *    Se pregunta por el canal QUE TIENE HOY el SKU. El escenario contrario —«¿y
 *    si lo pasara a FBA?»— es otra pregunta y otra llamada, y de eso se ocupa el
 *    módulo FBM→FBA.
 *
 * 3. LOS ERRORES SON POR ELEMENTO, NO POR LOTE. Cada resultado trae su `Status`:
 *    un SKU puede fallar y los otros diecinueve venir bien. Tratar el lote como
 *    un todo tiraría diecinueve tarifas buenas por una mala.
 *
 * 4. EL TIPO DE TARIFA ES UN ENUM ABIERTO. `ReferralFee` y `FBAFees` son los que
 *    interesan, pero Amazon manda más y puede añadir. Lo que no se sabe clasificar
 *    NO se descarta: va a `otras`, para que el total siga cuadrando. Meterlo en
 *    cero haría que el margen saliera mejor de lo que es.
 */

import { spApiRequest, type AmazonCredentials } from '@/lib/amazon/sp-api'

/** Cuántos SKU admite una llamada */
export const MAX_SKUS_TARIFAS = 20

export interface PeticionTarifa {
  sku: string
  /** El precio al que se quiere saber la tarifa. Ver la nota 1 */
  precio: number
  moneda: string
  /** Si HOY lo gestiona Amazon. Ver la nota 2 */
  esFba: boolean
}

export interface TarifaSku {
  sku: string
  precioReferencia: number
  moneda: string
  /** Comisión de referencia. null = Amazon no la ha desglosado */
  referral: number | null
  /** Tarifa de gestión logística. null en un SKU que no es de FBA */
  fba: number | null
  /** Todo lo demás que venga desglosado. Ver la nota 4 */
  otras: number | null
  /** Lo que dice Amazon que suma todo. Es la referencia para cuadrar */
  total: number | null
}

export interface FalloTarifa {
  sku: string
  /** El código de Amazon, sin traducir: el enum no es cerrado */
  codigo: string
  mensaje: string
}

export interface LecturaTarifas {
  porSku: Map<string, TarifaSku>
  fallos: FalloTarifa[]
  /** Pedidos que no han vuelto ni con tarifa ni con error */
  ausentes: string[]
  /** Tipos de tarifa que no sabemos clasificar. Para poder añadirlos */
  tiposDesconocidos: string[]
  requestId: string | null
}

/* ------------------------------------------------------------------ */
/* La respuesta cruda                                                  */
/* ------------------------------------------------------------------ */

interface ImporteCrudo {
  CurrencyCode?: unknown
  Amount?: unknown
}

interface DetalleCrudo {
  FeeType?: unknown
  FeeAmount?: ImporteCrudo
  FeePromotion?: ImporteCrudo
  FinalFee?: ImporteCrudo
}

interface ResultadoCrudo {
  Status?: unknown
  FeesEstimateIdentifier?: {
    IdValue?: unknown
    PriceToEstimateFees?: { ListingPrice?: ImporteCrudo }
  }
  FeesEstimate?: {
    TotalFeesEstimate?: ImporteCrudo
    FeeDetailList?: DetalleCrudo[]
  }
  Error?: { Code?: unknown; Message?: unknown }
}

/**
 * TRES FORMAS, Y HAY QUE ADMITIR LAS TRES.
 *
 * `getMyFeesEstimates` es el endpoint por lotes y devuelve una LISTA PELADA en
 * la raíz; sus hermanos de un solo SKU envuelven en `payload` o en
 * `FeesEstimateResultList`. La documentación de Amazon enseña unas u otras según
 * qué página mires y según la versión del ejemplo.
 *
 * Aquí se admitían dos de las tres, y la que faltaba era justo la del endpoint
 * que usamos. Con la lista en la raíz, `crudo.FeesEstimateResultList` es
 * `undefined`, `lista` sale vacía, y NO PASA NADA MÁS: cero tarifas, cero
 * fallos, cero avisos, el trabajo en verde. Que es exactamente lo que llevaba
 * pasando.
 */
type RespuestaCruda =
  | ResultadoCrudo[]
  | {
      FeesEstimateResultList?: ResultadoCrudo[]
      payload?: { FeesEstimateResultList?: ResultadoCrudo[] }
    }

/** Los que sabemos clasificar. El resto suma en `otras`. Ver la nota 4 */
const ES_REFERRAL = new Set(['ReferralFee'])
const ES_FBA = new Set(['FBAFees', 'FBAPerUnitFulfillmentFee', 'FulfillmentFees'])

/* ------------------------------------------------------------------ */
/* La llamada                                                          */
/* ------------------------------------------------------------------ */

export async function leerTarifas(
  creds: AmazonCredentials,
  params: { marketplaceId: string; peticiones: PeticionTarifa[] }
): Promise<LecturaTarifas> {
  const vacio: LecturaTarifas = {
    porSku: new Map(),
    fallos: [],
    ausentes: [],
    tiposDesconocidos: [],
    requestId: null,
  }
  if (params.peticiones.length === 0) return vacio
  if (params.peticiones.length > MAX_SKUS_TARIFAS) {
    throw new Error(
      `getMyFeesEstimates admite ${MAX_SKUS_TARIFAS} SKU por llamada y se le han pasado ${params.peticiones.length}`
    )
  }

  const { data, requestId } = await spApiRequest<RespuestaCruda>(creds, 'getMyFeesEstimates', {
    method: 'POST',
    path: '/products/fees/v0/feesEstimate',
    /**
     * ES UN POST QUE NO ESCRIBE NADA, Y SIN ESTA LÍNEA NO SE REINTENTABA NUNCA.
     *
     * `spApiRequest` solo repite un 429 si la llamada es GET o viene marcada
     * como repetible —por defecto false, que es lo correcto para las
     * escrituras—. Esta es una ESTIMACIÓN: pregunta cuánto cobraría Amazon por
     * vender a un precio dado y no cambia absolutamente nada en la tienda del
     * cliente. Repetirla es gratis y seguro.
     *
     * Lo que costó no marcarlo: el 429 salía del `for` en el primer intento,
     * sin esperar y sin mirar la cabecera `Retry-After` que Amazon manda con la
     * respuesta. El lote moría, el trabajo se rendía por esa pasada, y cinco
     * minutos después volvía a empezar para morir igual. 93 fallos idénticos y
     * 7 horas y 45 minutos de reloj para traer cero tarifas.
     *
     * Con esto, un 429 espera lo que Amazon diga —o el backoff creciente si no
     * lo dice— y vuelve a intentarlo, que es lo que lleva haciendo el resto del
     * módulo desde el principio.
     */
    repeatable: true,
    body: params.peticiones.map((p) => ({
      FeesEstimateRequest: {
        MarketplaceId: params.marketplaceId,
        IsAmazonFulfilled: p.esFba,
        PriceToEstimateFees: {
          ListingPrice: { CurrencyCode: p.moneda, Amount: p.precio },
        },
        // El identificador vuelve en la respuesta y es lo ÚNICO que casa cada
        // resultado con su petición: el orden de la lista no está garantizado.
        Identifier: p.sku,
      },
      IdType: 'SellerSKU',
      IdValue: p.sku,
    })),
  })

  return interpretar(data, params.peticiones, requestId)
}

/* ------------------------------------------------------------------ */
/* La interpretación, aparte para poder comprobarla sin red            */
/* ------------------------------------------------------------------ */

export function interpretar(
  crudo: RespuestaCruda | null | undefined,
  peticiones: PeticionTarifa[],
  requestId: string | null
): LecturaTarifas {
  const porSku = new Map<string, TarifaSku>()
  const fallos: FalloTarifa[] = []
  const tiposDesconocidos: string[] = []
  const vistos = new Set<string>()

  // Ver RespuestaCruda: la lista puede venir pelada en la raíz, dentro de
  // `FeesEstimateResultList` o dentro de `payload`.
  const lista: ResultadoCrudo[] = Array.isArray(crudo)
    ? crudo
    : (crudo?.FeesEstimateResultList ?? crudo?.payload?.FeesEstimateResultList ?? [])
  const porPeticion = new Map(peticiones.map((p) => [p.sku, p]))

  for (const resultado of lista) {
    const sku = texto(resultado.FeesEstimateIdentifier?.IdValue)
    if (!sku) continue
    vistos.add(sku)

    if (texto(resultado.Status) !== 'Success') {
      fallos.push({
        sku,
        codigo: texto(resultado.Error?.Code) ?? 'desconocido',
        mensaje: texto(resultado.Error?.Message) ?? 'Amazon no ha dicho por qué',
      })
      continue
    }

    const pedida = porPeticion.get(sku)
    /**
     * El precio que se guarda es el que DEVUELVE Amazon si lo devuelve, y el que
     * se pidió si no. No es lo mismo: si Amazon redondea o normaliza el importe,
     * la tarifa corresponde al suyo, y guardar el nuestro haría que la tarifa y
     * su precio de referencia no casaran.
     */
    const precio =
      numero(resultado.FeesEstimateIdentifier?.PriceToEstimateFees?.ListingPrice?.Amount) ??
      pedida?.precio ??
      null
    const moneda =
      texto(resultado.FeesEstimateIdentifier?.PriceToEstimateFees?.ListingPrice?.CurrencyCode) ??
      pedida?.moneda ??
      null

    if (precio === null || moneda === null) {
      // Un importe sin precio de referencia o sin divisa no se puede comparar
      // con nada. Se cuenta como fallo en vez de guardarse a medias.
      fallos.push({
        sku,
        codigo: 'sin_precio_referencia',
        mensaje:
          'La tarifa ha vuelto sin el precio o la divisa a la que se calculó, y sin eso no se puede ' +
          'usar: una comisión es un porcentaje de algo.',
      })
      continue
    }

    let referral: number | null = null
    let fba: number | null = null
    let otras: number | null = null

    for (const detalle of resultado.FeesEstimate?.FeeDetailList ?? []) {
      // FinalFee es lo que se cobra de verdad —ya con la promoción aplicada—;
      // FeeAmount es el bruto. Usar el bruto inflaría el coste y haría que el
      // margen saliera PEOR del real, que es el error menos peligroso de los dos
      // pero sigue siendo un número falso.
      const importe = numero(detalle.FinalFee?.Amount) ?? numero(detalle.FeeAmount?.Amount)
      if (importe === null) continue
      const tipo = texto(detalle.FeeType) ?? ''

      if (ES_REFERRAL.has(tipo)) referral = (referral ?? 0) + importe
      else if (ES_FBA.has(tipo)) fba = (fba ?? 0) + importe
      else {
        otras = (otras ?? 0) + importe
        if (tipo && !tiposDesconocidos.includes(tipo)) tiposDesconocidos.push(tipo)
      }
    }

    porSku.set(sku, {
      sku,
      precioReferencia: precio,
      moneda,
      referral,
      fba,
      otras,
      total: numero(resultado.FeesEstimate?.TotalFeesEstimate?.Amount),
    })
  }

  return {
    porSku,
    fallos,
    // Ni tarifa ni error: Amazon simplemente no ha contestado por ese SKU. Se
    // cuenta aparte porque un silencio no es un fallo y no debe rendir el lote.
    ausentes: peticiones.map((p) => p.sku).filter((sku) => !vistos.has(sku)),
    tiposDesconocidos,
    requestId,
  }
}

function texto(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : null
}

function numero(valor: unknown): number | null {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null
  if (typeof valor === 'string' && valor.trim() !== '') {
    const n = Number(valor)
    return Number.isFinite(n) ? n : null
  }
  return null
}
