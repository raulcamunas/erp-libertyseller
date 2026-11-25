/**
 * MARKETING TEST · LO QUE SEO DICE DE UN PRODUCTO, LEÍDO PARA PPC. SOLO SERVIDOR Y SOLO LECTURA (ni Amazon Ads ni la base se escriben).
 *
 * Une la cuenta de anunciante con la de vendedor por cliente y país (igual que las palabras de arranque, lib/ads/semillas-servidor.ts), lee las búsquedas de Brand Analytics del producto (el
 * último mes; si no hay, la última semana), las diagnostica como SEO (con sus decisiones de «no es nuestro producto») y las cruza con las keywords de las campañas del producto.
 */

import { coberturaDe } from '@/lib/seo/cobertura'
import { consultasGuardadas, cuentasSeoDeClientes, fichasGuardadas, preciosDeListings } from '@/lib/seo/datos'
import { diagnosticarTodas } from '@/lib/seo/embudo'
import { decisionesDeBusquedas } from '@/lib/seo/ajenas-servidor'
import { keywordsDelAsin } from '@/lib/seo/publicidad'
import { marketplaceDePais, type CuentaDeAnunciante } from './cuenta'
import { palabrasDesdeSeo, type PalabraDesdeSeo } from './desde-seo'

export interface DesdeSeo {
  /** 'ok' | sin cuenta de vendedor en ese país | el producto no se sigue en SEO */
  estado: 'ok' | 'sin-cuenta' | 'sin-busquedas'
  periodo: 'MONTH' | 'WEEK' | null
  palabras: PalabraDesdeSeo[]
}

export async function desdeSeo(cuenta: CuentaDeAnunciante & { clienteAmazonId: string | null }, asin: string): Promise<DesdeSeo> {
  const a = asin.toUpperCase()
  const mkt = marketplaceDePais(cuenta.pais)
  const seo = cuenta.clienteAmazonId && mkt ? ((await cuentasSeoDeClientes([cuenta.clienteAmazonId])).get(cuenta.clienteAmazonId) ?? []).find((c) => c.marketplaceId === mkt) : undefined
  if (!seo) return { estado: 'sin-cuenta', periodo: null, palabras: [] }
  const [mes, precios, fichas, decisiones, keywords] = await Promise.all([
    consultasGuardadas(seo.connectionId, seo.marketplaceId, 'MONTH'),
    preciosDeListings(seo.connectionId, seo.marketplaceId, [a]).catch(() => ({}) as Record<string, number | null>),
    fichasGuardadas(seo.connectionId, seo.marketplaceId).catch(() => []),
    decisionesDeBusquedas(seo.connectionId, seo.marketplaceId).catch(() => ({ ajenas: [] as string[], nuestras: [] as string[], marcas: [] as Array<{ clave: string; texto: string; origen: string }> })),
    keywordsDelAsin([cuenta.id], a),
  ])
  let periodo: 'MONTH' | 'WEEK' = 'MONTH'
  let filas = mes.filter((f) => f.asin.toUpperCase() === a)
  if (filas.length === 0) {
    periodo = 'WEEK'
    filas = (await consultasGuardadas(seo.connectionId, seo.marketplaceId, 'WEEK')).filter((f) => f.asin.toUpperCase() === a)
  }
  if (filas.length === 0) return { estado: 'sin-busquedas', periodo: null, palabras: [] }
  const ficha = fichas.find((f) => f.asin.toUpperCase() === a) ?? null
  const { busquedas } = diagnosticarTodas(filas, (precios as Record<string, number | null>)[a] ?? null, { ficha, ajenas: decisiones.ajenas, nuestras: decisiones.nuestras, marcas: decisiones.marcas })
  const enTitulo = (consulta: string) => {
    if (!ficha) return false
    const c = coberturaDe(consulta, ficha)
    return c.titulo || c.highlights
  }
  return { estado: 'ok', periodo, palabras: palabrasDesdeSeo(busquedas, keywords, enTitulo) }
}
