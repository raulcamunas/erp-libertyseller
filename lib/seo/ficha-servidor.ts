/**
 * SEO · EL TEXTO DE LA FICHA DE UNOS PRODUCTOS, LEÍDO DE AMAZON (Listings API). SOLO SERVIDOR. Solo LEE.
 *
 * Título, bullets, descripción y palabras clave ocultas (backend) de cada SKU, en el país pedido. Veinte SKU por llamada, que es lo que admite Amazon. Los atributos vienen con su idioma y su
 * marketplace: se toma el de este marketplace y, si no lo dice, el primero.
 *
 * Con la migración 312 se lee también lo que Amazon dice que le pasa al listing (includedData=issues), el tipo de producto y los Item Highlights si el
 * listing los tiene con uno de los nombres conocidos (lib/seo/edicion.ts).
 */

import { spApiRequest, type AmazonCredentials } from '@/lib/amazon/sp-api'
import { highlightsDeAtributos, valoresDeAtributo } from './edicion'

export interface FichaLeida {
  sku: string
  asin: string | null
  titulo: string | null
  bullets: string[]
  descripcion: string | null
  backend: string | null
  /** Item Highlights, si el listing los trae (null si no, o si el atributo no es uno de los conocidos) */
  highlights: string | null
  productType: string | null
  /** Lo que Amazon dice que le pasa al listing (includedData=issues) */
  issues: IncidenciaDeListing[]
  /** Los atributos tal cual: para verificar campos con nombre variable (highlights) */
  atributos?: Record<string, unknown>
}

export interface IncidenciaDeListing {
  code: string | null
  message: string
  severity: string | null
  atributos: string[]
}

const valores = valoresDeAtributo

/** De un item de la Listings API a la ficha. PURO (se prueba sin Amazon) */
export function fichaDeItem(item: Record<string, unknown>, marketplaceId: string): FichaLeida | null {
  const sku = typeof item.sku === 'string' ? item.sku : null
  if (!sku) return null
  const atributos = item.attributes as Record<string, unknown> | undefined
  const resumenes = (item.summaries ?? []) as Array<{ marketplaceId?: string; asin?: string; itemName?: string; productType?: string }>
  const resumen = resumenes.find((r) => r.marketplaceId === marketplaceId) ?? resumenes[0]
  const titulo = valores(atributos, 'item_name', marketplaceId)[0] ?? resumen?.itemName ?? null
  return {
    sku,
    asin: resumen?.asin ?? null,
    titulo,
    bullets: valores(atributos, 'bullet_point', marketplaceId),
    descripcion: valores(atributos, 'product_description', marketplaceId)[0] ?? null,
    backend: valores(atributos, 'generic_keyword', marketplaceId).join(' ') || null,
    highlights: highlightsDeAtributos(atributos, marketplaceId),
    productType: resumen?.productType ?? null,
    issues: incidenciasDe(item.issues),
    atributos,
  }
}

/** Las incidencias del listing, aplanadas (sin las de otros marketplaces si lo dicen) */
export function incidenciasDe(crudo: unknown): IncidenciaDeListing[] {
  if (!Array.isArray(crudo)) return []
  return crudo
    .map((i) => (i && typeof i === 'object' ? (i as Record<string, unknown>) : {}))
    .map((i) => ({
      code: typeof i.code === 'string' ? i.code : null,
      message: typeof i.message === 'string' ? i.message.slice(0, 600) : '',
      severity: typeof i.severity === 'string' ? i.severity : null,
      atributos: Array.isArray(i.attributeNames) ? (i.attributeNames as unknown[]).filter((a): a is string => typeof a === 'string').slice(0, 10) : [],
    }))
    .filter((i) => i.message)
    .slice(0, 30)
}

export async function leerFichas(creds: AmazonCredentials, marketplaceId: string, skus: readonly string[]): Promise<FichaLeida[]> {
  const salida: FichaLeida[] = []
  for (let i = 0; i < skus.length; i += 20) {
    const { data } = await spApiRequest<{ items?: Array<Record<string, unknown>> }>(creds, 'searchListingsItems', {
      method: 'GET',
      path: `/listings/2021-08-01/items/${encodeURIComponent(creds.sellingPartnerId)}`,
      query: { marketplaceIds: [marketplaceId], identifiers: skus.slice(i, i + 20), identifiersType: 'SKU', includedData: ['summaries', 'attributes', 'issues'], pageSize: 20 },
    })
    for (const item of data.items ?? []) {
      const f = fichaDeItem(item, marketplaceId)
      if (f) salida.push(f)
    }
  }
  return salida
}
