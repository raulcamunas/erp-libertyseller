import { createServiceClient } from '@/lib/supabase/service'
import { fetchAll } from '@/lib/supabase/paginacion'
import { leerTodo } from '@/lib/prestashop/cliente'
import { claveDe } from '@/lib/prestashop/conexion'
import { cruzar, type Divergencia, type FilaAmazon } from '@/lib/prestashop/cruce'
import { resumirContraste } from '@/lib/prestashop/informe'
import { unirStock } from '@/lib/prestashop/stock'
import type { FilaDetalle } from './clasificar'

/**
 * CONTRASTAR EL STOCK DE AMAZON CON EL DE LA TIENDA.
 * SOLO SERVIDOR. Solo lee: de la base, de la tienda de ShoesF, y no escribe nada.
 *
 * Cruza lo que Amazon dijo en la ÚLTIMA AUDITORÍA COMPLETA con lo que la tienda
 * tiene AHORA, y devuelve qué hay desalineado. Hay una diferencia de unos minutos
 * entre las dos fotos —lo que tarde en llegar a esta pantalla desde la
 * auditoría—, y el informe la dice.
 *
 *
 * ============ QUÉ SE COMPARA, Y QUÉ NO ============
 *
 * SOLO LO QUE ENVÍA EL VENDEDOR (FBM). El stock FBA está en los almacenes de
 * Amazon y no tiene por qué parecerse al de la tienda: comparar los dos daría
 * miles de «divergencias» que no lo son.
 *
 * Y NO SE COMPARA SOLO LO QUE TIENE STOCK. Para decir «la tienda tiene 4 y Amazon
 * 0» hay que mirar también los de Amazon a cero, que son los 12.000 que el
 * detalle de la auditoría no lista. Por eso la parte de Amazon sale del espejo
 * del catálogo —todos los listings— y la cantidad de la auditoría, con 0 para los
 * que no figuran.
 */

export type EstadoFila =
  | 'coincide'
  | 'venta_perdida'
  | 'sobreventa'
  | 'distinta'
  | 'sin_dato'
  | 'dudoso'
  | 'sin_pareja'

/** [sku, asin, ean de Amazon, cantidad en Amazon, cantidad en la tienda o null, estado] */
export type FilaTodas = [string, string | null, string | null, number, number | null, EstadoFila]

export interface InformeContraste {
  /** Todos los listings emparejados con stock en alguno de los dos lados, sin tope */
  todas: FilaTodas[]
  generadoAt: string
  amazon: { auditoriaAt: string; listingsFbm: number; conStock: number; conEan: number }
  tienda: {
    tallas: number
    conEan: number
    conStockDato: number
    duplicadosStock: number
    ms: number
  }
  cruce: {
    cruzados: number
    porEan: number
    porReferencia: number
    ambiguos: number
    sinCruce: number
    sinCruceConStock: number
  }
  divergencias: {
    sobreventa: number
    ventaPerdida: number
    distinta: number
    iguales: number
    sinDatoTienda: number
  }
  listas: {
    sobreventa: Divergencia[]
    ventaPerdida: Divergencia[]
    distinta: Divergencia[]
    sinCruceConStock: { sku: string; ean: string | null; cantidad: number }[]
  }
}

/** Cuántas filas de cada lista se devuelven. El recuento siempre es el exacto */
const MAX_LISTA = 200

interface FilaEspejo {
  sku: string
  asin: string | null
  codigo_externo: string | null
  codigo_externo_tipo: string | null
}

