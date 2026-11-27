import { NextResponse, type NextRequest } from 'next/server'
import { fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { createServiceClient } from '@/lib/supabase/service'
import { estadoDeTopes, olvidarTopes } from '@/lib/entrais/topes'

/**
 * TOPES DE UNIDADES DE ENTRAIS (Amazon + PcComponentes). SOLO ADMIN.
 *   GET                                         los topes con lo vendido y lo que queda
 *   POST { sku, unidades, desde, hasta, nota }  pone o cambia el tope de un producto
 *   POST { borrar: sku }                        lo quita
 */
export const dynamic = 'force-dynamic'

const FECHA = /^\d{4}-\d{2}-\d{2}$/

export async function GET() {
  const sesion = await requireAmazonAdmin()
  if (sesion instanceof NextResponse) return sesion
  return NextResponse.json({ topes: await estadoDeTopes() })
}

export async function POST(request: NextRequest) {
  const sesion = await requireAmazonAdmin()
  if (sesion instanceof NextResponse) return sesion
  const b = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!b) return fail(400, 'Petición vacía')
  const s = createServiceClient()
  if (typeof b.borrar === 'string') {
    const { error } = await s.from('entrais_topes').delete().eq('sku', b.borrar)
    if (error) return fail(500, error.message)
    olvidarTopes()
    return NextResponse.json({ ok: true })
  }
  const sku = String(b.sku ?? '').trim()
  const unidades = Number(b.unidades)
  const desde = String(b.desde ?? '')
  const hasta = String(b.hasta ?? '')
  if (!sku) return fail(400, 'Falta la referencia del producto')
  if (!Number.isInteger(unidades) || unidades < 0) return fail(400, 'Las unidades tienen que ser un número entero')
  if (!FECHA.test(desde) || !FECHA.test(hasta) || hasta < desde) return fail(400, 'Las fechas no son válidas')
  const { error } = await s.from('entrais_topes').upsert({ sku, unidades, desde, hasta, nota: typeof b.nota === 'string' && b.nota.trim() ? b.nota.trim() : null, creado_por: sesion.userId, updated_at: new Date().toISOString() }, { onConflict: 'sku' })
  if (error) return fail(500, error.message.includes('entrais_topes') ? 'Falta lanzar la migración 350' : error.message)
  olvidarTopes()
  return NextResponse.json({ ok: true })
}
