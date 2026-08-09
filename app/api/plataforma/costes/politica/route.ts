import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, readText, requireAmazonAdmin } from '@/lib/amazon/api'
import { faltaEsquema } from '@/lib/plataforma/pantallas'
import { FALTAN_MIGRACIONES_COSTES } from '@/lib/plataforma/costes/tipos'
import { guardarPolitica, politicaDe } from '@/lib/plataforma/costes/datos'

/**
 * LA POLÍTICA DE COSTES DE UN CLIENTE.
 *
 * Solo admin. Es lo único de A5 que es una DECISIÓN DE NEGOCIO y no un dato, y
 * por eso vive en su propia tabla y nace vacía:
 *
 *   · `dias_caducidad` — a partir de cuántos días un coste deja de valer. Nadie
 *     lo puede deducir de nada: depende del proveedor y del sector. Mientras
 *     esté vacío, la pantalla enseña la ANTIGÜEDAD (un hecho) y dice que no hay
 *     política (otro hecho), en vez de pintar de rojo lo que a lo mejor está
 *     perfectamente vigente.
 *   · `exigir_envio_propio` y `exigir_costes_fba` — qué patas hacen falta para
 *     dar un coste por completo. Vienen encendidas, que es lo estricto, y se
 *     apagan a conciencia para el cliente cuyo porte paga el comprador o que
 *     negocia el flete dentro del precio de compra.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const clientId = request.nextUrl.searchParams.get('clientId') ?? ''
    if (!UUID.test(clientId)) return fail(400, 'Falta el cliente')

    return NextResponse.json({ politica: await politicaDe(clientId) })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES_COSTES)
    return errorResponse(error, 'Error cargando la política de costes')
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const clientId = typeof body.clientId === 'string' ? body.clientId : ''
    if (!UUID.test(clientId)) return fail(400, 'Falta el cliente')

    const patch: Record<string, unknown> = {}

    if ('dias_caducidad' in body) {
      const dias = body.dias_caducidad
      if (dias === null || dias === '') {
        // Volver a «sin decidir» tiene que ser posible: alguien puede poner un
        // número, ver que no encaja y querer quitarlo. Dejarlo puesto «porque ya
        // estaba» es cómo se hereda un umbral que nadie decidió.
        patch.dias_caducidad = null
      } else {
        const n = Number(dias)
        if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
          return fail(400, 'Los días de caducidad tienen que ser un número entero mayor que cero')
        }
        patch.dias_caducidad = n
      }
    }

    if ('moneda_defecto' in body) {
      const moneda = readText(body.moneda_defecto, 8)
      patch.moneda_defecto = moneda ? moneda.toUpperCase() : null
    }

    if ('exigir_envio_propio' in body) patch.exigir_envio_propio = body.exigir_envio_propio === true
    if ('exigir_costes_fba' in body) patch.exigir_costes_fba = body.exigir_costes_fba === true
    if ('notes' in body) patch.notes = readText(body.notes, 2000)

    if (Object.keys(patch).length === 0) return fail(400, 'No hay nada que cambiar')

    const politica = await guardarPolitica(clientId, patch, session.userId)
    return NextResponse.json({ politica })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES_COSTES)
    return errorResponse(error, 'Error guardando la política de costes')
  }
}
