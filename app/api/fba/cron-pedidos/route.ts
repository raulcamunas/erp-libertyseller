import { NextResponse, type NextRequest } from 'next/server'
import { hasTokenKey } from '@/lib/amazon/crypto'
import { isAmazonConfigured } from '@/lib/amazon/lwa'
import { pasadaPedidos } from '@/lib/fba/pedidos-servidor'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LAS VENTAS FBA Y FBM DE CADA CUENTA (lib/fba/pedidos-servidor.ts). Pide o recoge el informe de pedidos de Amazon de cada cuenta del libro mayor.
 * Solo lee de Amazon. El reloj lo decide `tocaAhora()` (cron_config, 5 minutos por defecto). Sin la migración 335 no hace nada.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 180

const PRESUPUESTO_MS = 140_000

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }
  if (request.nextUrl.searchParams.get('forzar') !== '1') {
    const veredicto = await tocaAhora('fba-pedidos')
    if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
  }
  if (!isAmazonConfigured() || !hasTokenKey()) {
    return NextResponse.json({ ok: true, saltado: 'Amazon no configurado' })
  }
  const salida = await conRegistro('fba-pedidos', lanzadoPorDe(request.headers), async () => {
    const r = await pasadaPedidos(createServiceClient(), PRESUPUESTO_MS)
    if (r.sinTabla) return { ...r, resumen: 'falta la migración 335' }
    return { ...r, resumen: `${r.cuentas} cuentas: ${r.pedidos} informes pedidos, ${r.recogidos} recogidos (${r.filas} filas)` }
  })
  return NextResponse.json({ ok: true, ...salida })
}
