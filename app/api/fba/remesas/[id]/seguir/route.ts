import { NextResponse } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { connectionCredentials } from '@/lib/amazon/data'
import { requireFbaAccess } from '@/lib/fba/acceso'
import { estadoDeEnvios, lineasDeEnvio } from '@/lib/fba/inbound'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * PREGUNTARLE A AMAZON AHORA MISMO POR ESTE ENVÍO.
 *
 * El nº de envío FBA se escribe a mano en la ficha, en cuanto se crea el envío en
 * Seller Central. Hasta ahora, escribirlo no hacía nada visible: la pasada
 * nocturna lo recogía esa noche y hasta entonces la ficha seguía diciendo
 * «pendiente de consultar». Quien acaba de pegar un número quiere saber si está
 * bien escrito, y eso son veinticuatro horas de espera para descubrir una errata.
 *
 * Esto hace lo mismo que la pasada nocturna pero para UNA remesa y al pulsarlo:
 * pide el estado del envío y cuántas unidades ha recibido Amazon de cada
 * referencia, y lo guarda.
 *
 *
 * ============ POR QUÉ IMPORTA LO RECIBIDO Y NO LO DECLARADO ============
 *
 * Porque es lo que de verdad hay en el almacén. Si se mandaron 100 y Amazon
 * recibió 95 —una caja perdida, unidades dañadas—, descontar las ventas de 100
 * deja un fantasma de cinco unidades que no se agota nunca y tapa el día en que
 * la referencia se queda sin stock. El reparto FIFO usa `unidades_recibidas` en
 * cuanto existe (ver lib/fba/fifo.ts).
 *
 *
 * ============ DOS LLAMADAS A AMAZON, Y POR ESO NO ES AUTOMÁTICO ============
 *
 * `getInboundShipments` y `getShipmentItems`. El cupo de la API es del cliente y
 * esta pantalla la abren varias personas al día: hacerlo en cada carga gastaría
 * el cupo en preguntar lo mismo. Va a botón, que es cuando alguien quiere saber.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    if (!UUID.test(params.id)) return fail(400, 'Esa remesa no existe')

    const sesion = await requireFbaAccess('editar')
    if (sesion instanceof NextResponse) return sesion

    const service = createServiceClient()
    const { data } = await service
      .from('fba_remesas')
      .select('id, client_id, connection_id, marketplace_id, referencia_envio')
      .eq('id', params.id)
      .maybeSingle()
    if (!data) return fail(404, 'Esa remesa ya no existe')

    const remesa = data as {
      id: string
      client_id: string
      connection_id: string | null
      marketplace_id: string
      referencia_envio: string | null
    }
    const editables = sesion.clientesEditables
    if (editables !== null && !editables.includes(remesa.client_id)) {
      return fail(404, 'Esa remesa ya no existe')
    }

    if (!remesa.referencia_envio) {
      return fail(
        400,
        'Esta remesa no tiene número de envío. Escríbelo arriba —lo da Seller Central al crear el ' +
          'envío, y empieza por FBA— y vuelve a pulsar.'
      )
    }
    if (!remesa.connection_id) {
      return fail(
        409,
        'Este cliente no tiene conectada su cuenta de Amazon, así que no se le puede preguntar nada. ' +
          'Las unidades recibidas habrá que apuntarlas a mano.'
      )
    }

    const resuelta = await connectionCredentials(remesa.connection_id)
    if (!resuelta) {
      return fail(409, 'La conexión de Amazon de este cliente ya no sirve: hay que volver a autorizarla.')
    }
    const credenciales = resuelta.credentials

    const estados = await estadoDeEnvios(credenciales, remesa.marketplace_id, [remesa.referencia_envio])
    const info = estados.get(remesa.referencia_envio)

    if (!info) {
      // Casi siempre es una errata en el número, y es JUSTO lo que se viene a
      // descubrir aquí en vez de dentro de veinticuatro horas. Se deja escrito en
      // la propia remesa para que la ficha lo diga sola a partir de ahora.
      await service
        .from('fba_remesas')
        .update({
          seguimiento_at: new Date().toISOString(),
          seguimiento_error: 'Amazon no reconoce este número de envío',
        })
        .eq('id', params.id)
      return fail(
        404,
        `Amazon no reconoce el envío «${remesa.referencia_envio}». Comprueba el número en Seller ` +
          'Central: es el que empieza por FBA, no el de la remesa ni el del transportista.'
      )
    }

    // Las unidades recibidas, referencia a referencia. Es lo que convierte un
    // descuadre en una reclamación con envío y SKU.
    const lineas = await lineasDeEnvio(credenciales, remesa.marketplace_id, remesa.referencia_envio)
    let actualizadas = 0
    let faltan = 0
    for (const l of lineas) {
      const { error } = await service
        .from('fba_remesa_lineas')
        .update({ unidades_recibidas: l.recibidas, updated_at: new Date().toISOString() })
        .eq('remesa_id', params.id)
        .eq('sku', l.sku)
      if (!error) {
        actualizadas += 1
        if (l.recibidas < l.enviadas) faltan += l.enviadas - l.recibidas
      }
    }

    await service
      .from('fba_remesas')
      .update({
        estado_amazon: info.estado,
        seguimiento_at: new Date().toISOString(),
        seguimiento_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', params.id)

    return NextResponse.json({
      ok: true,
      estado: info.estado,
      centro: info.centro,
      referencias: actualizadas,
      // Lo que se mandó y Amazon no dio por recibido. Cero es la respuesta buena.
      faltan,
    })
  } catch (error) {
    return errorResponse(error, 'No se ha podido consultar el envío en Amazon')
  }
}
