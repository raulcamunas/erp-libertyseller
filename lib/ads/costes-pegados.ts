/**
 * AMAZON ADS · LOS COSTES PEGADOS DESDE UNA HOJA DE CÁLCULO (Marketing Test → Productos → «Pegar costes»).
 *
 * Se copian dos columnas de Excel o de Google Sheets —SKU y coste— y se pegan. `leerCostesPegados` es PURA (se prueba sin base); `guardarCostesPegados` (SOLO SERVIDOR) pone el coste a los productos de
 * Marketing Test de esa cuenta con ese SKU y lo deja también en el coste por SKU del ERP (amazon_costes_producto, vigente desde hoy), para que lo usen el resto de pantallas.
 */

import { createServiceClient } from '@/lib/supabase/service'

export interface CostePegado {
  sku: string
  coste: number
}

/** Un número escrito a la española o a la inglesa: «6,20», «6.20», «1.234,50», «1,234.50», «6,20 €» */
export function numeroEscrito(t: string): number | null {
  let s = t.replace(/[€$£\s]/g, '')
  if (!s) return null
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '')
  else if (s.includes(',')) s = s.replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10000) / 10000 : null
}

/** Las líneas pegadas → pares SKU-coste. Separador: tabulador (lo que copia Excel), punto y coma o coma final. Se saltan la cabecera y lo que no se entiende (y se dice cuántas) */
export function leerCostesPegados(texto: string): { costes: CostePegado[]; descartadas: number } {
  const costes = new Map<string, number>()
  let descartadas = 0
  for (const linea of texto.split(/\r?\n/)) {
    if (!linea.trim()) continue
    const partes = linea.includes('\t') ? linea.split('\t') : linea.includes(';') ? linea.split(';') : linea.split(/,(?=[^,]*$)/)
    if (partes.length < 2) {
      descartadas++
      continue
    }
    const sku = partes[0].trim().replace(/^"|"$/g, '')
    const coste = numeroEscrito(partes[partes.length - 1].trim().replace(/^"|"$/g, ''))
    if (!sku || coste === null) {
      descartadas++
      continue
    }
    costes.set(sku, coste)
  }
  return { costes: [...costes].map(([sku, coste]) => ({ sku, coste })), descartadas }
}

export async function guardarCostesPegados(cuenta: { id: string; clienteAmazonId: string | null; moneda: string | null }, costes: readonly CostePegado[], userId: string): Promise<{ actualizados: number; sinProducto: string[] }> {
  const service = createServiceClient()
  const { data } = await service.from('ads_productos').select('id, sku').eq('perfil_id', cuenta.id)
  const porSku = new Map(((data ?? []) as Array<{ id: string; sku: string }>).map((p) => [p.sku.trim(), p.id]))
  let actualizados = 0
  const sinProducto: string[] = []
  for (const c of costes) {
    const id = porSku.get(c.sku)
    if (!id) {
      sinProducto.push(c.sku)
      continue
    }
    const { error } = await service.from('ads_productos').update({ coste_producto: c.coste, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw error
    actualizados++
  }
  // El coste por SKU del ERP, vigente desde hoy. Si falla (otra moneda, tabla sin lanzar…) no se deshace lo de arriba
  if (cuenta.clienteAmazonId && costes.length > 0) {
    const hoy = new Date().toISOString().slice(0, 10)
    const { error } = await service.from('amazon_costes_producto').upsert(
      costes.map((c) => ({ client_id: cuenta.clienteAmazonId, sku: c.sku, coste: c.coste, moneda: cuenta.moneda ?? 'EUR', valido_desde: hoy, origen: 'fichero', fuente_ref: 'Marketing Test · costes pegados', created_by: userId })),
      { onConflict: 'client_id,sku,valido_desde' }
    )
    if (error) console.error('Ads: no se han podido guardar los costes en amazon_costes_producto:', error.message)
  }
  return { actualizados, sinProducto }
}
