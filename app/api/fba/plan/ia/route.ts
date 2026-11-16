import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { puedeEditar, requireFbaAccess } from '@/lib/fba/acceso'
import { MAX_MANUALES_DIA, TEXTO_TOPE_MANUAL, cargarLeerUltimoPlan, revisarPlanConIa, revisionesManualesDeHoy } from '@/lib/fba/ia-plan-servidor'
import { faltaLaTabla } from '@/lib/fba/planificacion'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * «REVISAR CON IA» UN PLAN DE REPOSICIÓN (spec remesas-pro §3 y §9).
 *
 * POST { clienteId, envioId? } → { revision: RevisionIa }
 *
 * SOLO LA AGENCIA CON PERMISO DE EDITAR. El cliente externo recibe 403 (D26): la revisión habla de prioridades internas y €.
 * Como mucho 2 revisiones a mano por cliente y día (429 «Ya se ha revisado 2 veces hoy»). Revisa la ÚLTIMA pasada guardada del
 * cliente; `envioId` solo comprueba que el envío propuesto sea de ese cliente (la revisión es del plan entero y se copia en todos
 * sus envíos activos). Si la IA falla, la respuesta trae `revision.aviso` en español y el plan sigue exactamente igual.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/** Una revisión a la vez por cliente en este proceso: dos clics seguidos no gastan el cupo dos veces */
const enCurso = new Set<string>()

const SIN_316 = 'Falta lanzar la migración 316: el plan se ve pero no se puede revisar con la IA.'

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { clienteId?: unknown; envioId?: unknown }
    const clienteId = typeof body.clienteId === 'string' ? body.clienteId : ''
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')
    const envioId = typeof body.envioId === 'string' && body.envioId !== '' ? body.envioId : null
    if (envioId !== null && !UUID.test(envioId)) return fail(400, 'Ese envío propuesto no es válido')

    const sesion = await requireFbaAccess('ver', clienteId)
    if (sesion instanceof NextResponse) return sesion
    if (sesion.actor !== 'agencia') return fail(403, 'La revisión del plan la hace Liberty Seller')
    if (!puedeEditar(sesion, clienteId)) return fail(403, 'Tu acceso a esta cuenta es solo de lectura')

    const service = createServiceClient()

    if (envioId) {
      const { data, error } = await service.from('fba_envios_propuestos').select('id').eq('id', envioId).eq('client_id', clienteId).maybeSingle()
      if (error) {
        if (faltaLaTabla(error)) return fail(503, SIN_316)
        throw error
      }
      if (!data) return fail(404, 'Ese envío propuesto no existe')
    }

    if (enCurso.has(clienteId)) return fail(429, 'Ya se está revisando este plan: espera unos segundos')
    enCurso.add(clienteId)
    try {
      const hechas = await revisionesManualesDeHoy(service, clienteId)
      if (hechas === null) return fail(503, SIN_316)
      if (hechas >= MAX_MANUALES_DIA) return fail(429, TEXTO_TOPE_MANUAL)

      const { data: ultima, error: errorUltima } = await service.from('fba_plan_ultima').select('id').eq('client_id', clienteId).maybeSingle()
      if (errorUltima) {
        if (faltaLaTabla(errorUltima)) return fail(503, SIN_316)
        throw errorUltima
      }

      const leerUltimoPlan = await cargarLeerUltimoPlan()
      const leido = await leerUltimoPlan(service, clienteId, { lineas: 'todas' })
      if (!leido) return fail(409, 'Este cliente todavía no tiene plan calculado: pulsa «Recalcular plan» y vuelve a probar')
      if (leido.plan.envios.length === 0) return fail(409, 'El plan no propone ningún envío: no hay nada que revisar')

      const pasadaId = (ultima as { id: string } | null)?.id ?? null
      const revision = await revisarPlanConIa(clienteId, leido.plan, pasadaId, 'manual', sesion.userId)
      if (!revision) return fail(500, 'No se ha podido revisar el plan con la IA; el plan sigue igual')
      return NextResponse.json({ revision }, { headers: { 'Cache-Control': 'no-store' } })
    } finally {
      enCurso.delete(clienteId)
    }
  } catch (error) {
    return errorResponse(error, 'No se ha podido revisar el plan con la IA')
  }
}
