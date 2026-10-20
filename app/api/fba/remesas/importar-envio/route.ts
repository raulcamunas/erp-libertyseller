import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { connectionCredentials } from '@/lib/amazon/data'
import { requireFbaAccess } from '@/lib/fba/acceso'
import { estadoDeEnvios, lineasDeEnvio } from '@/lib/fba/inbound'
import { mercadoDeEnvio, mercadosQueVendeLaCuenta, participaEn, type ConexionParaMercado } from '@/lib/fba/mercados'
import { anotarSeguimiento } from '@/lib/fba/seguimiento'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * TRAER UN ENVÍO QUE YA EXISTE EN AMAZON, POR SU NÚMERO FBA.
 *
 *   buscar   pregunta a Amazon por el envío y devuelve su estado y sus referencias
 *            con lo enviado y lo recibido. No escribe nada.
 *   crear    da de alta la remesa con esas líneas, ya enlazada al envío. A partir de
 *            ahí se sigue sola: estado cada hora y ventas día a día.
 *
 * Es lo contrario de montar la lista a mano: el envío ya está hecho en Seller
 * Central, así que lo que se mandó lo dice Amazon, no se vuelve a teclear.
 *
 * LA REMESA NACE EN «ENVIADA» (o «CERRADA» si Amazon ya lo cerró), NO EN BORRADOR:
 * el borrador es una propuesta que espera la aprobación del cliente, y aquí la
 * mercancía ya está en camino o en el almacén.
 *
 * LA FECHA con la que empieza a contar las ventas es la que se elige aquí; en
 * cuanto el libro mayor confirme la llegada, manda la de la llegada.
 *
 * EL MERCADO NO SE DA POR ESPAÑA. El diálogo lo pide España por costumbre, pero la
 * cuenta puede vender en otro sitio (Portico LLC es de Norteamérica, con todos sus
 * productos en Amazon.com): ver lib/fba/mercados.ts. Se comprueba contra lo que la
 * cuenta vende y, si no cuadra, se elige donde tiene sus productos en FBA. La
 * respuesta de `buscar` dice cuál se ha elegido para que la pantalla lo enseñe.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const FBA = /^FBA[0-9A-Z]{6,20}$/

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      accion?: string
      clienteId?: string
      marketplaceId?: string
      shipmentId?: string
      nombre?: string
      fechaEnvio?: string
    }

    const clienteId = (body.clienteId ?? '').trim()
    if (!UUID.test(clienteId)) return fail(400, 'Elige el cliente de la remesa')
    const sesion = await requireFbaAccess('editar', clienteId)
    if (sesion instanceof NextResponse) return sesion

    const mercadoPedido = (body.marketplaceId ?? '').trim().slice(0, 20)
    const shipmentId = (body.shipmentId ?? '').trim().toUpperCase()
    if (!FBA.test(shipmentId)) {
      return fail(400, 'El número de envío empieza por FBA y lo da Seller Central (por ejemplo FBA15ML7ZSVQ).')
    }

    const service = createServiceClient()

    const { data: conexion } = await service
      .from('amazon_connections')
      .select('id, marketplace_ids, marketplaces_activos, default_marketplace_id')
      .eq('client_id', clienteId)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    const datosConexion = conexion as ({ id: string } & ConexionParaMercado) | null
    const connectionId = datosConexion?.id
    if (!datosConexion || !connectionId) {
      return fail(409, 'Este cliente no tiene conectada su cuenta de Amazon, así que no se puede preguntar por el envío.')
    }

    // Los productos en FBA por mercado solo hacen falta cuando lo pedido no es un mercado de la cuenta
    // (el caso de siempre, un cliente de España que pide España, no gasta esta consulta)
    let fbaPorMercado: Map<string, number> | undefined
    if (!mercadoPedido || !participaEn(datosConexion, mercadoPedido)) {
      const { data: listingsFba } = await service
        .from('amazon_listings')
        .select('marketplace_id')
        .eq('connection_id', connectionId)
        .eq('is_fba', true)
        .limit(2000)
      fbaPorMercado = new Map()
      for (const l of (listingsFba ?? []) as Array<{ marketplace_id: string }>) {
        fbaPorMercado.set(l.marketplace_id, (fbaPorMercado.get(l.marketplace_id) ?? 0) + 1)
      }
    }
    const elegido = mercadoDeEnvio({ pedido: mercadoPedido, conexion: datosConexion, fbaPorMercado })
    const mercado = elegido.id
    if (!participaEn(datosConexion, mercado)) {
      return fail(
        409,
        `Esta cuenta de Amazon no vende en ${elegido.nombre}. Vende en: ${mercadosQueVendeLaCuenta(datosConexion).join(', ') || 'ningún mercado conocido'}.`
      )
    }
    const resuelta = await connectionCredentials(connectionId)
    if (!resuelta) return fail(409, 'La conexión de Amazon de este cliente ya no sirve: hay que volver a autorizarla.')
    const { credentials } = resuelta

    // ¿Ya está en el ERP? Dos remesas para el mismo envío contarían sus ventas dos veces.
    const { data: yaEsta } = await service
      .from('fba_remesas')
      .select('id, nombre')
      .eq('client_id', clienteId)
      .eq('referencia_envio', shipmentId)
      .limit(1)
      .maybeSingle()
    const existente = (yaEsta as { id: string; nombre: string | null } | null) ?? null

    const estados = await estadoDeEnvios(credentials, mercado, [shipmentId])
    const info = estados.get(shipmentId)
    if (!info) {
      return fail(
        404,
        `Amazon no reconoce el envío «${shipmentId}» en ${elegido.nombre}. Comprueba el número en Seller Central ` +
          '(Cadena de suministro → Gestionar envíos) y que el país es el del envío.'
      )
    }
    const lineasAmazon = await lineasDeEnvio(credentials, mercado, shipmentId)
    if (lineasAmazon.length === 0) return fail(404, 'Amazon reconoce el envío pero no devuelve ninguna referencia.')

    // Nombre, ASIN y título de cada SKU, del catálogo que ya tenemos
    const skus = lineasAmazon.map((l) => l.sku)
    const descripcion = new Map<string, { asin: string | null; title: string | null }>()
    for (let i = 0; i < skus.length; i += 200) {
      const { data } = await service
        .from('amazon_listings')
        .select('sku, asin, title')
        .eq('connection_id', connectionId)
        .eq('marketplace_id', mercado)
        .in('sku', skus.slice(i, i + 200))
      for (const d of (data ?? []) as Array<{ sku: string; asin: string | null; title: string | null }>) {
        descripcion.set(d.sku, { asin: d.asin, title: d.title })
      }
    }

    const lineas = lineasAmazon
      .filter((l) => l.enviadas > 0)
      .map((l) => ({
        sku: l.sku,
        enviadas: l.enviadas,
        recibidas: l.recibidas,
        asin: descripcion.get(l.sku)?.asin ?? null,
        nombre: descripcion.get(l.sku)?.title ?? null,
      }))

    if (body.accion !== 'crear') {
      return NextResponse.json({
        ok: true,
        existente,
        envio: { shipmentId, nombre: info.nombre, estado: info.estado, centro: info.centro },
        // El mercado en el que se ha buscado y en el que se creará: la pantalla lo enseña y lo devuelve en `crear`
        mercado: { id: elegido.id, nombre: elegido.nombre, region: elegido.region },
        lineas,
      })
    }

    if (existente) {
      return fail(409, `Este envío ya está en el ERP${existente.nombre ? ` como «${existente.nombre}»` : ''}. No se duplica.`)
    }

    const fecha = (body.fechaEnvio ?? '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return fail(400, 'La fecha tiene que ser un día, con el formato 2026-09-30')

    const estadoRemesa = info.estado === 'CLOSED' ? 'cerrada' : 'enviada'
    const { data: creada, error: errAlta } = await service
      .from('fba_remesas')
      .insert({
        client_id: clienteId,
        connection_id: connectionId,
        marketplace_id: mercado,
        nombre: (body.nombre ?? '').trim().slice(0, 120) || info.nombre,
        fecha_envio: fecha,
        referencia_envio: shipmentId,
        estado: estadoRemesa,
        estado_amazon: info.estado,
        seguimiento_at: new Date().toISOString(),
        created_by: sesion.userId,
      })
      .select('id')
      .single()
    if (errAlta) throw errAlta
    const remesaId = (creada as { id: string }).id

    const { error: errLineas } = await service.from('fba_remesa_lineas').insert(
      lineas.map((l) => ({
        remesa_id: remesaId,
        sku: l.sku,
        unidades: l.enviadas,
        unidades_recibidas: l.recibidas,
        asin: l.asin,
        nombre: l.nombre,
      }))
    )
    if (errLineas) {
      // Una cabecera sin líneas se pinta como un envío que no vendió nada
      await service.from('fba_remesas').delete().eq('id', remesaId)
      throw errLineas
    }

    await anotarSeguimiento(service, remesaId, {
      estado: info.estado,
      enviadas: lineas.reduce((s, l) => s + l.enviadas, 0),
      recibidas: lineas.reduce((s, l) => s + l.recibidas, 0),
    }).catch(() => undefined)

    return NextResponse.json({ ok: true, id: remesaId, lineas: lineas.length })
  } catch (error) {
    return errorResponse(error, 'No se ha podido traer el envío de Amazon')
  }
}
