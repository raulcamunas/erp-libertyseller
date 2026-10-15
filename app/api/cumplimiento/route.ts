import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { filtrosValidos, paginaDeCliente, resumenDeCliente } from '@/lib/cumplimiento/consulta'
import { conexionesDeCliente } from '@/lib/cumplimiento/conexiones'
import {
  hayRevisionEnCurso,
  lanzarRevisionManual,
  revisarUnSku,
  ultimoResultadoManual,
} from '@/lib/cumplimiento/revisar'
import { clientesGrowth } from '@/lib/growth/clientes'

/**
 * CUMPLIMIENTO DE LISTINGS · LO QUE USA LA PANTALLA.
 *
 *   resumen   las cifras de arriba (y si hay una revisión en marcha).
 *   filas     una página de la lista, con los filtros elegidos.
 *   ahora     lanza una revisión del cliente y CONTESTA EN SEGUIDA.
 *   sku       vuelve a mirar UN listing, tras arreglarlo en Seller Central.
 *
 * EL CLIENTE LLEGA COMO SLUG Y SE TRADUCE AQUÍ. Nunca llega una conexión ni un
 * identificador de cuenta: las consultas salen de las conexiones de ese cliente, así
 * que no se puede pedir lo de otro por mucho SKU que se conozca.
 *
 * Solo admin, como todo lo de Amazon API y Growth Partner.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

async function clienteDe(slug: unknown) {
  if (typeof slug !== 'string' || !slug) return null
  const c = (await clientesGrowth()).find((x) => x.slug === slug)
  return c && c.amazonClientId ? { ...c, amazonClientId: c.amazonClientId } : null
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as {
      accion?: string
      cliente?: string
      filtros?: unknown
      pagina?: number
      mercado?: string
      sku?: string
    }

    const cliente = await clienteDe(body.cliente)
    if (!cliente) return fail(404, 'Ese cliente no existe o no tiene una cuenta de Amazon conectada.')

    if (body.accion === 'resumen') {
      const conexiones = await conexionesDeCliente(cliente.amazonClientId)
      const ultimo = ultimoResultadoManual(cliente.amazonClientId)
      return NextResponse.json({
        ok: true,
        resumen: await resumenDeCliente(cliente.amazonClientId, filtrosValidos({ mercado: body.mercado }).mercado),
        enCurso: hayRevisionEnCurso(conexiones.map((c) => c.id)),
        ultimo,
      })
    }

    if (body.accion === 'filas') {
      const pagina = await paginaDeCliente(
        cliente.amazonClientId,
        filtrosValidos(body.filtros),
        Number.isFinite(body.pagina) ? Number(body.pagina) : 0
      )
      if ('error' in pagina) return fail(500, pagina.error)
      return NextResponse.json({ ok: true, ...pagina })
    }

    if (body.accion === 'ahora') {
      const r = await lanzarRevisionManual(cliente.amazonClientId)
      return NextResponse.json({ ok: true, ...r })
    }

    if (body.accion === 'sku') {
      const mercado = typeof body.mercado === 'string' ? body.mercado : ''
      const sku = typeof body.sku === 'string' ? body.sku.trim() : ''
      if (!/^[A-Z0-9]{8,16}$/.test(mercado) || !sku || sku.length > 200) return fail(400, 'Listing no válido.')
      const r = await revisarUnSku(cliente.amazonClientId, mercado, sku)
      if (!r.ok) return fail(409, r.error)
      return NextResponse.json({ ok: true, encontrado: r.encontrado })
    }

    return fail(400, 'Acción desconocida.')
  } catch (error) {
    return errorResponse(error, 'Error en el cumplimiento de listings')
  }
}
