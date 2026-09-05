import { type NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { exigirAdmin } from '@/lib/facturacion/acceso'
import { cargarEmisor } from '@/lib/facturacion/tablero'
import { construirFacturaPdf, nombreDelFichero } from '@/lib/facturacion/pdf'
import type { InvoiceWithItems } from '@/lib/types/invoices'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** El PDF de una factura, para mirarlo antes de mandarlo o para guardarlo */
export async function GET(request: NextRequest) {
  const permiso = await exigirAdmin()
  if (!permiso.ok) {
    return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })
  }

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Falta la factura' }, { status: 400 })

  const service = createServiceClient()
  const { data: factura, error } = await service
    .from('invoices')
    .select('*, items:invoice_items(*)')
    .eq('id', id)
    .single()

  if (error || !factura) {
    return NextResponse.json({ error: 'Esa factura no existe' }, { status: 404 })
  }

  const conLineas = {
    ...factura,
    items: [...(factura.items ?? [])].sort(
      (a: { sort_order: number }, b: { sort_order: number }) => a.sort_order - b.sort_order
    ),
  } as InvoiceWithItems

  let clienteNif: string | null = null
  let clienteDireccion: string | null = null
  if (factura.treasury_client_id) {
    const { data: cli } = await service
      .from('treasury_clients')
      .select('tax_id, tax_address')
      .eq('id', factura.treasury_client_id)
      .maybeSingle()
    clienteNif = (cli?.tax_id as string) ?? null
    clienteDireccion = (cli?.tax_address as string) ?? null
  }

  const emisor = await cargarEmisor()
  const pdf = construirFacturaPdf(conLineas, emisor, {
    reportUrl: factura.report_url,
    clienteNif,
    clienteDireccion,
  })

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      // `inline` y no `attachment`: casi siempre se abre para mirarla antes de
      // mandarla, y forzar la descarga llena Descargas de facturas que no se
      // van a usar. El navegador sigue dejando guardarla desde el visor.
      'Content-Disposition': `inline; filename="${nombreDelFichero(conLineas)}"`,
      'Cache-Control': 'no-store',
    },
  })
}
