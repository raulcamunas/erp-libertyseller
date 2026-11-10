import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { puedeEditar, requireFbaAccess } from '@/lib/fba/acceso'
import { FORMATO_FBA } from '@/lib/fba/envios-nuevos'
import { enviosNuevosDeCliente, enviosNuevosDeClientes, importarEnvios } from '@/lib/fba/envios-nuevos-servidor'
import { diaEnEspana } from '@/lib/fba/fechas'
import { olvidarTablero } from '@/lib/fba/tablero-servidor'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * IMPORTAR PEDIDOS: los envíos que Amazon tiene en la cuenta de un cliente y el ERP todavía no.
 *
 *   GET  ?clienteId=…[&refrescar=1]   los envíos nuevos de ese cliente (con caché de 10 minutos; `refrescar` fuerza la pregunta a Amazon)
 *   GET  ?todos=1                     cuántos tiene cada cliente que esta persona puede editar: las insignias del tablero y de la barra de clientes
 *   POST { clienteId, envios: [{ shipmentId, mercadoId }] }   los importa (hasta 8 por llamada; la pantalla los manda por tandas)
 *
 * Solo quien PUEDE EDITAR al cliente: importar escribe, y un cliente de fuera con acceso de lectura no ve ni el aviso.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_POR_LLAMADA = 8

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams
    if (q.get('todos') === '1') {
      const sesion = await requireFbaAccess('editar')
      if (sesion instanceof NextResponse) return sesion
      const service = createServiceClient()
      let ids = sesion.clientesEditables
      if (ids === null) {
        const { data } = await service.from('amazon_clients').select('id')
        ids = ((data ?? []) as Array<{ id: string }>).map((c) => c.id)
      }
      const resultados = await enviosNuevosDeClientes(ids)
      return NextResponse.json({
        ok: true,
        clientes: resultados.map((r) => ({ clienteId: r.clienteId, nuevos: r.nuevos.length, error: r.error, sinConexion: r.sinConexion, comprobadoAt: r.comprobadoAt })),
      })
    }
    const clienteId = (q.get('clienteId') ?? '').trim()
    if (!UUID.test(clienteId)) return fail(400, 'Elige el cliente')
    const sesion = await requireFbaAccess('editar', clienteId)
    if (sesion instanceof NextResponse) return sesion
    const r = await enviosNuevosDeCliente(clienteId, { refrescar: q.get('refrescar') === '1' })
    return NextResponse.json({ ok: true, ...r })
  } catch (error) {
    return errorResponse(error, 'No se han podido consultar los envíos de Amazon')
  }
}

export async function POST(request: NextRequest) {
  try {
    const cuerpo = (await request.json().catch(() => null)) as { clienteId?: string; envios?: Array<{ shipmentId?: string; mercadoId?: string }> } | null
    const clienteId = (cuerpo?.clienteId ?? '').trim()
    if (!UUID.test(clienteId)) return fail(400, 'Elige el cliente')
    const sesion = await requireFbaAccess('editar', clienteId)
    if (sesion instanceof NextResponse) return sesion
    if (!puedeEditar(sesion, clienteId)) return fail(403, 'Tu acceso a esta cuenta es solo de lectura')

    const envios = (cuerpo?.envios ?? [])
      .map((e) => ({ shipmentId: (e.shipmentId ?? '').trim().toUpperCase(), mercadoId: (e.mercadoId ?? '').trim().slice(0, 20) }))
      .filter((e) => FORMATO_FBA.test(e.shipmentId) && e.mercadoId !== '')
    if (envios.length === 0) return fail(400, 'No hay ningún envío que importar')
    if (envios.length > MAX_POR_LLAMADA) return fail(400, `Como mucho ${MAX_POR_LLAMADA} envíos por llamada`)

    const r = await importarEnvios({ clienteId, userId: sesion.userId, envios, hoy: diaEnEspana() })
    if (r.importados.length > 0) olvidarTablero(clienteId)
    return NextResponse.json({ ok: true, ...r })
  } catch (error) {
    return errorResponse(error, 'No se han podido importar los envíos')
  }
}
