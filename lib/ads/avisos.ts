/**
 * AMAZON ADS · LOS AVISOS DE UNA CUENTA (SOLO SERVIDOR, solo lee). Junta las campañas en vivo (con su estado de servicio), el gasto de los últimos 7 días (ads_rendimiento_diario) y el stock de los
 * productos anunciados (amazon_listings de la cuenta de vendedor del mismo cliente y país). Las reglas, en avisos-calculo.ts.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { campanasDe } from './campanas'
import { marketplaceDePais, productosDeCuenta } from './cuenta'
import { asinDeCampana } from './productos-agrupar'
import { avisosDe, type Aviso } from './avisos-calculo'

const desplazar = (dia: string, dias: number) => new Date(Date.parse(`${dia}T00:00:00Z`) + dias * 86_400_000).toISOString().slice(0, 10)

/** Gasto a partir del cual una campaña sin ventas en 7 días merece aviso */
export const GASTO_SIN_VENTAS_AVISO = 15

export async function avisosDeCuenta(cuenta: { id: string; conexionId: string; profileId: number; clienteAmazonId: string | null; pais: string }): Promise<Aviso[]> {
  const service = createServiceClient()
  const hasta = desplazar(new Date().toISOString().slice(0, 10), -1)
  const [{ campanas }, productos, diario] = await Promise.all([
    campanasDe(cuenta.conexionId, cuenta.profileId),
    productosDeCuenta(cuenta.id).catch(() => []),
    service.from('ads_rendimiento_diario').select('campaign_id, gasto, ventas').eq('perfil_id', cuenta.id).gte('fecha', desplazar(hasta, -6)).lte('fecha', hasta).limit(10000),
  ])
  const suma = new Map<string, { gasto: number; ventas: number }>()
  for (const r of (diario.data ?? []) as Array<{ campaign_id: string; gasto: number; ventas: number }>) {
    const x = suma.get(r.campaign_id) ?? { gasto: 0, ventas: 0 }
    x.gasto += Number(r.gasto)
    x.ventas += Number(r.ventas)
    suma.set(r.campaign_id, x)
  }

  // El stock de los productos de Marketing Test (por SKU, en el país de esta cuenta)
  const stock = new Map<string, number | null>()
  const marketplace = marketplaceDePais(cuenta.pais)
  if (cuenta.clienteAmazonId && marketplace && productos.length > 0) {
    const { data: conexiones } = await service.from('amazon_connections').select('id').eq('client_id', cuenta.clienteAmazonId).eq('is_active', true)
    const ids = ((conexiones ?? []) as Array<{ id: string }>).map((c) => c.id)
    if (ids.length > 0) {
      const { data: listings } = await service.from('amazon_listings').select('sku, is_fba, quantity, fba_fulfillable_quantity').in('connection_id', ids).eq('marketplace_id', marketplace).in('sku', productos.map((p) => p.sku))
      for (const l of (listings ?? []) as Array<{ sku: string; is_fba: boolean | null; quantity: number | null; fba_fulfillable_quantity: number | null }>) {
        stock.set(l.sku, l.is_fba ? l.fba_fulfillable_quantity : l.quantity)
      }
    }
  }
  const activasPorAsin = new Map<string, number>()
  for (const c of campanas) {
    const asin = asinDeCampana(c.nombre)
    if (asin && c.estado === 'ENABLED') activasPorAsin.set(asin, (activasPorAsin.get(asin) ?? 0) + 1)
  }

  return avisosDe(
    campanas.map((c) => ({ campaignId: c.campaignId, nombre: c.nombre, estado: c.estado, servicio: c.servicio, presupuesto: c.presupuesto, gasto7: suma.get(c.campaignId)?.gasto ?? 0, ventas7: suma.get(c.campaignId)?.ventas ?? 0 })),
    productos.filter((p) => p.activo).map((p) => ({ asin: p.asin.toUpperCase(), nombre: p.resumen, campanasActivas: activasPorAsin.get(p.asin.toUpperCase()) ?? 0, stock: stock.has(p.sku) ? (stock.get(p.sku) ?? null) : null })),
    { gastoSinVentas: GASTO_SIN_VENTAS_AVISO }
  )
}
