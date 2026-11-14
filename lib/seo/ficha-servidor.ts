/**
 * SEO · EL TEXTO DE LA FICHA DE UNOS PRODUCTOS, LEÍDO DE AMAZON (Listings API). SOLO SERVIDOR. Solo LEE.
 *
 * Título, bullets, descripción y palabras clave ocultas (backend) de cada SKU, en el país pedido. Veinte SKU por llamada, que es lo que admite Amazon. Los atributos vienen con su idioma y su
 * marketplace: se toma el de este marketplace y, si no lo dice, el primero.
 */

import { spApiRequest, type AmazonCredentials } from '@/lib/amazon/sp-api'

export interface FichaLeida {
  sku: string
  asin: string | null
  titulo: string | null
  bullets: string[]
  descripcion: string | null
  backend: string | null
}

type ValorDeAtributo = { value?: unknown; marketplace_id?: string; language_tag?: string }

function valores(atributos: Record<string, unknown> | undefined, clave: string, marketplaceId: string): string[] {
  const lista = (atributos?.[clave] ?? []) as ValorDeAtributo[]
  if (!Array.isArray(lista)) return []
  const delMercado = lista.filter((v) => !v.marketplace_id || v.marketplace_id === marketplaceId)
  return (delMercado.length > 0 ? delMercado : lista).map((v) => (typeof v.value === 'string' ? v.value.trim() : '')).filter(Boolean)
}

/** De un item de la Listings API a la ficha. PURO (se prueba sin Amazon) */
export function fichaDeItem(item: Record<string, unknown>, marketplaceId: string): FichaLeida | null {
  const sku = typeof item.sku === 'string' ? item.sku : null
  if (!sku) return null
  const atributos = item.attributes as Record<string, unknown> | undefined
  const resumenes = (item.summaries ?? []) as Array<{ marketplaceId?: string; asin?: string; itemName?: string }>
  const resumen = resumenes.find((r) => r.marketplaceId === marketplaceId) ?? resumenes[0]
  const titulo = valores(atributos, 'item_name', marketplaceId)[0] ?? resumen?.itemName ?? null
  return {
    sku,
    asin: resumen?.asin ?? null,
    titulo,
    bullets: valores(atributos, 'bullet_point', marketplaceId),
    descripcion: valores(atributos, 'product_description', marketplaceId)[0] ?? null,
    backend: valores(atributos, 'generic_keyword', marketplaceId).join(' ') || null,
  }
}

export async function leerFichas(creds: AmazonCredentials, marketplaceId: string, skus: readonly string[]): Promise<FichaLeida[]> {
  const salida: FichaLeida[] = []
  for (let i = 0; i < skus.length; i += 20) {
    const { data } = await spApiRequest<{ items?: Array<Record<string, unknown>> }>(creds, 'searchListingsItems', {
      method: 'GET',
      path: `/listings/2021-08-01/items/${encodeURIComponent(creds.sellingPartnerId)}`,
      query: { marketplaceIds: [marketplaceId], identifiers: skus.slice(i, i + 20), identifiersType: 'SKU', includedData: ['summaries', 'attributes'], pageSize: 20 },
    })
    for (const item of data.items ?? []) {
      const f = fichaDeItem(item, marketplaceId)
      if (f) salida.push(f)
    }
  }
  return salida
}
