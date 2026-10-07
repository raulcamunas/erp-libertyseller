import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, fail, requireAmazonAdmin, UUID } from '@/lib/amazon/api'
import { ALCANCES, MAX_CORREGIR, MAX_LEER, type Alcance } from '@/lib/precios-limites/diagnostico'
import {
  candidatos,
  corregir,
  leer,
  resolverConexion,
} from '@/lib/precios-limites/servidor'

/**
 * SINCRONIZAR PRECIO MÍNIMO Y MÁXIMO · LA RUTA.
 *
 * Tres acciones, una por petición, y la pantalla las encadena:
 *
 *   candidatos   qué SKU hay que preguntarle a Amazon (lee solo de Supabase).
 *   leer         pregunta a Amazon por unos SKU y devuelve los que tienen error.
 *   corregir     ESCRIBE. Vuelve a leer esos SKU y fija el límite roto.
 *
 * El cliente y el país llegan en el cuerpo, pero NO se confía en ellos: se
 * resuelve la cuenta de Amazon desde el cliente y se comprueba que el país es
 * uno de los autorizados de ESA cuenta. Un país que el cliente no nos ha
 * autorizado no se puede pedir ni a mano.
 *
 * Y SOLO ADMIN, como todo lo de Amazon API y Growth Partner: desde aquí se
 * escribe en la tienda de un cliente.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as {
      accion?: string
      clientId?: string
      marketplaceId?: string
      alcance?: string
      skus?: unknown
      simular?: boolean
    }

    const clientId = (body.clientId ?? '').trim()
    if (!UUID.test(clientId)) return fail(400, 'Elige un cliente.')
    const marketplaceId = (body.marketplaceId ?? '').trim()
    if (!marketplaceId) return fail(400, 'Elige un país.')

    const conexion = await resolverConexion(clientId, marketplaceId)
    if ('error' in conexion) return fail(conexion.status, conexion.error)

    /* ---------------- Candidatos ---------------- */
    if (body.accion === 'candidatos') {
      const alcance = ALCANCES.find((a) => a.id === body.alcance)?.id as Alcance | undefined
      if (!alcance) return fail(400, 'Alcance desconocido.')

      const lista = await candidatos(conexion.connectionId, marketplaceId, alcance)
      return NextResponse.json({
        ok: true,
        cuenta: conexion.nombre,
        total: lista.length,
        candidatos: lista,
      })
    }

    // Lo que sigue trabaja sobre una lista de SKU. Se limpia aquí, una vez.
    const skus = Array.isArray(body.skus)
      ? Array.from(
          new Set(
            (body.skus as unknown[]).filter(
              (s): s is string => typeof s === 'string' && s.trim() !== ''
            )
          )
        )
      : []
    if (skus.length === 0) return fail(400, 'No hay ninguna referencia.')

    /* ---------------- Leer ---------------- */
    if (body.accion === 'leer') {
      if (skus.length > MAX_LEER) {
        return fail(400, `De una vez se leen como mucho ${MAX_LEER} referencias.`)
      }
      const r = await leer(conexion.connectionId, marketplaceId, skus)
      if ('error' in r) return fail(r.status, r.error)
      return NextResponse.json({ ok: true, ...r })
    }

    /* ---------------- Corregir ---------------- */
    if (body.accion === 'corregir') {
      if (skus.length > MAX_CORREGIR) {
        return fail(
          400,
          `De una vez se corrigen como mucho ${MAX_CORREGIR} referencias. Con más, la petición ` +
            'se queda sin tiempo a la mitad y no habría forma de saber cuáles llegaron.'
        )
      }
      const r = await corregir({
        clientId,
        connectionId: conexion.connectionId,
        marketplaceId,
        skus,
        simular: body.simular === true,
        userId: session.userId,
      })
      if ('error' in r) return fail(r.status, r.error)
      return NextResponse.json({ ok: true, ...r })
    }

    return fail(400, 'Acción desconocida.')
  } catch (error) {
    return errorResponse(error, 'Error en la sincronización de precios mínimo y máximo')
  }
}
