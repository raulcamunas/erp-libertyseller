import { NextResponse, type NextRequest } from 'next/server'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'
import { pasadaDeReuniones } from '@/lib/tareas-clientes/reuniones-servidor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 240

/**
 * LA PASADA DE LAS REUNIONES CON CLIENTES (cada 10 minutos; el reloj lo decide `tocaAhora()` desde cron_config). Busca reuniones de seguimiento nuevas en las notas de Gemini y
 * guarda las tareas que propone la IA. Ver lib/tareas-clientes/reuniones-servidor.ts. Solo se entra con la cabecera x-cron-secret (CRON_SECRET).
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  const forzar = request.nextUrl.searchParams.get('forzar') === '1'
  if (!forzar) {
    const veredicto = await tocaAhora('tareas-reuniones')
    if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
  }
  const salida = await conRegistro('tareas-reuniones', lanzadoPorDe(request.headers), () => pasadaDeReuniones({ forzar }))
  return NextResponse.json(salida)
}
