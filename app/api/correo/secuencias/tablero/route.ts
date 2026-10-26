import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail } from '@/lib/amazon/api'
import { SIN_CACHE, requerirCorreo } from '@/lib/correo/rutas'
import { almacenDeSecuencias } from '@/lib/correo/secuencias/almacen'
import { DIAS_MAXIMOS_DE_LA_DEMO, demostracion } from '@/lib/correo/secuencias/demo'
import { enteroDeUrl, respuestaDeFalloDeSecuencias } from '@/lib/correo/secuencias/rutas'
import { tablero } from '@/lib/correo/secuencias/servidor'
import { quienPide } from '@/lib/correo/servidor'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * EL TABLERO DE SECUENCIAS: el reparto de hoy por buzón, los próximos días, el embudo y lo último que ha pasado.
 *
 * GET ?buzonId=… (opcional: solo un buzón)
 * GET ?demo=1&dias=N  el mismo tablero de la DEMOSTRACIÓN (gente inventada, el motor de verdad en memoria, nada de la base): solo administradores. Ver lib/correo/secuencias/demo.ts
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
  if (request.nextUrl.searchParams.get('demo') === '1') {
    if (sesion.role !== 'admin') return fail(403, 'La demostración es solo para administradores.')
    try {
      const d = await demostracion({ dias: enteroDeUrl(request.nextUrl.searchParams.get('dias'), 0, 0, DIAS_MAXIMOS_DE_LA_DEMO) })
      const t = await tablero(d.almacen, d.quien, { ahora: d.ahora, buzonId: buzon && UUID.test(buzon) ? buzon.toLowerCase() : null })
      return NextResponse.json({ ok: true, ...t, demo: { dia: d.dia, dias: d.dias, maximo: DIAS_MAXIMOS_DE_LA_DEMO } }, { headers: SIN_CACHE })
    } catch (error) {
      return respuestaDeFalloDeSecuencias('Correo · secuencias: tablero de la demostración', error)
    }
  }
  try {
    const service = createServiceClient()
    const quien = await quienPide(service, sesion)
    const t = await tablero(almacenDeSecuencias(service), quien, { buzonId: buzon && UUID.test(buzon) ? buzon.toLowerCase() : null })
    return NextResponse.json({ ok: true, ...t }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFalloDeSecuencias('Correo · secuencias: tablero', error)
  }
}