export async function contrastar(
  clientId: string,
  connectionId: string,
  marketplaceId: string
): Promise<InformeContraste | { error: string }> {
  const conexion = await claveDe(clientId)
  if (!conexion) return { error: 'Primero hay que conectar la tienda: guarda la dirección y la clave.' }

  const service = createServiceClient()

  // ---------- Amazon: la última auditoría completa ----------
  const { data: aud, error: errAud } = await service
    .from('stock_auditorias')
    .select('creada_at, detalle')
    .eq('connection_id', connectionId)
    .eq('marketplace_id', marketplaceId)
    .eq('estado', 'completa')
    .order('creada_at', { ascending: false })
    .limit(1)
  if (errAud) return { error: `No se han podido leer las auditorías: ${errAud.message}` }
  const ultima = ((aud ?? []) as Array<{ creada_at: string; detalle: FilaDetalle[] | null }>)[0]
  if (!ultima?.detalle) {
    return { error: 'Todavía no hay ninguna auditoría completa con la que contrastar.' }
  }

  // Solo FBM: ver la cabecera.
  const cantidadDe = new Map<string, number>()
  for (const f of ultima.detalle) if (f[3] === 'M') cantidadDe.set(f[0], f[2])

  // ---------- Amazon: todos los listings FBM, con su EAN ----------
  const espejo = await fetchAll<FilaEspejo>((a, b) =>
    service
      .from('amazon_listings')
      .select('sku, asin, codigo_externo, codigo_externo_tipo')
      .eq('connection_id', connectionId)
      .eq('marketplace_id', marketplaceId)
      .eq('is_fba', false)
      .or('clasificacion_item.is.null,clasificacion_item.neq.VARIATION_PARENT')
      .order('sku', { ascending: true })
      .range(a, b)
  )
  const amazon: FilaAmazon[] = espejo.map((l) => ({
    sku: l.sku,
    asin: l.asin,
    // EAN, UPC o GTIN: todos son el mismo tipo de código numérico y se normalizan igual
    ean: l.codigo_externo_tipo && l.codigo_externo_tipo !== 'ASIN' ? l.codigo_externo : null,
    cantidad: cantidadDe.get(l.sku) ?? 0,
  }))

  // ---------- La tienda ----------
  const t0 = Date.now()
  let stock, combos, productos
  try {
    stock = await leerTodo(conexion, 'stock_availables', ['id_product', 'id_product_attribute', 'quantity'])
    combos = await leerTodo(conexion, 'combinations', ['id', 'id_product', 'ean13', 'reference'])
    productos = await leerTodo(conexion, 'products', ['id', 'ean13', 'reference'])
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'No se ha podido leer la tienda.' }
  }
  const { filas: tallas, duplicadosStock } = unirStock(stock, combos, productos)
  const msTienda = Date.now() - t0

  // ---------- El cruce ----------
  // El MISMO cálculo que hace cada auditoría de 10 minutos: no hay dos formas de
  // contar lo mismo. Ver lib/prestashop/informe.ts.
  const r = resumirContraste(amazon, tallas, MAX_LISTA)

  // La tabla entera: cada listing con stock en alguno de los dos lados. Es lo único
  // que NO se guarda en las auditorías (serían miles de filas cada diez minutos);
  // se calcula aquí, bajo demanda.
  const { cruzados, sinCruce } = cruzar(amazon, tallas)
  const eanDe = new Map(amazon.map((x) => [x.sku, x.ean]))
  const todas: FilaTodas[] = []
  for (const c of cruzados) {
    const t = c.tienda === null ? null : Math.max(0, c.tienda)
    let estado: EstadoFila
    if (c.ambiguo) estado = 'dudoso'
    else if (t === null) estado = 'sin_dato'
    else if (c.amazon > 0 && t === 0) estado = 'sobreventa'
    else if (c.amazon === 0 && t > 0) estado = 'venta_perdida'
    else if (c.amazon !== t) estado = 'distinta'
    else estado = 'coincide'
    if (c.amazon > 0 || (t ?? 0) > 0) todas.push([c.sku, c.asin, eanDe.get(c.sku) ?? null, c.amazon, t, estado])
  }
  for (const a of sinCruce) {
    if (a.cantidad > 0) todas.push([a.sku, a.asin, a.ean, a.cantidad, null, 'sin_pareja'])
  }

  return {
    todas,
    generadoAt: new Date().toISOString(),
    amazon: {
      auditoriaAt: ultima.creada_at,
      listingsFbm: amazon.length,
      conStock: amazon.filter((a) => a.cantidad > 0).length,
      conEan: amazon.filter((a) => a.ean !== null).length,
    },
    tienda: {
      tallas: r.tienda.tallas,
      conEan: tallas.filter((t) => t.ean !== null).length,
      conStockDato: r.tienda.tallas - r.tienda.sinDato,
      duplicadosStock,
      ms: msTienda,
    },
    cruce: {
      cruzados: r.cruce.cruzados,
      porEan: r.cruce.porEan,
      porReferencia: r.cruce.porReferencia,
      ambiguos: r.cruce.ambiguos,
      sinCruce: r.cruce.sinPareja,
      sinCruceConStock: r.cruce.sinParejaConStock,
    },
    divergencias: {
      sobreventa: r.divergencias.sobreventa,
      ventaPerdida: r.divergencias.ventaPerdida,
      distinta: r.divergencias.distinta,
      iguales: r.divergencias.iguales,
      sinDatoTienda: r.divergencias.sinDatoTienda,
    },
    listas: {
      sobreventa: r.listas.sobreventa,
      ventaPerdida: r.listas.ventaPerdida,
      distinta: r.listas.distinta,
      sinCruceConStock: r.listas.sinParejaConStock,
    },
  }
}
