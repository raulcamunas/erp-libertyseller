/**
 * SEO · EL SEGUIMIENTO DIARIO DE LA COMPETENCIA: LA FOTO DE UN ASIN RIVAL Y LOS CAMBIOS ENTRE DOS FOTOS. PURO (se prueba sin Amazon).
 *
 * La foto sale de la SP-API, que deja leer ASIN de otros vendedores en el marketplace:
 *   · Catalog Items 2022-04-01 (searchCatalogItems, 20 ASIN por llamada): título, viñetas, imágenes, marca y BSR.
 *   · Product Pricing getItemOffersBatch (20 ASIN por llamada, una cada 10 s): precio de la Buy Box, quién la tiene y cuántas ofertas.
 * Keepa NO se usa: sus tokens son escasos y los gasta el análisis de cuentas. El backend (generic_keyword) de otros no se puede leer.
 *
 * Un cambio se apunta solo si es de verdad: espacios normalizados, el precio a partir del 1 % y el BSR a partir del 20 % (se mueve todos los días).
 */

import { trozosNuevos } from './propuesta'

export interface RankRival {
  tipo: 'grupo' | 'categoria'
  categoria: string
  rank: number
}

export interface FotoRival {
  titulo: string | null
  bullets: string[]
  imagenes: string[]
  marca: string | null
  bsr: RankRival[]
  precio: number | null
  moneda: string | null
  buyboxVendedor: string | null
  ofertas: number | null
}

export type CampoRival = 'titulo' | 'bullets' | 'imagenes' | 'precio' | 'bsr' | 'marca' | 'buybox'

export interface CambioRival {
  campo: CampoRival
  antes: unknown
  despues: unknown
  /** Para ordenar el feed: % del precio, % del BSR, palabras del título que cambian, viñetas distintas, imágenes distintas */
  magnitud: number
  resumen: string
}

export const NOMBRE_CAMPO_RIVAL: Record<CampoRival, string> = {
  titulo: 'Título',
  bullets: 'Viñetas',
  imagenes: 'Imágenes',
  precio: 'Precio',
  bsr: 'BSR',
  marca: 'Marca',
  buybox: 'Buy Box',
}

const limpio = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

type Valor = { value?: unknown; marketplace_id?: string }
function textos(atributos: Record<string, unknown> | undefined, clave: string, marketplaceId: string): string[] {
  const lista = (atributos?.[clave] ?? []) as Valor[]
  if (!Array.isArray(lista)) return []
  const del = lista.filter((v) => !v.marketplace_id || v.marketplace_id === marketplaceId)
  return (del.length > 0 ? del : lista).map((v) => (typeof v.value === 'string' ? limpio(v.value) : '')).filter(Boolean)
}

/**
 * De un item de searchCatalogItems (includedData=attributes,images,salesRanks,summaries) a la foto, sin precio. Las imágenes: una por variante (MAIN,
 * PT01…), la más grande, en orden MAIN primero.
 */
export function fotoDeItemCatalogo(item: Record<string, unknown>, marketplaceId: string): Omit<FotoRival, 'precio' | 'moneda' | 'buyboxVendedor' | 'ofertas'> {
  const atributos = item.attributes as Record<string, unknown> | undefined
  const resumenes = (item.summaries ?? []) as Array<{ marketplaceId?: string; itemName?: string; brand?: string; brandName?: string }>
  const resumen = resumenes.find((r) => r.marketplaceId === marketplaceId) ?? resumenes[0]
  const titulo = textos(atributos, 'item_name', marketplaceId)[0] ?? limpio(resumen?.itemName) ?? null

  const bloquesImg = (item.images ?? []) as Array<{ marketplaceId?: string; images?: Array<{ variant?: string; link?: string; height?: number; width?: number }> }>
  const bloque = bloquesImg.find((b) => b.marketplaceId === marketplaceId) ?? bloquesImg[0]
  const porVariante = new Map<string, { link: string; area: number }>()
  for (const im of bloque?.images ?? []) {
    if (!im.link || !im.variant) continue
    const area = (im.height ?? 0) * (im.width ?? 0)
    const ya = porVariante.get(im.variant)
    if (!ya || area > ya.area) porVariante.set(im.variant, { link: im.link, area })
  }
  const orden = (v: string) => (v === 'MAIN' ? -1 : Number(v.replace(/\D/g, '')) || 99)
  const imagenes = [...porVariante.entries()].sort((a, b) => orden(a[0]) - orden(b[0])).map(([, x]) => x.link)

  const rangos = (item.salesRanks ?? []) as Array<{ marketplaceId?: string; classificationRanks?: Array<{ title?: string; rank?: number }>; displayGroupRanks?: Array<{ title?: string; rank?: number }> }>
  const r = rangos.find((x) => x.marketplaceId === marketplaceId) ?? rangos[0]
  const bsr: RankRival[] = [
    ...(r?.displayGroupRanks ?? []).filter((x) => typeof x.rank === 'number').map((x) => ({ tipo: 'grupo' as const, categoria: x.title ?? '', rank: x.rank as number })),
    ...(r?.classificationRanks ?? []).filter((x) => typeof x.rank === 'number').map((x) => ({ tipo: 'categoria' as const, categoria: x.title ?? '', rank: x.rank as number })),
  ]
  return {
    titulo: titulo || null,
    bullets: textos(atributos, 'bullet_point', marketplaceId),
    imagenes,
    marca: textos(atributos, 'brand', marketplaceId)[0] ?? resumen?.brand ?? resumen?.brandName ?? null,
    bsr,
  }
}

