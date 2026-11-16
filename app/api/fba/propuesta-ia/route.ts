import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { agenciaQueEdita, requireFbaAccess } from '@/lib/fba/acceso'
import { diaEnEspana } from '@/lib/fba/fechas'
import { enviosDelCliente } from '@/lib/fba/inventario-datos'
import { ErrorDePropuesta, generarPropuestaIa, parametrosDelCliente } from '@/lib/fba/propuesta-ia'
import { normalizarParametros, plazoDeEnvios } from '@/lib/fba/reposicion'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LA PROPUESTA A MEDIDA (IA).
 *
 * GET  · lo que la pantalla necesita para ofrecer los parámetros: los DEL CLIENTE (plazo por etapas del planificador, cobertura,
 *        caja y mínimo de sus ajustes), el plazo que miden sus envíos y el mercado de la remesa. Barato: no llama a ninguna IA.
 * POST · genera la propuesta —inventario, lo comprometido, cálculo, IA, comprobación— y la DEVUELVE. NO escribe nada en la base:
 *        crear la remesa es el paso siguiente, y es de quien revisa las líneas (POST /api/fba/remesas).
 *
 * QUIÉN (cambio de comportamiento anotado, spec remesas-pro §1.4 y D21): antes solo un administrador; ahora la AGENCIA que puede
 * editar ese cliente (admin o empleado con la casilla `remesas`). Un cliente de fuera sigue sin poder lanzarla: cada propuesta es
 * una llamada a un servicio de pago que analiza el inventario entero. Lo que no viene en el POST se rellena con los parámetros
 * del cliente, no con los valores sueltos de siempre.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

const SOLO_AGENCIA = 'La propuesta a medida la genera Liberty Seller'

export async function GET(request: NextRequest) {
  try {
    const clienteId = request.nextUrl.searchParams.get('cliente') ?? ''
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')

    const sesion = await requireFbaAccess('editar', clienteId)
    if (sesion instanceof NextResponse) return sesion
    if (!agenciaQueEdita(sesion, clienteId)) return fail(403, SOLO_AGENCIA)

    const service = createServiceClient()
    const hoy = diaEnEspana()
    const [delCliente, envios] = await Promise.all([parametrosDelCliente(clienteId, hoy, service), enviosDelCliente(service, clienteId)])
    return NextResponse.json(
      {
        parametros: delCliente.parametros,
        // `plazo` sigue siendo el medido con los envíos (la pantalla lo enseña como «tus envíos tardan…»)
        plazo: plazoDeEnvios(envios),
        plazoEtapas: delCliente.plazoEtapas,
        origenPlazo: delCliente.origenPlazo,
        ajustes: delCliente.ajustes,
        mercadoRemesa: delCliente.mercadoRemesa,
        faltaMigracion316: delCliente.faltaMigracion316,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    return errorResponse(error, 'No se han podido leer los ajustes de la propuesta')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { clienteId?: unknown; parametros?: unknown; usarIa?: unknown }
    const clienteId = typeof body.clienteId === 'string' ? body.clienteId : ''
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')

    const sesion = await requireFbaAccess('editar', clienteId)
    if (sesion instanceof NextResponse) return sesion
    if (!agenciaQueEdita(sesion, clienteId)) return fail(403, SOLO_AGENCIA)

    const service = createServiceClient()
    const { data: cliente } = await service.from('amazon_clients').select('name').eq('id', clienteId).maybeSingle()
    if (!cliente) return fail(404, 'Ese cliente no existe')

    const hoy = diaEnEspana()
    // Lo que no venga en la petición sale de los ajustes del cliente; si leerlos falla, los valores de siempre (no se bloquea la propuesta)
    const defecto = await parametrosDelCliente(clienteId, hoy, service)
      .then((p) => p.parametros)
      .catch(() => undefined)

    const propuesta = await generarPropuestaIa({
      clienteId,
      clienteNombre: (cliente as { name: string }).name,
      parametros: normalizarParametros(body.parametros, defecto),
      hoy,
      usarIa: body.usarIa !== false,
    })
    return NextResponse.json({ propuesta }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    // Lo que dice ErrorDePropuesta ya está escrito para que lo lea una persona
    if (error instanceof ErrorDePropuesta) return fail(error.estado, error.message)
    return errorResponse(error, 'No se ha podido generar la propuesta')
  }
}
