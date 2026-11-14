/**
 * AMAZON ADS · LOS PRODUCTOS QUE YA TIENEN CAMPAÑAS EN LA CUENTA (Marketing Test → Productos). SOLO SERVIDOR.
 *
 * Una cuenta que ya se llevaba antes del ERP tiene campañas de productos que nadie ha dado de alta en Marketing Test. Aquí se leen las campañas EN VIVO, se saca el ASIN de cada nombre
 * (asinDeCampana: la nomenclatura del SOP o cualquier ASIN que aparezca) y se cuentan por producto. Los que no están dados de alta se ofrecen para añadir de un clic, con el SKU, el título y el precio
 * del catálogo de la cuenta de vendedor y las comisiones pedidas a Amazon (datos-amazon.ts).
 */

import { createServiceClient } from '@/lib/supabase/service'
import { campanasDe } from './campanas'
import { crearProducto, marketplaceDePais, productosDeCuenta, type ProductoDeAds } from './cuenta'
import { datosDeAmazon } from './datos-amazon'
import { resumenDesdeTitulo } from './estructura'
import { asinDeCampana } from './productos-agrupar'
import { partesDeNombre } from './reglas'

export interface CampanasDeAsin {
  activas: number
  pausadas: number
}

export interface ProductoDetectado {
  asin: string
  sku: string | null
  titulo: string | null
  precio: number | null
  campanas: CampanasDeAsin
}

type Cuenta = { id: string; conexionId: string; profileId: number; clienteAmazonId: string | null; pais: string; moneda: string | null }

/** Las campañas de la cuenta (sin las archivadas) contadas por ASIN, y el SKU que traiga la nomenclatura */
export async function campanasPorAsin(cuenta: Cuenta): Promise<Map<string, CampanasDeAsin & { sku: string | null }>> {
  const { campanas } = await campanasDe(cuenta.conexionId, cuenta.profileId)
  const m = new Map<string, CampanasDeAsin & { sku: string | null }>()
  for (const c of campanas) {
    if (c.estado === 'ARCHIVED') continue
    const asin = asinDeCampana(c.nombre)
    if (!asin) continue
    const x = m.get(asin) ?? { activas: 0, pausadas: 0, sku: null }
    if (c.estado === 'ENABLED') x.activas++
    else x.pausadas++
    x.sku = x.sku ?? partesDeNombre(c.nombre)?.sku ?? null
    m.set(asin, x)
  }
  return m
}

/** El catálogo de la cuenta de vendedor para unos ASIN: SKU, título y precio (el primer listing de cada ASIN) */
async function catalogoPorAsin(cuenta: Cuenta, asins: readonly string[]): Promise<Map<string, { sku: string; titulo: string | null; precio: number | null }>> {
  const salida = new Map<string, { sku: string; titulo: string | null; precio: number | null }>()
  const marketplace = marketplaceDePais(cuenta.pais)
  if (!cuenta.clienteAmazonId || !marketplace || asins.length === 0) return salida
  const service = createServiceClient()
  const { data: conexiones } = await service.from('amazon_connections').select('id').eq('client_id', cuenta.clienteAmazonId).eq('is_active', true)
  const ids = ((conexiones ?? []) as Array<{ id: string }>).map((c) => c.id)
  if (ids.length === 0) return salida
  const { data } = await service.from('amazon_listings').select('asin, sku, title, price').in('connection_id', ids).eq('marketplace_id', marketplace).in('asin', [...asins]).limit(2000)
  for (const l of (data ?? []) as Array<{ asin: string; sku: string; title: string | null; price: number | null }>) {
    const asin = l.asin.toUpperCase()
    const ya = salida.get(asin)
    // Si hay varios SKU del mismo ASIN, el que tenga precio
    if (!ya || (ya.precio == null && l.price != null)) salida.set(asin, { sku: l.sku, titulo: l.title, precio: l.price == null ? null : Number(l.price) })
  }
  return salida
}

/** Las campañas por ASIN de los productos dados de alta, y los productos con campañas que faltan por dar de alta */
export async function productosConCampanas(cuenta: Cuenta, productos?: ProductoDeAds[]): Promise<{ porAsin: Record<string, CampanasDeAsin>; detectados: ProductoDetectado[] }> {
  const [porAsinMap, yaDados] = await Promise.all([campanasPorAsin(cuenta), productos ? Promise.resolve(productos) : productosDeCuenta(cuenta.id)])
  const dados = new Set(yaDados.map((p) => p.asin.toUpperCase()))
  const faltan = [...porAsinMap.keys()].filter((a) => !dados.has(a))
  const catalogo = await catalogoPorAsin(cuenta, faltan)
  const porAsin: Record<string, CampanasDeAsin> = {}
  for (const [asin, x] of porAsinMap) porAsin[asin] = { activas: x.activas, pausadas: x.pausadas }
  const detectados = faltan
    .map((asin) => {
      const x = porAsinMap.get(asin) as CampanasDeAsin & { sku: string | null }
      const cat = catalogo.get(asin)
      return { asin, sku: cat?.sku ?? x.sku, titulo: cat?.titulo ?? null, precio: cat?.precio ?? null, campanas: { activas: x.activas, pausadas: x.pausadas } }
    })
    .sort((a, b) => b.campanas.activas - a.campanas.activas || b.campanas.pausadas - a.campanas.pausadas)
  return { porAsin, detectados }
}

/** Da de alta los detectados (todos o los que se digan), con sus datos de Amazon. Sin SKU no se puede: se devuelven aparte */
export async function anadirDetectados(cuenta: Cuenta, asins: readonly string[] | null, userId: string): Promise<{ anadidos: number; sinSku: string[] }> {
  const { detectados } = await productosConCampanas(cuenta)
  const elegidos = asins ? detectados.filter((d) => asins.includes(d.asin)) : detectados
  let anadidos = 0
  const sinSku: string[] = []
  for (const d of elegidos) {
    if (!d.sku) {
      sinSku.push(d.asin)
      continue
    }
    const a = await datosDeAmazon(cuenta, d.sku).catch(() => null)
    await crearProducto(
      cuenta.id,
      {
        asin: d.asin,
        sku: d.sku,
        titulo: d.titulo,
        resumen: (resumenDesdeTitulo(d.titulo) || d.asin).toUpperCase().slice(0, 40),
        precio: a?.precio ?? d.precio,
        ivaPct: a?.ivaPct ?? 21,
        costeProducto: a?.costeProducto ?? null,
        comisionPct: a?.comisionPct ?? 15,
        tarifaFba: a?.tarifaFba ?? 0,
        otrosCostes: a?.otrosCostes ?? 0,
        acosObjetivoPct: null,
        activo: true,
        notas: null,
      },
      userId
    )
    anadidos++
  }
  return { anadidos, sinSku }
}
