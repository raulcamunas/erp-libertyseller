import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail } from '@/lib/amazon/api'
import { SIN_CACHE, requerirCorreo } from '@/lib/correo/rutas'
import { almacenDeSecuencias } from '@/lib/correo/secuencias/almacen'
import { respuestaDeFalloDeSecuencias } from '@/lib/correo/secuencias/rutas'
import { guardarAjustesDeBuzon, guardarAjustesDelMotor } from '@/lib/correo/secuencias/servidor'
import { quienPide } from '@/lib/correo/servidor'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LOS AJUSTES DEL MOTOR DE SECUENCIAS — SOLO ADMINISTRADORES.
 *
 * POST application/json  { motor?: { activa, modoEnsayo, ventana…, rampa, festivos, confirmarEnvioReal… }, buzon?: { id, participa, topeDiario, llamadas…, quitarPausa, pausarHastaMañana } }
 *
 * Los valores se comprueban uno a uno (lib/correo/secuencias/ajustes.ts). Pasar de «ensayo» a «envío real» exige `confirmarEnvioReal: true`. Para LEER los
 * ajustes no hace falta esta ruta: viajan en el tablero.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(request: NextRequest) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion
  let cuerpo: Record<string, unknown>
  try {
    cuerpo = ((await request.json()) ?? {}) as Record<string, unknown>
  } catch {
    return fail(400, 'No se ha entendido lo que se ha mandado')
  }
  if (cuerpo.motor === undefined && cuerpo.buzon === undefined) return fail(400, 'No hay ningún cambio que guardar.')

  try {
    const service = createServiceClient()
    const quien = await quienPide(service, sesion)
    const almacen = almacenDeSecuencias(service)
    const avisos: string[] = []
    if (cuerpo.motor !== undefined) {
      const r = await guardarAjustesDelMotor(almacen, quien, cuerpo.motor)
      if (!r.ok) return NextResponse.json({ ok: false, error: r.mensaje }, { status: r.estado, headers: SIN_CACHE })
      avisos.push(...r.avisos)
    }
    if (cuerpo.buzon !== undefined) {
      const b = (cuerpo.buzon ?? {}) as Record<string, unknown>
      if (typeof b.id !== 'string' || !UUID.test(b.id)) return fail(400, 'Falta el buzón.')
      const { id, ...cambios } = b
      const r = await guardarAjustesDeBuzon(almacen, quien, id.toLowerCase(), cambios)
      if (!r.ok) return NextResponse.json({ ok: false, error: r.mensaje }, { status: r.estado, headers: SIN_CACHE })
      avisos.push(...r.avisos)
    }
    return NextResponse.json({ ok: true, avisos }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFalloDeSecuencias('Correo · secuencias: ajustes', error)
  }
}
