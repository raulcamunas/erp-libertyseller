/**
 * SEO · EL TEXTO DE LA FICHA DE UNOS PRODUCTOS, LEÍDO DE AMAZON (Listings API). SOLO SERVIDOR. Solo LEE.
 *
 * Título, bullets, descripción y palabras clave ocultas (backend) de cada SKU, en el país pedido. Veinte SKU por llamada, que es lo que admite Amazon. Los atributos vienen con su idioma y su
 * marketplace: se toma el de este marketplace y, si no lo dice, el primero. Y UN SOLO IDIOMA: el del título de este marketplace (si trae varios, el del
 * país; si no trae ninguno, el del país). En Bélgica o Canadá una ficha puede venir en dos idiomas: se lee uno y se apunta el otro en `otrosIdiomas`
 * (el editor no deja cambiar esas fichas: el PATCH borraría el otro idioma).
 *
 * Con la migración 312 se lee también lo que Amazon dice que le pasa al listing (includedData=issues), el tipo de producto y los Item Highlights si el
 * listing los tiene con uno de los nombres conocidos (lib/seo/edicion.ts).
 */

import { spApiRequest, type AmazonCredentials } from '@/lib/amazon/sp-api'
import { highlightsDeAtributos, idiomasDeAtributo, valoresDeAtributo } from './edicion'
import { IDIOMA_DE_MARKETPLACE } from './propuesta'

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
  /** El idioma con el que se ha leído todo (el del título de este marketplace o, si no lo dice, el del país) */
  languageTag?: string | null
  /** Otros idiomas que trae la ficha en este marketplace (Bélgica: fr_BE y nl_BE). Vacío casi siempre */
  otrosIdiomas?: string[]
}

/** Los atributos de texto de la ficha (para saber en qué idiomas viene) */
const ATRIBUTOS_DE_TEXTO = ['item_name', 'bullet_point', 'product_description', 'generic_keyword']

/** El idioma con el que se lee la ficha: el del título de este marketplace (el del país si hay varios y uno es el suyo); si no dice, el del país */
export function idiomaDeFicha(atributos: Record<string, unknown> | undefined, marketplaceId: string): string | null {
  const delTitulo = idiomasDeAtributo(atributos, 'item_name', marketplaceId)
  const delPais = IDIOMA_DE_MARKETPLACE[marketplaceId]?.tag ?? null
  if (delTitulo.length === 0) return delPais
  return delPais && delTitulo.includes(delPais) ? delPais : delTitulo[0]
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
  const tag = idiomaDeFicha(atributos, marketplaceId)
  const titulo = valores(atributos, 'item_name', marketplaceId, tag)[0] ?? resumen?.itemName ?? null
  const otrosIdiomas = [...new Set(ATRIBUTOS_DE_TEXTO.flatMap((a) => idiomasDeAtributo(atributos, a, marketplaceId)))].filter((x) => x !== tag)
  return {
    sku,
    asin: resumen?.asin ?? null,
    titulo,
    bullets: valores(atributos, 'bullet_point', marketplaceId, tag),
    descripcion: valores(atributos, 'product_description', marketplaceId, tag)[0] ?? null,
    backend: valores(atributos, 'generic_keyword', marketplaceId, tag).join(' ') || null,
    highlights: highlightsDeAtributos(atributos, marketplaceId, null, tag),
    productType: resumen?.productType ?? null,
    issues: incidenciasDe(item.issues),
    atributos,
    languageTag: tag,
    otrosIdiomas,
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
