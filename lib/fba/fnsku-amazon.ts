import { guardarFnskus } from '@/lib/amazon/fba-desglose'
import { connectionCredentials } from '@/lib/amazon/data'
import { fetchFnskusPorSku, fetchListingsBySku } from '@/lib/amazon/sp-api'
import type { createServiceClient } from '@/lib/supabase/service'

type Servicio = ReturnType<typeof createServiceClient>

/**
 * QUÉ DICE AMAZON DEL FNSKU DE UNA REFERENCIA.
 *
 *   · `real`    -> un FNSKU de Amazon (X00…): lleva etiqueta de Amazon.
 *   · `asin`    -> Amazon da su ASIN como FNSKU: la referencia va con el código del fabricante (EAN/UPC)
 *                  y no lleva etiqueta de Amazon.
 *   · `ninguno` -> Amazon todavía no le ha dado ninguno: no ha estado en ningún envío ni tiene stock.
 */
export type EstadoFnsku = 'real' | 'asin' | 'ninguno'

export interface FnskuLeido {
  sku: string
  fnsku: string | null
  estado: EstadoFnsku
  /** De dónde salió, para poder ver qué contesta Amazon cuando algo no cuadra */
  fuentes: { inventario: string | null; listing: string | null }
}

/**
 * PIDE A AMAZON, AHORA, EL FNSKU DE ESTAS REFERENCIAS Y LO GUARDA EN EL ESPEJO DEL CATÁLOGO.
 *
 * El espejo se rellenaba solo con el refresco del catálogo y con el libro mayor de la noche, así que
 * una referencia nueva —el primer envío de un cliente— salía sin FNSKU y las etiquetas fallaban hasta el
 * día siguiente. Aquí se lee en el momento: del inventario (`sellerSkus`) y del listing, y si los dos
 * difieren manda el que no sea el ASIN.
 *
 * Nunca lanza por un fallo de Amazon: devuelve lo que haya podido leer y `error` con el motivo, para que
 * quien imprime etiquetas pueda seguir con lo que ya tenía.
 */
export async function leerFnskusDeAmazon(
  service: Servicio,
  conexion: string,
  mercado: string,
  skus: string[]
): Promise<{ leidos: FnskuLeido[]; error: string | null }> {
  if (skus.length === 0) return { leidos: [], error: null }
  try {
    const resuelta = await connectionCredentials(conexion)
    if (!resuelta) return { leidos: [], error: 'La conexión con Amazon de este cliente ya no existe' }
    const { credentials } = resuelta

    const [inventario, listings] = await Promise.all([
      fetchFnskusPorSku(credentials, mercado, skus).catch(() => new Map<string, string>()),
      fetchListingsBySku(credentials, { marketplaceId: mercado, skus, incluir: ['summaries'] }).catch(() => null),
    ])

    const delListing = new Map<string, { fnsku: string | null; asin: string | null }>()
    for (const i of listings?.items ?? []) delListing.set(i.sku, { fnsku: i.fnsku ?? null, asin: i.asin })

    const leidos: FnskuLeido[] = skus.map((sku) => {
      const l = delListing.get(sku)
      const deInventario = inventario.get(sku) ?? null
      const deListing = l?.fnsku ?? null
      const esAsin = (v: string | null) => !!v && !!l?.asin && v.toUpperCase() === l.asin.toUpperCase()
      const real = [deInventario, deListing].find((v) => !!v && !esAsin(v)) ?? null
      const fnsku = real ?? deInventario ?? deListing
      const estado: EstadoFnsku = real ? 'real' : fnsku ? 'asin' : 'ninguno'
      return { sku, fnsku, estado, fuentes: { inventario: deInventario, listing: deListing } }
    })

    await guardarFnskus(
      service,
      conexion,
      mercado,
      new Map(leidos.filter((x) => x.fnsku).map((x) => [x.sku, x.fnsku as string]))
    )
    return { leidos, error: null }
  } catch (e) {
    return { leidos: [], error: e instanceof Error ? e.message.slice(0, 200) : 'No se ha podido leer de Amazon' }
  }
}
