import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { puedeEditar, requireFbaAccess } from '@/lib/fba/acceso'
import { cajasDeRemesa, guardarCajas } from '@/lib/fba/cajas'
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

    const body = (await request.json().catch(() => ({}))) as { cajas?: unknown }

    // Se valida TODO antes de tocar nada: se borra el conjunto entero para reescribirlo, así que
    // un fallo a mitad dejaría a la remesa sin cajas. Las reglas están en lib/fba/cajas-validacion.ts,
    // las mismas que usa la página pública del encaje.
    const limpieza = limpiarCajas(body.cajas)
    if (!limpieza.ok) return fail(400, limpieza.error)
    const limpias = limpieza.cajas

    await guardarCajas(params.id, limpias)

    // Se devuelve el cuadre recalculado: la pantalla necesita saber si ya cuadra
    // sin tener que pedirlo aparte.
    return NextResponse.json(await cajasDeRemesa(params.id))
  } catch (error) {
    return errorResponse(error, 'No se han podido guardar las cajas')
  }
}
