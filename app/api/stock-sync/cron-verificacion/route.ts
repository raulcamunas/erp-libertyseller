import { NextResponse, type NextRequest } from 'next/server'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'
import { ejecutarVencidas } from '@/lib/stock-sync/verificacion'

/**
 * LA TAREA QUE VERIFICA LO SUBIDO A AMAZON.
 *
 * Entra cada minuto (crontab) y casi siempre dice «no me toca»: el reloj de verdad
 * vive en cron_config (5 minutos). Recoge las verificaciones cuya hora ya ha
 * llegado —media hora después de cada envío de stock— y las hace. Sin ninguna
 * vencida no llama a Amazon.
 *
 * EL SECRETO CIERRA LA PUERTA SI FALTA, NO LA ABRE. Mismo criterio que el resto de
 * tareas: en middleware.ts todo lo que empieza por /api/ es público.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  if (request.nextUrl.searchParams.get('forzar') !== '1') {
    const veredicto = await tocaAhora('stock-verificacion')
    if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
  }

  const salida = await conRegistro('stock-verificacion', lanzadoPorDe(request.headers), async () => {
    const r = await ejecutarVencidas()
    return { ...r, resumen: `${r.hechas} verificaciones hechas, ${r.errores} con error, ${r.pendientes} pendientes` }
  })
  return NextResponse.json({ ok: true, ...salida })
}
