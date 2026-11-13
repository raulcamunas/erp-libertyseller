/**
 * EL CATÁLOGO DE UNA TIENDA ONLINE, DESDE FUERA: lo que la IA necesita para saber qué vende y qué buscar en Amazon.
 *
 * Por orden, lo primero que funcione:
 *   1. Shopify `/products.json`: títulos, precios, marca y tipo (público en casi todas las tiendas Shopify).
 *   2. El sitemap de productos de Shopify: todos los títulos, sin precio (desde el portátil, `/products.json` daba 429 y esto no).
 *   3. La portada: los productos con precio que enseñe (enlaces /products/… o JSON-LD Product) y su texto.
 * Siempre va además la descripción de la portada y un trozo de su texto: con PrestaShop o una web hecha a mano es lo único que hay.
 *
 * Nada de reintentos agresivos: una petición por recurso y fuera. Si la web no contesta, no hay informe.
 */

export type ProductoDeTienda = { titulo: string; precio: number | null; enlace?: string | null; tipo?: string | null; marca?: string | null }

export type Catalogo = {
  origen: string
  plataforma: 'shopify' | 'otra'
  productos: ProductoDeTienda[]
  descripcion: string
  titulo: string
  portada: string
}

const NAVEGADOR =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

async function traer(url: string, tipo: 'texto' | 'json' = 'texto'): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': NAVEGADOR, Accept: tipo === 'json' ? 'application/json' : 'text/html,application/xhtml+xml,application/xml' },
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
    if (!r.ok) return null
    const t = await r.text()
    return t.length > 6_000_000 ? t.slice(0, 6_000_000) : t
  } catch {
    return null
  }
}

const entidades = (t: string) =>
  t
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')

/** Precio en formato español o inglés: «1.299,95», «29,95», «29.95» */
function precioDe(t: string): number | null {
  const x = t.trim()
  const n = /,\d{2}$/.test(x) ? Number(x.replace(/\./g, '').replace(',', '.')) : Number(x.replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 && n < 100_000 ? n : null
}

export function origenDe(web: string): string | null {
  try {
    const u = new URL(/^https?:\/\//i.test(web.trim()) ? web.trim() : `https://${web.trim()}`)
    return `https://${u.hostname}`
  } catch {
    return null
  }
}

export async function leerCatalogo(web: string): Promise<Catalogo | null> {
  const origen = origenDe(web)
  if (!origen) return null
  const portadaHtml = await traer(origen)
  if (!portadaHtml) return null

  const meta = (nombre: string) =>
    entidades(new RegExp(`<meta[^>]+(?:name|property)=["']${nombre}["'][^>]*content=["']([^"']*)["']`, 'i').exec(portadaHtml)?.[1] ?? '')
  const descripcion = (meta('description') || meta('og:description')).slice(0, 400)
  const titulo = entidades(/<title[^>]*>([^<]*)<\/title>/i.exec(portadaHtml)?.[1] ?? '').trim().slice(0, 160)
  const portada = entidades(
    portadaHtml
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 3000)
  const shopify = /cdn\.shopify\.com|Shopify\.theme|shopify-section/i.test(portadaHtml)

  // Precios que enseña la portada, por enlace de producto
  const preciosPortada = new Map<string, number>()
  for (const m of portadaHtml.matchAll(/\/products\/([a-z0-9][a-z0-9\-]*)/gi)) {
    const h = m[1].toLowerCase()
    if (preciosPortada.has(h)) continue
    const trozo = portadaHtml.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 3000)
    const p = /(\d{1,3}(?:\.\d{3})*(?:,\d{2})|\d{1,5}(?:[.,]\d{2}))\s*(?:&nbsp;)?\s*€|€\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})|\d{1,5}(?:[.,]\d{2}))/.exec(trozo)
    const v = p ? precioDe(p[1] ?? p[2]) : null
    if (v) preciosPortada.set(h, v)
  }

  let productos: ProductoDeTienda[] = []

  if (shopify) {
    const json = await traer(`${origen}/products.json?limit=250`, 'json')
    try {
      const ps = json ? (JSON.parse(json).products as Array<Record<string, unknown>>) : []
      productos = (ps ?? []).map((p) => {
        const v = (p.variants as Array<{ price?: string }> | undefined)?.[0]
        return {
          titulo: String(p.title ?? '').slice(0, 140),
          precio: v?.price ? precioDe(String(v.price)) : null,
          enlace: p.handle ? `/products/${p.handle}` : null,
          tipo: (p.product_type as string) || null,
          marca: (p.vendor as string) || null,
        }
      })
    } catch {
      productos = []
    }
    if (!productos.length) {
      const indice = await traer(`${origen}/sitemap.xml`)
      const sm = indice ? /https?:\/\/[^<\s]*sitemap_products_1[^<\s]*/.exec(indice)?.[0]?.replace(/&amp;/g, '&') : null
      const xml = sm ? await traer(sm) : null
      const vistos = new Set<string>()
      for (const u of xml?.match(/<url>[\s\S]*?<\/url>/g) ?? []) {
        const h = /\/products\/([^<]+)<\/loc>/.exec(u)?.[1]
        if (!h || vistos.has(h)) continue
        vistos.add(h)
        const t = /<image:title>([\s\S]*?)<\/image:title>/.exec(u)?.[1]
        productos.push({ titulo: entidades(t ?? h.replace(/-/g, ' ')).slice(0, 140), precio: preciosPortada.get(h.toLowerCase()) ?? null, enlace: `/products/${h}` })
      }
    }
  }

  if (!productos.length) {
    // JSON-LD Product de la portada (PrestaShop, WooCommerce y webs a medida lo suelen llevar)
    for (const m of portadaHtml.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const j = JSON.parse(m[1])
        const lista = (Array.isArray(j) ? j : j['@graph'] ?? [j]) as Array<Record<string, unknown>>
        for (const x of lista) {
          if (String(x['@type']) !== 'Product' || !x.name) continue
          const of = (Array.isArray(x.offers) ? x.offers[0] : x.offers) as { price?: string | number } | undefined
          productos.push({ titulo: String(x.name).slice(0, 140), precio: of?.price ? precioDe(String(of.price)) : null })
        }
      } catch {
        /* JSON-LD roto: se ignora */
      }
    }
    for (const [h, precio] of preciosPortada) if (productos.length < 40) productos.push({ titulo: h.replace(/-/g, ' '), precio, enlace: `/products/${h}` })
  }

  // Los que tienen precio, primero: son los que sirven para comparar con Amazon
  productos.sort((a, b) => Number(b.precio !== null) - Number(a.precio !== null))
  return { origen, plataforma: shopify ? 'shopify' : 'otra', productos: productos.slice(0, 400), descripcion, titulo, portada }
}
