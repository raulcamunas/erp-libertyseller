import type { createServiceClient } from '@/lib/supabase/service'
import type { FbaQuantities } from '@/lib/amazon/sp-api'

type Servicio = ReturnType<typeof createServiceClient>

/** Los valores del `in()` van en la URL: por encima de unos cientos de SKU la petición se pasa de largo */
const TRAMO = 200

/**
 * EL DESGLOSE DEL STOCK DE AMAZON, AL ESPEJO DEL CATÁLOGO.
 *
 * Además del total y lo disponible, guarda lo que viene de camino («Enviado a Amazon»), lo reservado
 * y lo no apto. Sin esto la pantalla de inventario tenía que deducirlo restando, y 74 unidades de
 * camino acababan contadas como «en Amazon» y como «no vendibles».
 *
 * VA APARTE DEL UPSERT DEL CATÁLOGO Y NUNCA LANZA. Las columnas las crea la migración 271, que se
 * lanza a mano y puede llegar después que el código: si todavía no existen, el update falla con
 * 42703 y se devuelve `false` sin tocar nada. Meterlas en el upsert del catálogo habría tumbado la
 * lectura entera de todos los clientes hasta que alguien lanzase el SQL.
 *
 * Los SKU con el mismo desglose se actualizan juntos: casi todos son (0, 0, 0), así que son pocas
 * peticiones aunque el catálogo tenga miles de referencias.
 */
export async function guardarDesgloseFba(
  service: Servicio,
  conexion: string,
  mercado: string,
  fba: Map<string, FbaQuantities>
): Promise<boolean> {
  const grupos = new Map<string, { valores: Record<string, number | null>; skus: string[] }>()
  for (const [sku, q] of fba) {
    if (q.entrante === undefined && q.reservadas === undefined && q.noAptas === undefined) continue
    const valores = {
      fba_inbound_quantity: q.entrante ?? null,
      fba_reserved_quantity: q.reservadas ?? null,
      fba_unfulfillable_quantity: q.noAptas ?? null,
    }
    const clave = JSON.stringify(valores)
    const g = grupos.get(clave) ?? { valores, skus: [] as string[] }
    g.skus.push(sku)
    grupos.set(clave, g)
  }

  for (const { valores, skus } of grupos.values()) {
    for (let i = 0; i < skus.length; i += TRAMO) {
      const { error } = await service
        .from('amazon_listings')
        .update(valores)
        .eq('connection_id', conexion)
        .eq('marketplace_id', mercado)
        .in('sku', skus.slice(i, i + TRAMO))
      if (error) {
        if (error.code !== '42703') console.error('[fba] no se ha podido guardar el desglose del stock:', error.message)
        return false
      }
    }
  }
  return true
}

/**
 * EL FNSKU QUE AMAZON YA DA, AL ESPEJO DEL CATÁLOGO.
 *
 * Sin FNSKU no hay etiqueta de producto. Hasta ahora solo se rellenaba desde el libro mayor, es
 * decir, cuando una referencia ya había movido stock en FBA: una referencia nueva de un cliente
 * (Solter, 1.º envío) no tenía ninguno y las etiquetas de su primera remesa salían todas
 * descartadas. Amazon lo devuelve en el listado de listings y en el de inventario desde el momento
 * en que la referencia es de FBA, así que se guarda de ahí.
 *
 * Solo se escribe lo que cambia, y un fallo se registra y no tumba el refresco.
 */
export async function guardarFnskus(
  service: Servicio,
  conexion: string,
  mercado: string,
  fnskus: Map<string, string>
): Promise<number> {
  const skus = [...fnskus.keys()]
  let escritos = 0
  for (let i = 0; i < skus.length; i += TRAMO) {
    const tramo = skus.slice(i, i + TRAMO)
    const { data, error } = await service
      .from('amazon_listings')
      .select('sku, fnsku')
      .eq('connection_id', conexion)
      .eq('marketplace_id', mercado)
      .in('sku', tramo)
    if (error) {
      console.error('[fba] no se han podido leer los FNSKU del catálogo:', error.message)
      return escritos
    }
    const actual = new Map(((data ?? []) as Array<{ sku: string; fnsku: string | null }>).map((l) => [l.sku, l.fnsku]))
    for (const sku of tramo) {
      const nuevo = fnskus.get(sku)
      if (!nuevo || !actual.has(sku) || actual.get(sku) === nuevo) continue
      const { error: errEscribir } = await service
        .from('amazon_listings')
        .update({ fnsku: nuevo })
        .eq('connection_id', conexion)
        .eq('marketplace_id', mercado)
        .eq('sku', sku)
      if (errEscribir) console.error('[fba] no se ha podido guardar un FNSKU:', errEscribir.message)
      else escritos++
    }
  }
  return escritos
}

/** Junta los FNSKU del listado de listings y del de inventario (el de inventario manda si difieren) */
export function fnskusDe(
  items: Array<{ sku: string; fnsku?: string | null }>,
  fba: Map<string, FbaQuantities>
): Map<string, string> {
  const salida = new Map<string, string>()
  for (const i of items) if (i.fnsku) salida.set(i.sku, i.fnsku)
  for (const [sku, q] of fba) if (q.fnsku) salida.set(sku, q.fnsku)
  return salida
}