/** Del cuerpo de una respuesta de getItemOffersBatch (un ASIN) a precio de la Buy Box, quién la tiene y cuántas ofertas. Sin Buy Box: el precio más bajo */
export function ofertasDeRespuesta(body: unknown): { asin: string | null; precio: number | null; moneda: string | null; buyboxVendedor: string | null; ofertas: number | null } {
  const payload = ((body as { payload?: Record<string, unknown> } | null)?.payload ?? {}) as Record<string, unknown>
  const summary = (payload.Summary ?? {}) as { BuyBoxPrices?: Array<{ LandedPrice?: { Amount?: number; CurrencyCode?: string }; ListingPrice?: { Amount?: number; CurrencyCode?: string } }>; LowestPrices?: Array<{ LandedPrice?: { Amount?: number; CurrencyCode?: string } }>; TotalOfferCount?: number }
  const offers = (payload.Offers ?? []) as Array<{ SellerId?: string; IsBuyBoxWinner?: boolean }>
  const bb = summary.BuyBoxPrices?.[0]
  const precioBb = bb?.LandedPrice ?? bb?.ListingPrice
  const masBajo = (summary.LowestPrices ?? []).map((l) => l.LandedPrice).filter((p): p is { Amount?: number; CurrencyCode?: string } => !!p && typeof p.Amount === 'number').sort((a, b) => (a.Amount ?? 0) - (b.Amount ?? 0))[0]
  const precio = precioBb?.Amount ?? masBajo?.Amount ?? null
  return {
    asin: typeof payload.ASIN === 'string' ? payload.ASIN : null,
    precio: typeof precio === 'number' ? Math.round(precio * 100) / 100 : null,
    moneda: precioBb?.CurrencyCode ?? masBajo?.CurrencyCode ?? null,
    buyboxVendedor: offers.find((o) => o.IsBuyBoxWinner)?.SellerId ?? null,
    ofertas: typeof summary.TotalOfferCount === 'number' ? summary.TotalOfferCount : offers.length || null,
  }
}

