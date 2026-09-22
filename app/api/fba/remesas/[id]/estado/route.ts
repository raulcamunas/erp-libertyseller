import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { puedeEditar, requireFbaAccess } from '@/lib/fba/acceso'
import { cajasDeRemesa } from '@/lib/fba/cajas'
import { puedeAvanzar, type EstadoRemesa } from '@/lib/fba/flujo'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * MOVER UNA REMESA DE UN PASO AL SIGUIENTE.
 *
 * La decisión de si se puede está ENTERA en lib/fba/flujo.ts, que es una
 * función pura y con pruebas. Aquí solo se juntan los datos que necesita —el
 * cuadre de las cajas, cuántas líneas tiene— y se guarda el resultado.
 *
 *
 * ============ SE VUELVE A COMPROBAR AQUÍ, NO SOLO EN PANTALLA ============
 *
 * La pantalla ya esconde los botones que no tocan, pero eso es comodidad, no
 * seguridad: un cliente puede llamar a esta ruta a mano. Así que el mismo
 * flujo.ts decide otra vez, con los datos leídos de la base en este instante y
 * no con los que la pantalla tuviera cargados hace diez minutos.
 *
 * `en_amazon` NO se alcanza por aquí: ese paso crea cosas en la cuenta del
 * cliente y tiene su propia ruta, con su propia confirmación.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Los que se pueden mover con una simple actualización */
const DESTINOS_SIMPLES: EstadoRemesa[] = ['borrador', 'aprobada', 'encajando', 'lista', 'enviada', 'cerrada']

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!UUID.test(params.id)) return fail(400, 'Esa remesa no existe')

    const body = (await request.json().catch(() => ({}))) as { hasta?: unknown }
    const hasta = typeof body.hasta === 'string' ? (body.hasta as EstadoRemesa) : null
    if (!hasta) return fail(400, 'Falta a qué paso se quiere mover')

    if (hasta === 'en_amazon') {
      return fail(
        400,
        'Crear el envío en Amazon se hace desde su propia acción, no desde aquí: es el único paso ' +
          'que no se deshace y necesita su confirmación'
      )
    }
    if (!DESTINOS_SIMPLES.includes(hasta)) return fail(400, 'Ese paso no existe')

    const sesion = await requireFbaAccess('editar')
    if (sesion instanceof NextResponse) return sesion

    const service = createServiceClient()
    const { data } = await service
      .from('fba_remesas')
      .select('id, client_id, estado')
      .eq('id', params.id)
      .maybeSingle()
    if (!data) return fail(404, 'Esa remesa ya no existe')

    const remesa = data as { id: string; client_id: string; estado: EstadoRemesa }
    if (!puedeEditar(sesion, remesa.client_id)) return fail(404, 'Esa remesa ya no existe')

    const actor = sesion.esAdmin ? 'agencia' : 'cliente'

    const { count: lineas } = await service
      .from('fba_remesa_lineas')
      .select('id', { count: 'exact', head: true })
      .eq('remesa_id', params.id)

    // El cuadre solo se calcula si el paso lo exige: leer las cajas de una
    // remesa para aprobarla es trabajo que no cambia la respuesta.
    const necesitaCajas = ['lista', 'en_amazon'].includes(hasta)
    const datosCajas = necesitaCajas ? await cajasDeRemesa(params.id) : null

    const permiso = puedeAvanzar(remesa.estado, hasta, actor, {
      lineas: lineas ?? 0,
      cuadre: datosCajas?.cuadre,
      cajas: datosCajas?.estado,
    })

    if (!permiso.puede) {
      return NextResponse.json(
        {
          error: permiso.motivos.map((m) => m.texto).join('. '),
          motivos: permiso.motivos.map((m) => m.texto),
        },
        { status: 409 }
      )
    }

    const cambios: Record<string, unknown> = { estado: hasta, updated_at: new Date().toISOString() }
    // Se sella QUIÉN aprobó y cuándo: es lo que se enseña cuando alguien
    // pregunta meses después por qué se mandó esto.
    if (hasta === 'aprobada') {
      cambios.aprobada_por = sesion.userId
      cambios.aprobada_at = new Date().toISOString()
    }
    if (hasta === 'encajando') cambios.encajado_at = new Date().toISOString()
    if (hasta === 'lista') cambios.lista_at = new Date().toISOString()
    // Volver a borrador borra la aprobación: si no, quedaría dicho que el
    // cliente aprobó algo que luego se cambió.
    if (hasta === 'borrador') {
      cambios.aprobada_por = null
      cambios.aprobada_at = null
    }

    const { error } = await service.from('fba_remesas').update(cambios).eq('id', params.id)
    if (error) throw error

    return NextResponse.json({ ok: true, estado: hasta })
  } catch (error) {
    return errorResponse(error, 'No se ha podido mover la remesa')
  }
}
