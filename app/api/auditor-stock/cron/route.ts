import { NextResponse, type NextRequest } from 'next/server'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'
import { auditar } from '@/lib/auditor-stock/auditar'

/**
 * EL RELOJ DEL AUDITOR DE STOCK.
 *
 * El crontab del contenedor llama a esta ruta CADA MINUTO; cada cuánto se audita
 * de verdad lo decide `tocaAhora()` leyendo la tabla `cron_config`, que es lo que
 * permite pasar de 15 a 10 minutos desde la pantalla de Sistema sin tocar el
 * Dockerfile ni volver a desplegar.
 *
 * `?forzar=1` se salta el reloj. Es lo que usa el botón de «Lanzar ahora».
 *
 * EL SECRETO CIERRA LA PUERTA SI FALTA, NO LA ABRE: en middleware.ts todo lo que
 * empieza por /api/ es ruta pública, así que un `if (secret && …)` dejaría esta
 * ruta —que gasta el cupo de Amazon de un cliente— abierta a internet el día que
 * la variable desaparezca. Mismo criterio que cron-jobs y cron-sync.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** El auditor se corta solo a los 240 s (PRESUPUESTO_MS). Esto va por encima */
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const forzar = new URL(request.url).searchParams.get('forzar') === '1'
  if (!forzar) {
    const veredicto = await tocaAhora('auditor-stock')
    if (!veredicto.toca) {
      return NextResponse.json({ ok: true, omitido: true, motivo: veredicto.motivo })
    }
  }

  const salida = await conRegistro('auditor-stock', lanzadoPorDe(request.headers), async () => {
    const r = await auditar()
    return { ...r, resumen: r.mensaje }
  })

  return NextResponse.json({ ok: true, ...salida })
}