/** Una huella de la foto: si no cambia, no hay nada que comparar */
export function hashDeFoto(f: FotoRival): string {
  const base = JSON.stringify([limpio(f.titulo), f.bullets.map(limpio), f.imagenes, limpio(f.marca), f.bsr.map((b) => `${b.tipo}:${b.categoria}:${b.rank}`), f.precio, f.buyboxVendedor])
  let h = 5381
  for (let i = 0; i < base.length; i++) h = ((h << 5) + h + base.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

const bsrPrincipal = (f: FotoRival) => f.bsr.find((b) => b.tipo === 'grupo') ?? f.bsr[0] ?? null

export const UMBRAL_PRECIO = 0.01
export const UMBRAL_BSR = 0.2

/** Lo que ha cambiado de una foto a la siguiente (si no hay anterior, nada: la primera foto es la referencia) */
export function cambiosEntreFotos(antes: FotoRival | null, despues: FotoRival): CambioRival[] {
  if (!antes) return []
  const salida: CambioRival[] = []
  if (antes.titulo && despues.titulo && limpio(antes.titulo) !== limpio(despues.titulo)) {
    const entran = trozosNuevos(antes.titulo, despues.titulo).filter((t) => t.nuevo).map((t) => t.texto.trim()).filter(Boolean)
    const salen = trozosNuevos(despues.titulo, antes.titulo).filter((t) => t.nuevo).map((t) => t.texto.trim()).filter(Boolean)
    salida.push({ campo: 'titulo', antes: antes.titulo, despues: despues.titulo, magnitud: entran.length + salen.length, resumen: [entran.length ? `entra «${entran.slice(0, 6).join(' ')}»` : '', salen.length ? `sale «${salen.slice(0, 6).join(' ')}»` : ''].filter(Boolean).join(', ') || 'cambia el orden de las palabras' })
  }
  const vA = antes.bullets.map(limpio)
  const vD = despues.bullets.map(limpio)
  if (vD.length > 0 && JSON.stringify(vA) !== JSON.stringify(vD)) {
    const distintas = Math.max(vA.length, vD.length) - vD.filter((b) => vA.includes(b)).length
    salida.push({ campo: 'bullets', antes: antes.bullets, despues: despues.bullets, magnitud: distintas, resumen: `${distintas} ${distintas === 1 ? 'viñeta nueva o reescrita' : 'viñetas nuevas o reescritas'}${vA.length !== vD.length ? ` (de ${vA.length} a ${vD.length})` : ''}` })
  }
  if (despues.imagenes.length > 0 && JSON.stringify(antes.imagenes) !== JSON.stringify(despues.imagenes)) {
    const principal = antes.imagenes[0] !== despues.imagenes[0]
    const nuevas = despues.imagenes.filter((x) => !antes.imagenes.includes(x)).length
    salida.push({ campo: 'imagenes', antes: antes.imagenes, despues: despues.imagenes, magnitud: nuevas + (principal ? 3 : 0), resumen: [principal ? 'cambia la imagen principal' : '', nuevas ? `${nuevas} ${nuevas === 1 ? 'imagen nueva' : 'imágenes nuevas'}` : '', antes.imagenes.length !== despues.imagenes.length ? `de ${antes.imagenes.length} a ${despues.imagenes.length}` : ''].filter(Boolean).join(', ') || 'cambia el orden de las imágenes' })
  }
  if (antes.precio != null && despues.precio != null && antes.precio > 0) {
    const d = (despues.precio - antes.precio) / antes.precio
    if (Math.abs(d) >= UMBRAL_PRECIO) salida.push({ campo: 'precio', antes: antes.precio, despues: despues.precio, magnitud: Math.round(Math.abs(d) * 1000) / 10, resumen: `${d > 0 ? 'sube' : 'baja'} un ${Math.abs(d * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %` })
  }
  const bA = bsrPrincipal(antes)
  const bD = bsrPrincipal(despues)
  if (bA && bD && bA.categoria === bD.categoria && bA.rank > 0) {
    const d = (bD.rank - bA.rank) / bA.rank
    if (Math.abs(d) >= UMBRAL_BSR) salida.push({ campo: 'bsr', antes: bA, despues: bD, magnitud: Math.round(Math.abs(d) * 100), resumen: `${d < 0 ? 'mejora' : 'empeora'} del #${bA.rank.toLocaleString('es-ES')} al #${bD.rank.toLocaleString('es-ES')} en ${bD.categoria}` })
  }
  if (antes.marca && despues.marca && limpio(antes.marca).toLowerCase() !== limpio(despues.marca).toLowerCase()) salida.push({ campo: 'marca', antes: antes.marca, despues: despues.marca, magnitud: 5, resumen: `de «${antes.marca}» a «${despues.marca}»` })
  if (antes.buyboxVendedor && despues.buyboxVendedor && antes.buyboxVendedor !== despues.buyboxVendedor) salida.push({ campo: 'buybox', antes: antes.buyboxVendedor, despues: despues.buyboxVendedor, magnitud: 2, resumen: 'cambia el vendedor que gana la Buy Box' })
  return salida
}

/** Una foto recién leída hereda lo que esta pasada no ha podido leer (el precio, si no había presupuesto de ofertas): así no sale un cambio falso */
export function completarConAnterior(nueva: FotoRival, anterior: FotoRival | null, conOfertas: boolean): FotoRival {
  if (conOfertas || !anterior) return nueva
  return { ...nueva, precio: anterior.precio, moneda: anterior.moneda, buyboxVendedor: anterior.buyboxVendedor, ofertas: anterior.ofertas }
}

/** ASIN escritos a mano: separados por comas, espacios o saltos; también vale pegar enlaces de Amazon (/dp/ASIN) */
export function asinsDeTexto(texto: string): string[] {
  const salida = new Set<string>()
  for (const m of texto.toUpperCase().matchAll(/(?:\/DP\/|\/PRODUCT\/|\b)([A-Z0-9]{10})\b/g)) {
    const a = m[1]
    if (/^B0[A-Z0-9]{8}$/.test(a) || /^\d{9}[\dX]$/.test(a)) salida.add(a)
  }
  return [...salida]
}
