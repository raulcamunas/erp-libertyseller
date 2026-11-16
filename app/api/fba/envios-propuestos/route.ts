import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import {
  AVISO_316,
  estadosDeParametro,
  leerEnvios,
  pendientesDeSesion,
  respuestaDeErrorDeEnvio,
  sesionDeAgencia,
} from '@/lib/fba/envios-propuestos-servidor'
import { diaEnEspana } from '@/lib/fba/fechas'
import { ESTADOS_ACTIVOS, type EstadoEnvioPropuesto, type TareaPendiente } from '@/lib/fba/plan-tipos'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LOS ENVÍOS PROPUESTOS Y LO QUE ESTÁ PENDIENTE (spec remesas-pro §4.3 y §9).
 *
 * GET ?cliente=<id>&estado=<lista|activos|todos>&vista=pendientes
 *   → { envios: EnvioPropuestoGuardado[], pendientes: TareaPendiente[], migracion316: boolean, aviso: string | null }
 *
 * - Sin `cliente`, todos los clientes que la sesión puede ver.
 * - Sin `estado`, los ACTIVOS (nuevo, hablado, esperando al cliente y en preparación): el histórico de descartados
 *   y caducados crece sin parar y casi nunca se mira. `estado=todos` lo trae todo; `estado=descartado,caducado`, eso.
 * - `vista=pendientes` calcula además las tareas de «Hoy» (trabajo-plan.ts `pendientes`): envíos propuestos
 *   vencidos o sin dueño, remesas paradas, cerradas con faltantes, dudosas, entrantes sin remesa y alertas de
 *   calidad. Se calculan con los envíos ACTIVOS aunque el filtro de estado pida otra cosa.
 *
 * Solo la agencia: el rol `cliente` recibe 403 (D26). Sin la migración 316 contesta con la lista vacía,
 * `migracion316: false` y el aviso; los pendientes que salen de las remesas se calculan igual.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams
    const clienteId = p.get('cliente') || null
    if (clienteId !== null && !UUID.test(clienteId)) return fail(400, 'Ese cliente no existe')

    const sesion = await sesionDeAgencia('ver', clienteId)
    if (sesion instanceof NextResponse) return sesion

    const parametroEstado = p.get('estado')
    const estados: EstadoEnvioPropuesto[] | null =
      parametroEstado === 'todos' ? null : estadosDeParametro(parametroEstado) ?? [...ESTADOS_ACTIVOS]
    const conPendientes = p.get('vista') === 'pendientes'

    const service = createServiceClient()
    const hoy = diaEnEspana()

    const { envios, migracion316 } = await leerEnvios(service, sesion, { clienteId, estados }, hoy)

    let pendientes: TareaPendiente[] = []
    if (conPendientes) {
      // Si la lista pedida ya son justo los activos, se reutiliza; si no, se leen aparte
      const soloActivos = estados !== null && estados.length === ESTADOS_ACTIVOS.length && ESTADOS_ACTIVOS.every((e) => estados.includes(e))
      const activos = !migracion316
        ? []
        : soloActivos
          ? envios
          : (await leerEnvios(service, sesion, { clienteId, estados: [...ESTADOS_ACTIVOS] }, hoy)).envios
      pendientes = await pendientesDeSesion(service, sesion, activos, hoy, clienteId)
    }

    return NextResponse.json({ envios, pendientes, migracion316, aviso: migracion316 ? null : AVISO_316 })
  } catch (error) {
    return respuestaDeErrorDeEnvio(error) ?? errorResponse(error, 'No se han podido leer los envíos propuestos')
  }
}
