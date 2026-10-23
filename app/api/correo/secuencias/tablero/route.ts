import { NextResponse, type NextRequest } from 'next/server'
import { UUID } from '@/lib/amazon/api'
import { SIN_CACHE, requerirCorreo } from '@/lib/correo/rutas'
import { almacenDeSecuencias } from '@/lib/correo/secuencias/almacen'
import { respuestaDeFalloDeSecuencias } from '@/lib/correo/secuencias/rutas'
import { tablero } from '@/lib/correo/secuencias/servidor'
import { quienPide } from '@/lib/correo/servidor'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * EL TABLERO DE SECUENCIAS: el reparto de hoy por buzón, los próximos días, el embudo y lo último que ha pasado.
 *
 * GET ?buzonId=… (opcional: solo un buzón)
 *
 * Cada comercial ve SOLO lo de su buzón; quien supervisa el correo (o el equipo comercial) y los administradores ven los de las personas que ya
 * pueden ver en Correo (lib/correo/acceso.ts). Sin la migración 245 contesta `{ disponible: false }` con el aviso, no un error.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(request: NextRequest) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion
  const buzon = request.nextUrl.searchParams.get('buzonId')
  try {
    const service = createServiceClient()
    const quien = await quienPide(service, sesion)
    const t = await tablero(almacenDeSecuencias(service), quien, { buzonId: buzon && UUID.test(buzon) ? buzon.toLowerCase() : null })
    return NextResponse.json({ ok: true, ...t }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFalloDeSecuencias('Correo · secuencias: tablero', error)
  }
}
