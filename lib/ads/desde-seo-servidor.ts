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
import { cosechaDesdeSeo } from './cosecha-seo'
import { heliumDe } from '@/lib/seo/helium-servidor'
import { marcaEnBusqueda } from '@/lib/seo/marcas'

export interface DesdeSeo {
  /** 'ok' | sin cuenta de vendedor en ese país | el producto no se sigue en SEO */
  estado: 'ok' | 'sin-cuenta' | 'sin-busquedas'
  periodo: 'MONTH' | 'WEEK' | null
  palabras: PalabraDesdeSeo[]
  /** El Cerebro de Helium 10 del producto (el mismo que SEO) y sus palabras con volumen que no están en las campañas. null = no hay Cerebro subido */
  helium?: { subidoAt: string; palabras: number; candidatas: Array<{ keyword: string; volumen: number | null; rangoOrganico: number | null }> } | null
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
  if (filas.length === 0) return { estado: 'sin-busquedas', periodo: null, palabras: [], helium: await heliumParaPpc(seo, a, keywords, decisiones.marcas) }
  const ficha = fichas.find((f) => f.asin.toUpperCase() === a) ?? null
  const { busquedas } = diagnosticarTodas(filas, (precios as Record<string, number | null>)[a] ?? null, { ficha, ajenas: decisiones.ajenas, nuestras: decisiones.nuestras, marcas: decisiones.marcas })
  const enTitulo = (consulta: string) => {
    if (!ficha) return false
    const c = coberturaDe(consulta, ficha)
    return c.titulo || c.highlights
  }
  return { estado: 'ok', periodo, palabras: palabrasDesdeSeo(busquedas, keywords, enTitulo), helium: await heliumParaPpc(seo, a, keywords, decisiones.marcas) }
}

/** Lo de Helium 10 que mira PPC: el Cerebro guardado del producto y sus palabras con volumen que no están en ninguna campaña (las que el agente prueba en la AMPLIA) */
async function heliumParaPpc(seo: { connectionId: string; marketplaceId: string }, asin: string, keywords: { exactas: ReadonlySet<string>; otras: ReadonlySet<string> }, marcas: ReadonlyArray<{ clave: string; texto: string }>): Promise<DesdeSeo['helium']> {
  try {
    const h = await heliumDe(seo, asin)
    const cerebro = h.importaciones.find((i) => i.tipo === 'cerebro' || i.tipo === 'magnet')
    if (!cerebro) return null
    const candidatas = cosechaDesdeSeo({
      seo: [],
      helium: h.palabras.map((p) => ({ keyword: p.keyword, volumen: p.volumen, rangoOrganico: p.rangoOrganico, oportunidad: p.oportunidad, decision: p.decision })),
      exactas: keywords.exactas,
      cualquiera: new Set([...keywords.exactas, ...keywords.otras]),
      bloqueadas: new Set(),
      esDeMarca: (t) => marcaEnBusqueda(t, marcas) !== null,
    })
    const porKw = new Map(h.palabras.map((p) => [p.keyword, p]))
    return { subidoAt: cerebro.subidoAt, palabras: cerebro.filas, candidatas: candidatas.map((c) => ({ keyword: c.termino, volumen: c.volumen, rangoOrganico: porKw.get(c.termino)?.rangoOrganico ?? null })) }
  } catch {
    return null
  }
}
