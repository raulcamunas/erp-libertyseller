import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail } from '@/lib/amazon/api'
import { SIN_CACHE, requerirCorreo, textoDe } from '@/lib/correo/rutas'
import { almacenDeSecuencias } from '@/lib/correo/secuencias/almacen'
import { dentroDelLimite, respuestaDeFalloDeSecuencias } from '@/lib/correo/secuencias/rutas'
import { accionSobreSecuencia, detalleDeSecuencia, type AccionSobreSecuencia } from '@/lib/correo/secuencias/servidor'
import { quienPide } from '@/lib/correo/servidor'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * UNA SECUENCIA: SU DETALLE Y LO QUE UNA PERSONA PUEDE HACER CON ELLA.
 *
 * GET   el detalle: cada correo con su texto, y el rastro de lo que ha pasado.
 * POST  application/json  { accion: 'pausar' | 'reanudar' | 'cancelar' }
 *                         { accion: 'saltar' | 'reintentar' | 'adelantar', pasoId }
 *                         { accion: 'editar', pasoId, asunto?, texto? }
 *
 * Quién puede hacer qué lo decide lib/correo/secuencias/servidor.ts: lo que no se puede ver se contesta «no existe»; editar el texto es solo del dueño
 * del buzón; el resto, del dueño o de un administrador.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const SIN_PASO = ['pausar', 'reanudar', 'cancelar'] as const
const CON_PASO = ['saltar', 'reintentar', 'adelantar'] as const

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion
  if (!UUID.test(params.id)) return fail(404, 'No existe esa secuencia.')
  try {
    const service = createServiceClient()
    const quien = await quienPide(service, sesion)
    const d = await detalleDeSecuencia(almacenDeSecuencias(service), quien, params.id.toLowerCase())
    if (!d) return fail(404, 'No existe esa secuencia.')
    return NextResponse.json({ ok: true, ...d }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFalloDeSecuencias('Correo · secuencias: detalle', error)
  }
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion
  if (!UUID.test(params.id)) return fail(404, 'No existe esa secuencia.')
  if (!dentroDelLimite(`secuencia-accion:${sesion.userId}`, 60)) return fail(429, 'Demasiadas acciones seguidas. Espera un momento.')

  let cuerpo: Record<string, unknown>
  try {
    cuerpo = ((await request.json()) ?? {}) as Record<string, unknown>
  } catch {
    return fail(400, 'No se ha entendido lo que se ha mandado')
  }
  const accion = cuerpo.accion
  const pasoId = typeof cuerpo.pasoId === 'string' && UUID.test(cuerpo.pasoId) ? cuerpo.pasoId.toLowerCase() : null
  let peticion: AccionSobreSecuencia
  if ((SIN_PASO as readonly unknown[]).includes(accion)) peticion = { accion: accion as (typeof SIN_PASO)[number] }
  else if ((CON_PASO as readonly unknown[]).includes(accion)) {
    if (!pasoId) return fail(400, 'Falta el correo sobre el que se actúa.')
    peticion = { accion: accion as (typeof CON_PASO)[number], pasoId }
  } else if (accion === 'editar') {
    if (!pasoId) return fail(400, 'Falta el correo que se edita.')
    const asunto = textoDe(cuerpo.asunto, 300)
    const texto = typeof cuerpo.texto === 'string' ? cuerpo.texto.slice(0, 8000) : undefined
    peticion = { accion: 'editar', pasoId, ...(asunto ? { asunto } : {}), ...(texto !== undefined ? { texto } : {}) }
  } else return fail(400, 'No se entiende qué hacer con la secuencia.')

  try {
    const service = createServiceClient()
    const quien = await quienPide(service, sesion)
    const r = await accionSobreSecuencia(almacenDeSecuencias(service), quien, params.id.toLowerCase(), peticion)
    return NextResponse.json(r.ok ? { ok: true, mensaje: r.mensaje } : { ok: false, error: r.mensaje }, { status: r.estado, headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFalloDeSecuencias('Correo · secuencias: acción', error)
  }
}
