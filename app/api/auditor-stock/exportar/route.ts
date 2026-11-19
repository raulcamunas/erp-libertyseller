import { NextResponse, type NextRequest } from 'next/server'
import { requireAmazonAdmin } from '@/lib/amazon/api'
import { exportarAuditor } from '@/lib/auditor-stock/exportar'

/** AUDITOR DE STOCK · EL HISTORIAL EN UN CSV (solo administradores). La lógica está en lib/auditor-stock/exportar.ts, que comparte con el enlace del cliente */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(request: NextRequest) {
  const session = await requireAmazonAdmin()
  if (session instanceof NextResponse) return session
  return exportarAuditor(request)
}
