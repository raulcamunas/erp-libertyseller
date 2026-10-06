import { NextResponse, type NextRequest } from 'next/server'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'
import {
  anotarEvento,
  pasadaAutomatica,
  resumirAutomatico,
} from '@/lib/precios-shoplamp/automatico'

/**
 * EL RELOJ DE LOS PRECIOS DE SHOPLAMP.
 *
 * El crontab del contenedor llama a esta ruta CADA MINUTO; cada cuánto se
 * publica de verdad lo decide `tocaAhora()` leyendo la tabla `cron_config`, que
 * es lo que permite cambiar «cada 6 horas» por «cada 12» desde la pantalla de
 * Sistema sin tocar el Dockerfile ni volver a desplegar.
 *
 * `?forzar=1` se salta el reloj. Es lo que usa el botón de «Lanzar ahora».
 *
 *
 * EL SECRETO CIERRA LA PUERTA SI FALTA, NO LA ABRE
 * ------------------------------------------------
 * Igual que cron-jobs y cron-sync, y por el mismo motivo: en middleware.ts todo
 * lo que empieza por /api/ es ruta pública, así que un `if (secret && …)` dejaría
 * esta ruta —que PUBLICA PRECIOS en la tienda de un cliente— abierta a internet
 * el día que la variable desaparezca. Un fallo ruidoso al desplegar es
 * infinitamente más barato.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * El tope del lote automático son 150 referencias y el cupo de Amazon es de 5
 * por segundo: 30 segundos de envío. Con margen para construir el plan —que lee
 * cuatro catálogos— y para los reintentos.
 */
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const forzar = new URL(request.url).searchParams.get('forzar') === '1'
  if (!forzar) {
    const veredicto = await tocaAhora('shoplamp-precios')
    if (!veredicto.toca) {
      return NextResponse.json({ ok: true, omitido: true, motivo: veredicto.motivo })
    }
  }

  const salida = await conRegistro('shoplamp-precios', lanzadoPorDe(request.headers), async () => {
    const r = await pasadaAutomatica(null)
    await anotarEvento(r)
    return { ...r, resumen: resumirAutomatico(r) }
  })

  return NextResponse.json({ ok: true, ...salida })
}
