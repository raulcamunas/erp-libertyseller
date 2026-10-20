import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { requireFbaAccess } from '@/lib/fba/acceso'
import { panelDeCliente } from '@/lib/fba/datos'
import { diaEnEspana } from '@/lib/fba/fechas'
import type { EstadoRemesa } from '@/lib/fba/flujo'
import { informeDePedido } from '@/lib/fba/informe-pedido'
import { pdfDeInforme } from '@/lib/fba/informe-pedido-pdf'
import { esEnvio } from '@/lib/fba/vista'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * EL INFORME DE UN PEDIDO EN PDF: CÓMO ESTÁ A DÍA DE HOY.
 *
 * Lo que se le manda al cliente para decirle cómo va su envío: cuántas unidades se mandaron, cuántas
 * ha recibido Amazon, cuántas se han vendido y a qué ritmo, y cuántas quedan en el almacén y para
 * cuántos días (lib/fba/informe-pedido.ts), con la marca de Liberty Seller (lib/fba/informe-pedido-pdf.ts).
 *
 * NO SE GUARDA EN NINGÚN SITIO. Se arma al pedirlo con lo que dice el panel EN ESE MOMENTO —las
 * mismas cifras que las pestañas del envío—, así que si mañana se vende más basta con volver a
 * descargarlo. Es GET porque no recibe nada: todo está en la base.
 *
 * SOLO PARA ENVÍOS, NO PARA PROPUESTAS. Una propuesta todavía no ha salido: no hay nada que haya
 * llegado ni que se haya vendido. Para esa está el Excel de la propuesta (./excel).
 *
 * Quien puede ver la remesa puede bajarse el informe; el mismo filtro por cliente que el resto de
 * /api/fba. El informe es de UN pedido y de UN cliente: no mezcla nada de otros.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!UUID.test(params.id)) return fail(400, 'Ese pedido no existe')

    const sesion = await requireFbaAccess('ver')
    if (sesion instanceof NextResponse) return sesion

    const service = createServiceClient()
    const { data: cabecera } = await service.from('fba_remesas').select('id, client_id, estado').eq('id', params.id).maybeSingle()
    if (!cabecera) return fail(404, 'Ese pedido ya no existe')

    const fila = cabecera as { id: string; client_id: string; estado: string | null }
    // El mismo mensaje que si no existiera: no se confirma que exista a quien no lo puede ver
    if (sesion.clientesPermitidos && !sesion.clientesPermitidos.includes(fila.client_id)) {
      return fail(404, 'Ese pedido ya no existe')
    }
    // Las remesas de antes de la 195 no tienen estado: son historia y cuentan como envíos cerrados
    if (!esEnvio({ estado: (fila.estado ?? 'cerrada') as EstadoRemesa })) {
      return fail(400, 'Este pedido todavía no se ha enviado: el informe cuenta cómo van las unidades que ya están en Amazon. Para una propuesta está el Excel')
    }

    const hoy = diaEnEspana()
    const [{ data: cliente }, panel] = await Promise.all([
      service.from('amazon_clients').select('name').eq('id', fila.client_id).maybeSingle(),
      panelDeCliente(fila.client_id, { hoy }),
    ])
    if (!panel.conectado) return fail(409, 'Este cliente no tiene la cuenta de Amazon conectada: sin ella no hay ventas que contar')
    if (panel.leidoHasta === null) {
      return fail(409, 'Todavía no se ha leído el libro mayor de Amazon de este cliente: sin las ventas no se puede decir cómo va el pedido. Se lee solo una vez al día')
    }

    const remesa = panel.remesas.find((r) => r.id === fila.id)
    if (!remesa) return fail(404, 'Ese pedido ya no existe')

    const informe = informeDePedido({
      cliente: (cliente as { name: string } | null)?.name ?? 'Cliente',
      remesa,
      skus: panel.skus,
      hoy,
      ventasHasta: panel.leidoHasta,
    })
    const r = pdfDeInforme(informe)

    return new NextResponse(Buffer.from(r.pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        // El nombre ya viene en ASCII desde pdfDeInforme: una cabecera HTTP solo admite bytes 0-255
        'Content-Disposition': `attachment; filename="${r.nombreFichero}"`,
        'Cache-Control': 'no-store',
        // Para que la pantalla pueda avisar sin abrir el fichero
        'X-Paginas': String(r.paginas),
        'X-Referencias': String(informe.productos.length),
      },
    })
  } catch (error) {
    return errorResponse(error, 'No se ha podido generar el informe del pedido')
  }
}
