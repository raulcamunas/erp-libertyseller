import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { fiscalDe, guardarFiscal } from '@/lib/plataforma/fbmfba/datos'
import { fiscalSinConfigurar } from '@/lib/plataforma/fbmfba/fiscal'
import { FALTAN_MIGRACIONES_A4, faltaEsquema } from '@/lib/plataforma/fbmfba/pantalla'

/**
 * EL IMPUESTO DE UN MARKETPLACE.
 *
 * SOLO ADMIN. Son DOS datos y los dos hacen falta: el tipo, y SI EL PRECIO DE
 * LISTING LO LLEVA DENTRO. En la Unión Europea sí; en Estados Unidos el sales
 * tax se añade en el pago y dividir por (1 + IVA) allí hunde el margen un 20 %
 * sin dar ningún aviso, porque el número que sale es perfectamente creíble.
 *
 * Ningún endpoint de la SP-API da el tipo con los roles concedidos —los informes
 * de IVA están detrás de roles fiscales restringidos que no están—, así que esto
 * es forzosamente una tabla de configuración CON FECHA DE VIGENCIA Y CON DUEÑO:
 * los tipos cambian por ley y el margen de marzo se calcula con el tipo de
 * marzo. Por eso guardar no sobreescribe: cada `validoDesde` es un tramo.
 *
 * `clientId` puede venir a null y ES EL PUNTO DE LA TABLA: sin cliente se
 * escribe la regla general del marketplace, que vale para los dieciséis; con
 * cliente se escribe su excepción, porque el régimen fiscal no es solo del país.
 */
export const dynamic = 'force-dynamic'

export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const cuerpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!cuerpo) return fail(400, 'No ha llegado nada que guardar')

    const marketplaceId =
      typeof cuerpo.marketplaceId === 'string' ? cuerpo.marketplaceId.trim() : ''
    if (marketplaceId === '') return fail(400, 'Falta el país al que se refiere el impuesto')

    // A null a propósito cuando no viene: es la regla general del marketplace.
    const clientId = typeof cuerpo.clientId === 'string' ? cuerpo.clientId : null
    if (clientId !== null && !UUID.test(clientId)) return fail(400, 'Ese cliente no es válido')

    if (typeof cuerpo.precioIncluyeImpuesto !== 'boolean') {
      return fail(
        400,
        'Hay que decir si el precio de este país lleva el impuesto dentro. No hay valor por defecto ' +
          'a propósito: en la Unión Europea lo lleva y en Estados Unidos no, y suponerlo mueve el ' +
          'margen un 20 % sin que se note.'
      )
    }
    const precioIncluyeImpuesto = cuerpo.precioIncluyeImpuesto

    let ivaPorcentaje: number | null = null
    if (cuerpo.ivaPorcentaje !== null && cuerpo.ivaPorcentaje !== undefined && cuerpo.ivaPorcentaje !== '') {
      const n = typeof cuerpo.ivaPorcentaje === 'number' ? cuerpo.ivaPorcentaje : Number(cuerpo.ivaPorcentaje)
      if (!Number.isFinite(n) || n < 0 || n >= 100) {
        return fail(400, 'El tipo de IVA tiene que ser un número entre 0 y 100.')
      }
      ivaPorcentaje = n
    }

    // Con el impuesto DENTRO del precio, el tipo no es opcional: es el número por
    // el que se divide. Sin él no hay base imponible y no hay margen.
    if (precioIncluyeImpuesto && ivaPorcentaje === null) {
      return fail(
        400,
        'Si el precio lleva el impuesto dentro hace falta el tipo: es el número por el que se divide ' +
          'para llegar a la base imponible.'
      )
    }

    const validoDesde =
      typeof cuerpo.validoDesde === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cuerpo.validoDesde)
        ? cuerpo.validoDesde
        : new Date().toISOString().slice(0, 10)

    await guardarFiscal(
      {
        marketplaceId,
        clientId,
        ivaPorcentaje,
        precioIncluyeImpuesto,
        validoDesde,
        notas:
          typeof cuerpo.notas === 'string' && cuerpo.notas.trim() !== ''
            ? cuerpo.notas.trim().slice(0, 1000)
            : null,
      },
      session.userId
    )

    const hoy = new Date().toISOString().slice(0, 10)
    const mapa = await fiscalDe(clientId, [marketplaceId], hoy)

    return NextResponse.json({
      fiscal: mapa.get(marketplaceId) ?? fiscalSinConfigurar(marketplaceId),
      mensaje:
        validoDesde > hoy
          ? `Guardado con vigencia desde el ${validoDesde}: hasta esa fecha se sigue calculando con el tramo anterior.`
          : 'Guardado. El análisis ya puede llevar el precio a base imponible en este país.',
    })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES_A4)
    return errorResponse(error, 'Error guardando el impuesto del marketplace')
  }
}
