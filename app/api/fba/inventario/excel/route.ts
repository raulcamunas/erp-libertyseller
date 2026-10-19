import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { requireFbaAccess } from '@/lib/fba/acceso'
import { excelDeAntiguedad } from '@/lib/fba/antiguedad-excel'
import { diaEnEspana } from '@/lib/fba/fechas'
import { inventarioDeCliente } from '@/lib/fba/inventario-datos'
import type { IdTramoInforme } from '@/lib/fba/antiguedad'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * EL EXCEL DE LA ANTIGÜEDAD DEL STOCK DE UN CLIENTE, CON LA MARCA.
 *
 * Lo que enseña la tarjeta «Cuánto lleva el stock en Amazon» del panel del cliente, en un
 * documento para leer, enviar o filtrar (lib/fba/antiguedad-excel.ts): los tramos y, producto a
 * producto, qué hay en cada uno. Con `?tramo=` se pide solo uno —el que se ha pulsado en la
 * tarjeta—.
 *
 * NO SE GUARDA EN NINGÚN SITIO Y SE ARMA DE NUEVO CADA VEZ, a partir de la base, no de lo que
 * tenga el navegador: el fichero siempre coincide con lo que dice el panel en ese momento. Es GET
 * porque no recibe nada: todo está en la base. El mismo filtro por cliente que el resto de
 * /api/fba: quien no pueda ver a ese cliente recibe lo mismo que si no existiera.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  try {
    const clienteId = request.nextUrl.searchParams.get('cliente') ?? ''
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')

    const sesion = await requireFbaAccess('ver', clienteId)
    if (sesion instanceof NextResponse) return sesion

    // Un id de tramo es corto y sin signos («a91», «t181», «anterior»). Lo que no lo parezca no se usa;
    // y uno que parezca bueno pero no exista da el documento entero (lo resuelve el propio Excel)
    const pedido = request.nextUrl.searchParams.get('tramo')
    const tramo = pedido && /^[a-z0-9]{1,12}$/.test(pedido) ? (pedido as IdTramoInforme) : null

    const { data: cliente } = await createServiceClient().from('amazon_clients').select('name').eq('id', clienteId).maybeSingle()
    if (!cliente) return fail(404, 'Ese cliente no existe')

    const hoy = diaEnEspana()
    const inventario = await inventarioDeCliente(clienteId, { hoy })
    if (!inventario.conectado) return fail(409, 'Este cliente no tiene la cuenta de Amazon conectada: no hay stock que enseñar')

    const r = excelDeAntiguedad({ cliente: (cliente as { name: string }).name, inventario, tramo, hoy })
    return new NextResponse(Buffer.from(r.xlsx), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        // El nombre ya viene en ASCII desde excelDeAntiguedad: una cabecera HTTP solo admite bytes 0-255
        'Content-Disposition': `attachment; filename="${r.nombreFichero}"`,
        'Cache-Control': 'no-store',
        // Para que la pantalla pueda avisar sin abrir el fichero
        'X-Filas': String(r.filas),
        'X-Unidades': String(r.unidades),
      },
    })
  } catch (error) {
    return errorResponse(error, 'No se ha podido generar el Excel de antigüedad')
  }
}
