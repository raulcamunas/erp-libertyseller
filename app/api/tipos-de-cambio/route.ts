import { NextResponse } from 'next/server'
import { tiposDeCambio } from '@/lib/divisas/servidor'

/** Los tipos de cambio del día (BCE): cuántas unidades de cada moneda vale 1 €. Datos públicos; se guardan 12 h en el servidor */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json(await tiposDeCambio(), { headers: { 'Cache-Control': 'private, max-age=3600' } })
}
