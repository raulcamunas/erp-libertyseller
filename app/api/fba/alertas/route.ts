import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { puedeEditar, requireFbaAccess, type SesionFba } from '@/lib/fba/acceso'
import { FALTA_LA_MIGRACION_267, pasadaDeCliente } from '@/lib/fba/alertas-datos'
import { clientesConAlertas, leerPanelDeAlertas } from '@/lib/fba/alertas-lectura'
import { diaEnEspana } from '@/lib/fba/fechas'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LAS ALERTAS DE LOGÍSTICA FBA: LEERLAS, RECALCULARLAS Y SILENCIARLAS.
 *
 *   GET   el panel entero: los clientes que esta sesión ve, su configuración y sus alertas abiertas o silenciadas.
 *   POST  { accion: 'recalcular', clienteId }        calcula ahora las alertas de ese cliente (lo mismo que hace la pasada diaria)
 *         { accion: 'silenciar', id, hasta }          esconde una alerta hasta esa fecha ('YYYY-MM-DD')
 *         { accion: 'reabrir', id }                   vuelve a abrir una silenciada
 *
 * Las alertas son de la AGENCIA: un cliente de fuera, aunque tenga acceso a Remesas, no las ve. Y cada petición pasa por el guardián de
 * lib/fba/acceso.ts, que acota por cliente.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const FECHA = /^\d{4}-\d{2}-\d{2}$/

const soloAgencia = (sesion: SesionFba): NextResponse | null => (sesion.role === 'cliente' ? fail(403, 'Las alertas de logística son de la agencia') : null)

export async function GET() {
  try {
    const sesion = await requireFbaAccess('ver')
    if (sesion instanceof NextResponse) return sesion
    const denegado = soloAgencia(sesion)
    if (denegado) return denegado
    return NextResponse.json(await leerPanelDeAlertas(sesion, diaEnEspana()))
  } catch (error) {
    return errorResponse(error, 'No se han podido leer las alertas')
  }
}

export async function POST(request: NextRequest) {
  try {
    const cuerpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!cuerpo || typeof cuerpo.accion !== 'string') return fail(400, 'Falta qué hacer')
    const hoy = diaEnEspana()
    const service = createServiceClient()

    if (cuerpo.accion === 'recalcular') {
      const clienteId = typeof cuerpo.clienteId === 'string' ? cuerpo.clienteId : ''
      if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')
      const sesion = await requireFbaAccess('editar', clienteId)
      if (sesion instanceof NextResponse) return sesion
      const denegado = soloAgencia(sesion)
      if (denegado) return denegado
      const cliente = (await clientesConAlertas(service, sesion)).find((c) => c.id === clienteId)
      if (!cliente) return fail(404, 'Ese cliente no tiene Amazon conectado')
      const resumen = await pasadaDeCliente(service, cliente, hoy)
      if (resumen.faltaMigracion) return fail(409, FALTA_LA_MIGRACION_267)
      return NextResponse.json({ ok: true, resumen })
    }

    if (cuerpo.accion === 'silenciar' || cuerpo.accion === 'reabrir') {
      const id = typeof cuerpo.id === 'string' ? cuerpo.id : ''
      if (!UUID.test(id)) return fail(400, 'Falta la alerta')
      const sesion = await requireFbaAccess('editar')
      if (sesion instanceof NextResponse) return sesion
      const denegado = soloAgencia(sesion)
      if (denegado) return denegado
      const { data: alerta, error } = await service.from('fba_alertas').select('id, client_id').eq('id', id).maybeSingle()
      if (error) throw error
      // El mismo mensaje que si no existiera: no se confirma que exista
      if (!alerta || !puedeEditar(sesion, (alerta as { client_id: string }).client_id)) return fail(404, 'Esa alerta no existe')

      if (cuerpo.accion === 'reabrir') {
        const { error: e } = await service.from('fba_alertas').update({ estado: 'abierta', silenciada_hasta: null }).eq('id', id)
        if (e) throw e
        return NextResponse.json({ ok: true })
      }
      const hasta = typeof cuerpo.hasta === 'string' ? cuerpo.hasta : ''
      const limite = new Date(`${hoy}T12:00:00Z`)
      limite.setUTCDate(limite.getUTCDate() + 365)
      if (!FECHA.test(hasta) || hasta < hoy || hasta > limite.toISOString().slice(0, 10)) return fail(400, 'Esa fecha no vale: tiene que ser entre hoy y dentro de un año')
      const { error: e } = await service.from('fba_alertas').update({ estado: 'silenciada', silenciada_hasta: hasta }).eq('id', id)
      if (e) throw e
      return NextResponse.json({ ok: true })
    }

    return fail(400, 'Esa acción no existe')
  } catch (error) {
    return errorResponse(error, 'No se ha podido hacer')
  }
}
