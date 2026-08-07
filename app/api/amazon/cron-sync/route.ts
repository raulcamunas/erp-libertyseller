import { NextResponse, type NextRequest } from 'next/server'
import { syncAllConnections } from '@/lib/amazon/data'
import { hasTokenKey } from '@/lib/amazon/crypto'
import { isAmazonConfigured } from '@/lib/amazon/lwa'

/**
 * EL REFRESCO DE CADA QUINCE MINUTOS.
 *
 * Lo llama el cron del propio contenedor (scripts/amazon-sync.sh, línea del
 * crontab en el Dockerfile), no el navegador. Es lo que hace que el catálogo
 * esté al día cuando alguien abre la pantalla, en vez de empezar a estarlo
 * entonces — y lo que hace que un cambio enviado pase de «enviado» a
 * «confirmado» sin que nadie tenga que volver a mirar.
 *
 * Quince minutos sobran de largo. Con unos 400 SKU por cliente, un catálogo
 * entero son unas 20 llamadas paginadas a cinco por segundo: cuatro segundos
 * por cliente y marketplace.
 *
 *
 * POR QUÉ EL SECRETO SE COMPRUEBA AL REVÉS QUE EN EL RESTO DEL ERP
 * ================================================================
 * La ruta gemela de la agenda hace esto:
 *
 *     if (secret && request.headers.get('x-cron-secret') !== secret) → 401
 *
 * o sea: si CRON_SECRET no está puesta, NO COMPRUEBA NADA. Y como en
 * middleware.ts todo lo que empieza por /api/ es ruta pública, eso deja la ruta
 * abierta a internet. En la agenda el daño de que alguien la dispare es una
 * sincronización de más. Aquí no: esta ruta lee catálogos ajenos, gasta el cupo
 * de Amazon de todos los clientes y toca sus conexiones.
 *
 * Así que aquí la ausencia del secreto CIERRA la puerta en vez de abrirla. Si
 * falta la variable, esto no funciona y hay que ponerla — que es exactamente lo
 * que se quiere que pase, porque un fallo ruidoso el día del despliegue es
 * infinitamente más barato que una ruta abierta que nadie sabe que existe.
 */
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Sin credenciales o sin clave de cifrado no hay nada que refrescar, y desde
  // luego no hay que dejar un error cada cuarto de hora en el registro.
  if (!isAmazonConfigured() || !hasTokenKey()) {
    return NextResponse.json({ ok: true, skipped: 'Amazon no configurado' })
  }

  try {
    const stats = await syncAllConnections()

    // Los fallos se registran uno a uno: son el rastro de que la conexión de un
    // cliente lleva días sin refrescarse, y sin esto solo se vería un contador.
    // El mensaje ya viene traducido y sin credenciales dentro (lib/amazon/errors.ts).
    for (const f of stats.failures) {
      console.error(
        `[amazon] refresco fallido en la conexión ${f.connectionId} (${f.marketplaceId}): ${f.error}`
      )
    }

    return NextResponse.json({ ok: true, ...stats })
  } catch (error) {
    console.error('Error en el refresco periódico de Amazon:', error)
    return NextResponse.json(
      { ok: false, error: 'El refresco periódico ha fallado' },
      { status: 500 }
    )
  }
}
