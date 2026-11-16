import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { agenciaQueEdita, esAgencia, requireFbaAccess } from '@/lib/fba/acceso'
import { FALTA_LA_MIGRACION_316, leerAjustesVigentes, leerFilaReposicion } from '@/lib/fba/ajustes-datos'
import { validarAjustes } from '@/lib/fba/ajustes-reposicion'
import { diaEnEspana } from '@/lib/fba/fechas'
import { faltaLaTabla } from '@/lib/fba/planificacion'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LOS AJUSTES DEL PLANIFICADOR DE REPOSICIÓN DE UN CLIENTE (spec remesas-pro §7, §9 y §11 D14; paquete S6).
 *
 *   GET  ?cliente=…   { ajustes: AjustesReposicion, medidas: MedidasCliente, plazo: PlazoEtapas, guardado, migracion316, aviso }
 *        · `ajustes` son los EFECTIVOS: lo puesto a mano > lo medido (ventana = cadencia; mínimo por envío = 40 % del tamaño típico) >
 *          los de partida (`ajustesDesdeFila`). `ajustes.origen` dice de dónde sale cada uno («medido: cada 9 días, ~110 ud»).
 *        · `medidas`: transporte (envío → primer Receipt), recepción (p75 del primer Receipt al 90 %), cadencia y tamaño típico.
 *        · `plazo`: el plazo por etapas vigente (`plazoDelCliente`), el mismo del plan y de las alertas. Se cambia en
 *          /api/fba/alertas/config, no aquí (una fila de ajustes nunca es un plazo manual).
 *        · `guardado`: la fila tal cual (null = nada puesto a mano), para que la pantalla distinga «tuyo» de «medido».
 *        · Sin la migración 316 contesta igual (con lo medido y lo de partida), `migracion316: false` y el aviso
 *          «Falta lanzar la migración 316…»: la pantalla enseña los valores pero no deja guardar.
 *
 *   PUT  { cliente | clienteId, ...ajustes }   PARCIAL: solo las claves que llegan (`validarAjustes`; números fuera de rango se acotan
 *        con aviso, null o «» vuelve a «medido o de partida»). Contesta lo mismo que el GET más `avisos`. Sin la 316, 409.
 *
 * Permisos: la agencia. Leer, quien vea el cliente; guardar, quien lo pueda editar (`agenciaQueEdita`). Antes los ajustes del
 * planificador no existían y los plazos eran cosa del admin: ahora los gestiona la agencia con editar (spec §1.4, anotado).
 * El cliente de fuera, 403 (D26).
 */
export const dynamic = 'force-dynamic'

const NO_CLIENTE = 'Los ajustes de reposición los pone la agencia'

const clienteDe = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

async function respuesta(clienteId: string, extra: Record<string, unknown> = {}) {
  const v = await leerAjustesVigentes(createServiceClient(), clienteId, diaEnEspana())
  return NextResponse.json({
    ok: true,
    ajustes: v.ajustes,
    medidas: v.medidas,
    plazo: v.plazo,
    guardado: v.guardado,
    actualizadoAt: v.guardado?.actualizado_at ?? null,
    migracion316: v.migracion316,
    aviso: v.migracion316 ? null : FALTA_LA_MIGRACION_316,
    ...extra,
  })
}

export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams
    const clienteId = clienteDe(p.get('cliente') ?? p.get('clienteId'))
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')
    const sesion = await requireFbaAccess('ver', clienteId)
    if (sesion instanceof NextResponse) return sesion
    if (!esAgencia(sesion)) return fail(403, NO_CLIENTE)
    return await respuesta(clienteId)
  } catch (error) {
    return errorResponse(error, 'No se han podido leer los ajustes de reposición')
  }
}

export async function PUT(request: NextRequest) {
  try {
    const cuerpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) return fail(400, 'Falta el cuerpo de la petición')
    const clienteId = clienteDe(request.nextUrl.searchParams.get('cliente') ?? cuerpo.cliente ?? cuerpo.clienteId)
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')

    const sesion = await requireFbaAccess('editar', clienteId)
    if (sesion instanceof NextResponse) return sesion
    if (!esAgencia(sesion)) return fail(403, NO_CLIENTE)
    if (!agenciaQueEdita(sesion, clienteId)) return fail(403, 'Tu acceso a esta cuenta es solo de lectura')

    const service = createServiceClient()
    const actual = await leerFilaReposicion(service, clienteId)
    if (!actual.migracion316) return fail(409, FALTA_LA_MIGRACION_316)

    // Los ajustes pueden venir sueltos o dentro de `ajustes`
    const entrada = cuerpo.ajustes && typeof cuerpo.ajustes === 'object' && !Array.isArray(cuerpo.ajustes) ? cuerpo.ajustes : cuerpo
    const v = validarAjustes(entrada, actual.fila)
    if (!v.ok) return fail(400, v.errores.join(' '))

    const fila = { client_id: clienteId, ...v.cambios, actualizado_at: new Date().toISOString(), actualizado_por: sesion.userId }
    const { error } = await service.from('fba_reposicion_config').upsert(fila, { onConflict: 'client_id' })
    if (error) {
      if (faltaLaTabla(error)) return fail(409, FALTA_LA_MIGRACION_316)
      // 23514 = un CHECK de la 316 (no debería: validarAjustes usa los mismos rangos)
      if ((error as { code?: string }).code === '23514') return fail(400, 'Algún ajuste se sale de los límites permitidos')
      throw error
    }
    return await respuesta(clienteId, { avisos: v.avisos })
  } catch (error) {
    return errorResponse(error, 'No se han podido guardar los ajustes de reposición')
  }
}
