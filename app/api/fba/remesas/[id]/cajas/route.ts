import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { puedeEditar, requireFbaAccess } from '@/lib/fba/acceso'
import { ConflictoDeVersion, EstadoCambiado, cajasDeRemesa, guardarCajas } from '@/lib/fba/cajas'
import { registrarEnHistorial } from '@/lib/fba/historial'
import { limpiarCajas } from '@/lib/fba/cajas-validacion'
import { puedeEditarCajas, type EstadoRemesa } from '@/lib/fba/flujo'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LAS CAJAS DE UNA REMESA: LEERLAS Y GUARDARLAS.
 *
 * Las rellena el CLIENTE, que es quien tiene la báscula y el metro, así que
 * esta ruta acepta a quien tenga la cuenta con permiso de edición. Lo que no
 * acepta es tocarlas fuera del paso de encajar: una vez el envío está en Amazon
 * las medidas ya se han mandado, y cambiarlas aquí solo serviría para que la
 * pantalla mienta respecto a lo que Amazon tiene.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function remesaYAcceso(id: string, nivel: 'ver' | 'editar') {
  if (!UUID.test(id)) return { error: fail(400, 'Esa remesa no existe') as NextResponse }

  const sesion = await requireFbaAccess(nivel)
  if (sesion instanceof NextResponse) return { error: sesion }

  const service = createServiceClient()
  const { data } = await service
    .from('fba_remesas')
    .select('id, client_id, estado')
    .eq('id', id)
    .maybeSingle()
  if (!data) return { error: fail(404, 'Esa remesa ya no existe') as NextResponse }

  const remesa = data as { id: string; client_id: string; estado: EstadoRemesa }
  // El mismo 404 que si no existiera: a quien no tiene acceso no se le confirma
  // ni que exista.
  if (nivel === 'editar' && !puedeEditar(sesion, remesa.client_id)) {
    return { error: fail(404, 'Esa remesa ya no existe') as NextResponse }
  }
  if (nivel === 'ver' && sesion.clientesPermitidos && !sesion.clientesPermitidos.includes(remesa.client_id)) {
    return { error: fail(404, 'Esa remesa ya no existe') as NextResponse }
  }

  return { remesa, sesion }
}

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const r = await remesaYAcceso(params.id, 'ver')
    if (r.error) return r.error
    return NextResponse.json(await cajasDeRemesa(params.id))
  } catch (error) {
    return errorResponse(error, 'No se han podido leer las cajas')
  }
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const r = await remesaYAcceso(params.id, 'editar')
    if (r.error) return r.error

    if (!puedeEditarCajas(r.remesa!.estado)) {
      return fail(
        409,
        'Las cajas solo se pueden tocar mientras se está encajando. Si hay que corregirlas, ' +
          'primero vuelve a ese paso.'
      )
    }

    const body = (await request.json().catch(() => ({}))) as { cajas?: unknown; version?: unknown }
    // La versión que tenía cargada la pantalla. Sin ella (pantallas viejas en caché) se guarda sin comprobar
    const version = typeof body.version === 'number' && Number.isInteger(body.version) ? body.version : null

    // Se valida TODO antes de tocar nada: se borra el conjunto entero para reescribirlo, así que
    // un fallo a mitad dejaría a la remesa sin cajas. Las reglas están en lib/fba/cajas-validacion.ts,
    // las mismas que usa la página pública del encaje.
    const limpieza = limpiarCajas(body.cajas)
    if (!limpieza.ok) return fail(400, limpieza.error)
    // Siempre numeradas 1..N por su orden (A3.2): el Excel de Amazon coloca cada caja en la columna de su número, y un hueco (1, 3, 4) cambiaba el
    // contenido de dos cajas. Aquí solo se llega en «Encajando», antes de que Amazon tenga las cajas
    const limpias = [...limpieza.cajas].sort((a, b) => a.numero - b.numero).map((c, i) => ({ ...c, numero: i + 1 }))

    try {
      await guardarCajas(params.id, limpias, undefined, version)
    } catch (error) {
      // 409 con una frase que se puede enseñar tal cual: alguien guardó entre medias, o la remesa cambió de paso
      if (error instanceof ConflictoDeVersion || error instanceof EstadoCambiado) {
        return NextResponse.json({ error: error.message, conflicto: error instanceof ConflictoDeVersion }, { status: 409 })
      }
      throw error
    }

    await registrarEnHistorial({
      remesaId: params.id,
      actor: r.sesion!.actor,
      userId: r.sesion!.userId,
      accion: 'cajas',
      detalle: { cajas: limpias.length, unidades: limpias.reduce((s, c) => s + c.contenido.reduce((t, x) => t + x.unidades, 0), 0) },
      agruparMinutos: 15,
    })

    // Se devuelve el cuadre recalculado: la pantalla necesita saber si ya cuadra
    // sin tener que pedirlo aparte.
    return NextResponse.json(await cajasDeRemesa(params.id))
  } catch (error) {
    return errorResponse(error, 'No se han podido guardar las cajas')
  }
}
