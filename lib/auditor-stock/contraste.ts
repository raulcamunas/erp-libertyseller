import { createServiceClient } from '@/lib/supabase/service'
import { fetchAll } from '@/lib/supabase/paginacion'
import { leerTodo } from '@/lib/prestashop/cliente'
import { claveDe } from '@/lib/prestashop/conexion'
import { cruzar, divergencias, type Divergencia, type FilaAmazon } from '@/lib/prestashop/cruce'
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

export interface InformeContraste {
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
  const { cruzados, sinCruce } = cruzar(amazon, tallas)
  const d = divergencias(cruzados)
  const sinCruceConStock = sinCruce.filter((a) => a.cantidad > 0)

  return {
    generadoAt: new Date().toISOString(),
    amazon: {
      auditoriaAt: ultima.creada_at,
      listingsFbm: amazon.length,
      conStock: amazon.filter((a) => a.cantidad > 0).length,
      conEan: amazon.filter((a) => a.ean !== null).length,
    },
    tienda: {
      tallas: tallas.length,
      conEan: tallas.filter((t) => t.ean !== null).length,
      conStockDato: tallas.filter((t) => t.cantidad !== null).length,
      duplicadosStock,
      ms: msTienda,
    },
    cruce: {
      cruzados: cruzados.length,
      porEan: cruzados.filter((c) => c.via === 'ean').length,
      porReferencia: cruzados.filter((c) => c.via === 'referencia').length,
      ambiguos: d.ambiguos,
      sinCruce: sinCruce.length,
      sinCruceConStock: sinCruceConStock.length,
    },
    divergencias: {
      sobreventa: d.sobreventa.length,
      ventaPerdida: d.ventaPerdida.length,
      distinta: d.distinta.length,
      iguales: d.iguales,
      sinDatoTienda: d.sinDatoTienda,
    },
    listas: {
      sobreventa: d.sobreventa.slice(0, MAX_LISTA),
      ventaPerdida: d.ventaPerdida.slice(0, MAX_LISTA),
      distinta: d.distinta.slice(0, MAX_LISTA),
      sinCruceConStock: sinCruceConStock
        .sort((a, b) => b.cantidad - a.cantidad || a.sku.localeCompare(b.sku))
        .slice(0, MAX_LISTA)
        .map((a) => ({ sku: a.sku, ean: a.ean, cantidad: a.cantidad })),
    },
  }
}
