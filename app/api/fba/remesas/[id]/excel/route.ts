import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { requireFbaAccess } from '@/lib/fba/acceso'
import { esClienteConCatalogo } from '@/lib/fba/catalogo/tipos'
import { diaEnEspana } from '@/lib/fba/fechas'
import { excelDePropuesta } from '@/lib/fba/propuesta-excel'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * EL EXCEL DE UNA PROPUESTA, PARA MANDÁRSELO AL CLIENTE.
 *
 * Qué producto, qué SKU y cuántas unidades se van a enviar, con la marca de Liberty Seller
 * (lib/fba/propuesta-excel.ts). Es un documento para leer: sin fórmulas ni ritmos de venta.
 *
 * NO SE GUARDA EN NINGÚN SITIO. Se arma al pedirlo, con las líneas que tiene la propuesta
 * AHORA: si se cambia una cantidad y se vuelve a descargar, sale con la nueva. Es GET y no
 * POST porque no recibe nada: la propuesta ya está en la base.
 *
 * Sirve en cualquier fase —borrador, aprobada, encajando o lista— y también para un envío ya
 * hecho: lo que no cambia es que sea una lista de qué va y cuánto. Quien puede ver la remesa
 * puede bajarse el Excel; el mismo filtro por cliente que el resto de /api/fba.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!UUID.test(params.id)) return fail(400, 'Esa propuesta no existe')

    const sesion = await requireFbaAccess('ver')
    if (sesion instanceof NextResponse) return sesion

    const service = createServiceClient()
    const { data: cabecera } = await service
      .from('fba_remesas')
      .select('id, nombre, client_id, fecha_envio, nota')
      .eq('id', params.id)
      .maybeSingle()
    if (!cabecera) return fail(404, 'Esa propuesta ya no existe')

    const remesa = cabecera as { id: string; nombre: string | null; client_id: string; fecha_envio: string; nota: string | null }
    // El mismo mensaje que si no existiera: no se confirma que exista a quien no la puede ver
    if (sesion.clientesPermitidos && !sesion.clientesPermitidos.includes(remesa.client_id)) {
      return fail(404, 'Esa propuesta ya no existe')
    }

    const [{ data: cliente }, { data: lineas }] = await Promise.all([
      service.from('amazon_clients').select('name').eq('id', remesa.client_id).maybeSingle(),
      service
        .from('fba_remesa_lineas')
        .select('sku, unidades, referencia, nombre, variante')
        .eq('remesa_id', params.id),
    ])

    const filas = (lineas ?? []) as Array<{
      sku: string
      unidades: number
      referencia: string | null
      nombre: string | null
      variante: string | null
    }>
    if (filas.length === 0) return fail(400, 'Esta propuesta todavía no tiene ninguna referencia: no hay nada que enseñar')

    const nombreCliente = (cliente as { name: string } | null)?.name ?? 'Cliente'
    const r = excelDePropuesta({
      cliente: nombreCliente,
      nombre: remesa.nombre,
      fechaEnvio: remesa.fecha_envio,
      nota: remesa.nota,
      hoy: diaEnEspana(),
      lineas: filas,
      rotuloVariante: esClienteConCatalogo(nombreCliente) ? 'Talla' : 'Variante',
    })

    return new NextResponse(Buffer.from(r.xlsx), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        // El nombre ya viene en ASCII desde excelDePropuesta: una cabecera HTTP solo
        // admite bytes 0-255 y un nombre con letras de otro alfabeto la hacía reventar
        'Content-Disposition': `attachment; filename="${r.nombreFichero}"`,
        'Cache-Control': 'no-store',
        // Para que la pantalla pueda avisar sin abrir el fichero
        'X-Lineas': String(r.lineas),
        'X-Unidades': String(r.unidades),
      },
    })
  } catch (error) {
    return errorResponse(error, 'No se ha podido generar el Excel')
  }
}
