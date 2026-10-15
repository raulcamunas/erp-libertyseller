import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { MAX_FILAS_EXPORTAR, filtrosValidos, todasLasFilas } from '@/lib/cumplimiento/consulta'
import { aCsv } from '@/lib/cumplimiento/exportar'
import { clientesGrowth } from '@/lib/growth/clientes'
import { marketplaceLabel } from '@/lib/types/amazon'

/**
 * CUMPLIMIENTO · EL CSV DE LO QUE SE ESTÁ VIENDO.
 *
 * GET con el cliente (slug) y los mismos filtros que la pantalla, para que el
 * fichero sea exactamente la lista filtrada. Una fila por incidencia.
 *
 * Es de UN cliente, y su nombre va en el nombre del fichero: este CSV acaba en un
 * correo al propio cliente, y el que lo recibe tiene que poder saber de quién es.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const p = request.nextUrl.searchParams
    const slug = p.get('cliente') ?? ''
    const cliente = (await clientesGrowth()).find((c) => c.slug === slug)
    if (!cliente || !cliente.amazonClientId) {
      return fail(404, 'Ese cliente no existe o no tiene una cuenta de Amazon conectada.')
    }

    const filtros = filtrosValidos({
      mercado: p.get('mercado') ?? 'todos',
      gravedad: p.get('gravedad') ?? 'atencion',
      tema: p.get('tema') ?? 'todos',
      soloStock: p.get('stock') === '1',
      busca: p.get('q') ?? '',
    })

    const r = await todasLasFilas(cliente.amazonClientId, filtros)
    if ('error' in r) return fail(500, r.error)

    const csv = '﻿' + aCsv(r.filas, marketplaceLabel)
    const fecha = new Date().toISOString().slice(0, 10)
    // El slug ya es [a-z0-9-]: es seguro en una cabecera
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="cumplimiento-${cliente.slug}-${fecha}.csv"`,
        'X-Filas': String(r.filas.length),
        'X-Truncado': r.truncado ? String(MAX_FILAS_EXPORTAR) : '0',
      },
    })
  } catch (error) {
    return errorResponse(error, 'No se ha podido generar el CSV')
  }
}
