import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { puedeEditar, requireFbaAccess } from '@/lib/fba/acceso'
import { cajasDeRemesa } from '@/lib/fba/cajas'
import { eventoDeCambioDeRemesa, invalidarCaches, seguirARemesa } from '@/lib/fba/envios-propuestos-servidor'
import { puedeAvanzar, type EstadoRemesa } from '@/lib/fba/flujo'
import { registrarEnHistorial } from '@/lib/fba/historial'
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
 * Ya NO hay ningún paso con ruta aparte: el envío se crea en Seller Central a
 * mano, así que todos los pasos son una actualización de estado y pasan por aquí.
 *
 * EL ENVÍO PROPUESTO SIGUE A SU REMESA (spec remesas-pro D19). Si la remesa nació de un envío propuesto del
 * planificador: al pasar a «enviada» ese envío queda en «enviado», y al volver de «enviada» a «lista» («se
 * marcó por error») vuelve a «en preparación». La regla es `efectoDeRemesa` (trabajo-plan.ts). Sin la
 * migración 316 no hay envío propuesto y se ignora; un fallo ahí nunca deshace el paso de la remesa.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Los que se pueden mover con una simple actualización */
const DESTINOS_SIMPLES: EstadoRemesa[] = ['borrador', 'aprobada', 'encajando', 'lista', 'enviada', 'cerrada']

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!UUID.test(params.id)) return fail(400, 'Esa remesa no existe')

    const body = (await request.json().catch(() => ({}))) as { hasta?: unknown; desde?: unknown }
    const hasta = typeof body.hasta === 'string' ? (body.hasta as EstadoRemesa) : null
    // El paso desde el que lo ve quien pulsa. Si ya no es el de la base, alguien lo movió entre medias
    const desdeVisto = typeof body.desde === 'string' ? (body.desde as EstadoRemesa) : null
    if (!hasta) return fail(400, 'Falta a qué paso se quiere mover')

    if (!DESTINOS_SIMPLES.includes(hasta)) return fail(400, 'Ese paso no existe')

    const sesion = await requireFbaAccess('editar')
    if (sesion instanceof NextResponse) return sesion

    const service = createServiceClient()
    const { data } = await service
      .from('fba_remesas')
      // Sin `version`: la 215 se lanza a mano y el código llega antes. Pedirla
      // aquí dejaría la remesa sin poder moverse de paso por un contador que
      // todavía no existe. Se lee aparte, solo al reabrir, que es cuando hace
      // falta.
      .select('id, client_id, estado, referencia_envio')
      .eq('id', params.id)
      .maybeSingle()
    if (!data) return fail(404, 'Esa remesa ya no existe')

    const remesa = data as {
      id: string
      client_id: string
      estado: EstadoRemesa
      referencia_envio: string | null
    }
    if (!puedeEditar(sesion, remesa.client_id)) return fail(404, 'Esa remesa ya no existe')

    // BLOQUEO OPTIMISTA: quien pulsa vio la remesa en un paso; si ya está en otro, no se aplica nada
    if (desdeVisto && desdeVisto !== remesa.estado) {
      return NextResponse.json({ error: 'Alguien ha cambiado esta remesa mientras la mirabas (ahora está en otro paso). Recarga para ver lo último.', conflicto: true }, { status: 409 })
    }

    // Agencia = admin o empleado; cliente = el resto (lib/fba/acceso.ts). Antes un empleado contaba como cliente
    const actor = sesion.actor

    /**
     * CAJAS EN AMAZON (envío por API, migración 310): con las cajas ya mandadas a Amazon no se vuelve a
     * «Encajando» por aquí; se hace con «Reabrir cajas» del propio envío, que obliga a regenerar el reparto.
     * Sin la 310 la columna no existe y no hay nada que bloquear.
     */
    if (remesa.estado === 'lista' && hasta === 'encajando') {
      const { data: b, error: errB } = await service.from('fba_remesas').select('envio_cajas_bloqueadas_at').eq('id', params.id).maybeSingle()
      if (!errB && (b as { envio_cajas_bloqueadas_at?: string | null } | null)?.envio_cajas_bloqueadas_at) {
        return fail(409, 'Las cajas de esta remesa ya están en Amazon. Para cambiarlas usa «Reabrir cajas» en «Enviar a Amazon» (o cancela el plan).')
      }
    }

    // Las líneas a 0 son las que el cliente ha dicho «esta no» desde su enlace: no cuentan como referencia
    const { count: lineas } = await service
      .from('fba_remesa_lineas')
      .select('id', { count: 'exact', head: true })
      .eq('remesa_id', params.id)
      .gt('unidades', 0)

    // El cuadre solo se calcula si el paso lo exige: leer las cajas de una
    // remesa para aprobarla es trabajo que no cambia la respuesta.
    const necesitaCajas = ['lista', 'enviada'].includes(hasta)
    const datosCajas = necesitaCajas ? await cajasDeRemesa(params.id) : null

    const permiso = puedeAvanzar(remesa.estado, hasta, actor, {
      lineas: lineas ?? 0,
      cuadre: datosCajas?.cuadre,
      cajas: datosCajas?.estado,
      // Se lee de la base en este instante: la pantalla acaba de guardarlo justo
      // antes de pedir el paso, y una copia vieja diría que falta
      referencia: remesa.referencia_envio,
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
    //
    // Y SUBE LA VERSIÓN DEL BOCETO, que es lo que convierte «reabrir» en algo
    // que deja rastro. Las etiquetas que ya se hayan impreso están guardadas en
    // fba_impresiones con la versión que tenían, así que a partir de aquí la
    // pantalla puede decir que esas pegatinas son de una versión anterior.
    //
    // Sube SOLO al venir de un estado ya cerrado. Mientras el boceto está
    // abierto no hay nada impreso que invalidar, y un contador que sube cada vez
    // que alguien toca una cantidad no distingue nada.
    if (hasta === 'borrador') {
      cambios.aprobada_por = null
      cambios.aprobada_at = null
      if (remesa.estado !== 'borrador') {
        const { data: v, error: errVersion } = await service
          .from('fba_remesas')
          .select('version')
          .eq('id', params.id)
          .maybeSingle()
        // Si la 215 no está lanzada, esto da 42703 y lo único que se pierde es el
        // contador. Volver a borrador tiene que funcionar igual: es un paso del
        // trabajo diario, no una comodidad.
        if (!errVersion) {
          cambios.version = ((v as { version?: number } | null)?.version ?? 1) + 1
          cambios.reabierta_at = new Date().toISOString()
          cambios.reabierta_por = sesion.userId
        }
      }
    }

    /**
     * AL APROBAR UNA PROPUESTA SE QUITAN LAS LÍNEAS A 0.
     *
     * Son las que el cliente marcó como «esta no» desde su enlace (migración 309). Se guardaban para que la
     * agencia viera qué se proponía; aprobada, ya no van en el envío y no deben llegar a etiquetas, cajas ni
     * Excel. Antes de borrarlas se apunta en el historial qué se aprobó frente a lo propuesto.
     */
    let resumenAprobacion: Record<string, unknown> | undefined
    if (remesa.estado === 'borrador' && hasta === 'aprobada') {
      const { data: filas } = await service.from('fba_remesa_lineas').select('*').eq('remesa_id', params.id)
      const ls = (filas ?? []) as Array<{ sku: string; unidades: number; unidades_propuestas?: number | null; anadida_por_cliente?: boolean }>
      resumenAprobacion = {
        referencias: ls.filter((l) => l.unidades > 0).length,
        unidades: ls.reduce((s, l) => s + l.unidades, 0),
        quitadas: ls.filter((l) => l.unidades === 0).map((l) => l.sku).slice(0, 50),
        nuevas: ls.filter((l) => l.anadida_por_cliente).map((l) => l.sku).slice(0, 50),
        cambiadas: ls.filter((l) => l.unidades_propuestas != null && l.unidades_propuestas !== l.unidades && l.unidades > 0).length,
      }
    }

    // El cambio SOLO se aplica si la remesa SIGUE en el paso leído: dos personas que pulsan a la vez ya no
    // aplican dos transiciones calculadas sobre el mismo punto de partida
    const { data: movida, error } = await service
      .from('fba_remesas')
      .update(cambios)
      .eq('id', params.id)
      .eq('estado', remesa.estado)
      .select('id')
    if (error) throw error
    if (((movida as unknown[] | null) ?? []).length === 0) {
      return NextResponse.json({ error: 'Alguien acaba de mover esta remesa de paso. Recarga para ver lo último.', conflicto: true }, { status: 409 })
    }

    if (resumenAprobacion) {
      const { error: errCeros } = await service.from('fba_remesa_lineas').delete().eq('remesa_id', params.id).eq('unidades', 0)
      if (errCeros) console.error('[fba] no se han podido quitar las líneas a 0 al aprobar:', errCeros.message)
    }
    // Volver a borrador deshace también el «Acepto» del cliente: lo que aceptó ya no es lo que hay. Aparte y
    // sin romper: sin la 309 estas columnas no existen
    if (hasta === 'borrador' && remesa.estado !== 'borrador') {
      await service
        .from('fba_remesas')
        .update({ cliente_acepto_at: null, cliente_acepto_nombre: null, cliente_acepto_ip: null })
        .eq('id', params.id)
        .then(() => undefined, () => undefined)
    }

    await registrarEnHistorial({
      remesaId: params.id,
      actor,
      userId: sesion.userId,
      accion: 'estado',
      desde: remesa.estado,
      hasta,
      detalle: resumenAprobacion ?? (typeof cambios.version === 'number' ? { version: cambios.version } : {}),
    })

    // El envío propuesto enlazado sigue a la remesa (D19). seguirARemesa no lanza nunca
    const evento = eventoDeCambioDeRemesa(remesa.estado, hasta)
    const envioPropuesto = evento ? await seguirARemesa(service, params.id, evento, sesion.userId) : null
    // Lo que sale, vuelve o se cierra cambia el resumen y las ventas por lote: fuera las cachés en memoria (D32)
    invalidarCaches(remesa.client_id)

    return NextResponse.json({ ok: true, estado: hasta, envioPropuesto })
  } catch (error) {
    return errorResponse(error, 'No se ha podido mover la remesa')
  }
}
