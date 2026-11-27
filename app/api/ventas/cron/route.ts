import { NextResponse, type NextRequest } from 'next/server'
import { hasTokenKey } from '@/lib/amazon/crypto'
import { isAmazonConfigured } from '@/lib/amazon/lwa'
import { pasadaVentas } from '@/lib/ventas/lectura-servidor'
import { enviarInformesDiarios } from '@/lib/ventas/informe-diario-servidor'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'

/**
 * VENTAS (EL «SELLERBOARD» PROPIO): LA LECTURA DE AMAZON (lib/ventas/lectura-servidor.ts). Pedidos, movimientos de dinero y publicidad por producto de
 * cada cuenta de `ventas_cuentas`, y el resumen por día. Solo lee de Amazon. El reloj lo decide `tocaAhora()` (5 minutos). Sin la migración 344 no hace nada.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 180

const PRESUPUESTO_MS = 140_000

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  if (request.nextUrl.searchParams.get('forzar') !== '1') {
    const veredicto = await tocaAhora('ventas')
    if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
  }
  if (!isAmazonConfigured() || !hasTokenKey()) return NextResponse.json({ ok: true, saltado: 'Amazon no configurado' })
  const salida = await conRegistro('ventas', lanzadoPorDe(request.headers), async () => {
    const r = await pasadaVentas(PRESUPUESTO_MS)
    if (r.sinTabla) return { ...r, resumen: 'falta la migración 344' }
    // El informe diario por correo (Configuración), una vez al día por cuenta desde las 8: no para la lectura si falla
    const informes = await enviarInformesDiarios().catch((e) => [`informes: ${e instanceof Error ? e.message : String(e)}`])
    const hechos = [...r.hechos, ...informes]
    return { ...r, hechos, resumen: `${r.cuentas} cuentas: ${hechos.length ? hechos.join(' | ').slice(0, 400) : 'nada que hacer'}` }
  })
  return NextResponse.json({ ok: true, ...salida })
}
