import type { AmazonCredentials } from '@/lib/amazon/sp-api'
import { createServiceClient } from '@/lib/supabase/service'
import { lineasDeEnvio } from './inbound'
import { anotarSeguimiento } from './seguimiento'

/**
 * DAR DE ALTA UN ENVÍO QUE YA EXISTE EN AMAZON — la parte común de «Traer envío de Amazon» (uno, por su número) e «Importar pedidos» (varios, de la lista).
 * SOLO SERVIDOR.
 *
 * Aquí no se decide el mercado ni se comprueba el acceso: lo hace quien llama (app/api/fba/remesas/importar-envio y .../envios-nuevos), que es quien conoce la sesión y la conexión.
 *
 * LA REMESA NACE EN «ENVIADA» (o «CERRADA» si Amazon ya lo cerró), NO EN BORRADOR: la mercancía ya está en camino o en el almacén.
 */

type Servicio = ReturnType<typeof createServiceClient>

export interface LineaTraida {
  sku: string
  enviadas: number
  recibidas: number
  asin: string | null
  nombre: string | null
}

/** Lo que dice Amazon de las referencias de un envío, con el nombre y el ASIN del catálogo que ya tenemos. `crudas` = cuántas devolvió Amazon antes de quitar las de 0 unidades */
export async function lineasConNombre(service: Servicio, creds: AmazonCredentials, connectionId: string, mercado: string, shipmentId: string): Promise<{ crudas: number; lineas: LineaTraida[] }> {
  const lineasAmazon = await lineasDeEnvio(creds, mercado, shipmentId)
  const skus = lineasAmazon.map((l) => l.sku)
  const descripcion = new Map<string, { asin: string | null; title: string | null }>()
  for (let i = 0; i < skus.length; i += 200) {
    const { data } = await service
      .from('amazon_listings')
      .select('sku, asin, title')
      .eq('connection_id', connectionId)
      .eq('marketplace_id', mercado)
      .in('sku', skus.slice(i, i + 200))
    for (const d of (data ?? []) as Array<{ sku: string; asin: string | null; title: string | null }>) descripcion.set(d.sku, { asin: d.asin, title: d.title })
  }
  const lineas = lineasAmazon
    .filter((l) => l.enviadas > 0)
    .map((l) => ({ sku: l.sku, enviadas: l.enviadas, recibidas: l.recibidas, asin: descripcion.get(l.sku)?.asin ?? null, nombre: descripcion.get(l.sku)?.title ?? null }))
  return { crudas: lineasAmazon.length, lineas }
}

export interface AltaDeEnvio {
  clienteId: string
  connectionId: string
  mercado: string
  shipmentId: string
  nombre: string | null
  /** 'YYYY-MM-DD': desde aquí cuentan las ventas, hasta que el libro mayor confirme la llegada */
  fecha: string
  /** El estado que dice Amazon (CLOSED → la remesa nace cerrada) */
  estadoAmazon: string
  lineas: LineaTraida[]
  userId: string
}

/** Crea la remesa y sus líneas, ya enlazada al envío, y anota su seguimiento. Devuelve el id. Si las líneas fallan, no deja la cabecera huérfana */
export async function crearRemesaDeEnvio(service: Servicio, a: AltaDeEnvio): Promise<string> {
  const { data: creada, error: errAlta } = await service
    .from('fba_remesas')
    .insert({
      client_id: a.clienteId,
      connection_id: a.connectionId,
      marketplace_id: a.mercado,
      nombre: (a.nombre ?? '').trim().slice(0, 120) || null,
      fecha_envio: a.fecha,
      referencia_envio: a.shipmentId,
      estado: a.estadoAmazon === 'CLOSED' ? 'cerrada' : 'enviada',
      estado_amazon: a.estadoAmazon,
      seguimiento_at: new Date().toISOString(),
      created_by: a.userId,
    })
    .select('id')
    .single()
  if (errAlta) throw errAlta
  const remesaId = (creada as { id: string }).id

  const { error: errLineas } = await service.from('fba_remesa_lineas').insert(
    a.lineas.map((l) => ({ remesa_id: remesaId, sku: l.sku, unidades: l.enviadas, unidades_recibidas: l.recibidas, asin: l.asin, nombre: l.nombre }))
  )
  if (errLineas) {
    // Una cabecera sin líneas se pinta como un envío que no vendió nada
    await service.from('fba_remesas').delete().eq('id', remesaId)
    throw errLineas
  }

  await anotarSeguimiento(service, remesaId, {
    estado: a.estadoAmazon,
    enviadas: a.lineas.reduce((s, l) => s + l.enviadas, 0),
    recibidas: a.lineas.reduce((s, l) => s + l.recibidas, 0),
  }).catch(() => undefined)

  return remesaId
}
