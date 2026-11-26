import { NextResponse, type NextRequest } from 'next/server'
import { hasTokenKey } from '@/lib/amazon/crypto'
import { isAmazonConfigured } from '@/lib/amazon/lwa'
import { pasadaResenas } from '@/lib/ventas/resenas-servidor'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'

/**
 * RESEÑAS: EL ENVÍO (lib/ventas/resenas-servidor.ts). Mete en la cola los pedidos nuevos de las cuentas con campaña activa y pide la reseña de los que ya
 * toca, con la API oficial de Amazon (Solicitations), una por segundo como mucho. El reloj lo decide `tocaAhora()` (10 minutos). Sin la migración 347 no hace nada.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 180

const PRESUPUESTO_MS = 140_000

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  if (request.nextUrl.searchParams.get('forzar') !== '1') {
    const veredicto = await tocaAhora('resenas')
    if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
  }
  if (!isAmazonConfigured() || !hasTokenKey()) return NextResponse.json({ ok: true, saltado: 'Amazon no configurado' })
  const salida = await conRegistro('resenas', lanzadoPorDe(request.headers), async () => {
    const r = await pasadaResenas(PRESUPUESTO_MS)
    if (r.sinTabla) return { ...r, resumen: 'falta la migración 347' }
    return { ...r, resumen: `${r.encolados} a la cola, ${r.enviadas} reseñas pedidas${r.hechos.length ? ` · ${r.hechos.join(' | ').slice(0, 300)}` : ''}${r.avisos.length ? ` · avisos: ${r.avisos.join(' | ').slice(0, 200)}` : ''}` }
  })
  return NextResponse.json({ ok: true, ...salida })
}
