import { NextResponse, type NextRequest } from 'next/server'
import { conRegistro, lanzadoPorDe } from '@/lib/sistema/cron'
import { faltaConfigurarPcc } from '@/lib/pccomponentes/mirakl'
import { FaltaMigracion321, pasadaSiToca, tocaPasada } from '@/lib/pccomponentes/dinamico-servidor'

/**
 * PRECIOS DINÁMICOS DE ENTRAIS EN PCCOMPONENTES. Lo llama el cron del contenedor cada minuto (scripts/pcc-precios.sh); el reloj de verdad está en la
 * configuración (`cada_minutos`, 30 por defecto), así que casi siempre contesta sin hacer nada. Ver lib/pccomponentes/dinamico-servidor.ts.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (faltaConfigurarPcc()) return NextResponse.json({ ok: true, saltado: 'PcComponentes no configurado' })
  try {
    // Sin abrir registro cuando no toca: una línea por minuto en el historial de crons no dice nada
    if (!(await tocaPasada())) return NextResponse.json({ ok: true, hecho: false })
    return NextResponse.json(await conRegistro('pcc-precios', lanzadoPorDe(request.headers), () => pasadaSiToca() as unknown as Promise<Record<string, unknown>>))
  } catch (error) {
    if (error instanceof FaltaMigracion321) return NextResponse.json({ ok: true, saltado: error.message })
    console.error('[pcc-precios]', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Error' }, { status: 500 })
  }
}
