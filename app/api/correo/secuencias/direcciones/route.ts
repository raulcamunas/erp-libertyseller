import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { SIN_CACHE, requerirCorreo } from '@/lib/correo/rutas'
import { almacenDeSecuencias } from '@/lib/correo/secuencias/almacen'
import { DIAS_MAXIMOS_DE_LA_DEMO, demostracion } from '@/lib/correo/secuencias/demo'
import { enteroDeUrl, respuestaDeFalloDeSecuencias } from '@/lib/correo/secuencias/rutas'
import { analizarDireccion } from '@/lib/correo/verificacion/direccion'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LA MEMORIA DE DIRECCIONES QUE HAN REBOTADO — SOLO ADMINISTRADORES.
 *
 * GET                       la lista, la última primero. Con ?demo=1&dias=N, la de la DEMOSTRACIÓN (lib/correo/secuencias/demo.ts).
 * POST { direccion, accion: 'liberar' | 'marcar' }   liberar una que en realidad funciona, o marcar una a mano.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 20

export async function GET(request: NextRequest) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion
  if (sesion.role !== 'admin') return fail(403, 'Solo un administrador puede ver esto.')
  try {
    const p = request.nextUrl.searchParams
    const almacen = p.get('demo') === '1' ? (await demostracion({ dias: enteroDeUrl(p.get('dias'), 0, 0, DIAS_MAXIMOS_DE_LA_DEMO) })).almacen : almacenDeSecuencias(createServiceClient())
    const direcciones = await almacen.listaDeDireccionesMalas(200)
    return NextResponse.json({ ok: true, direcciones }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFalloDeSecuencias('Correo · direcciones malas: lista', error)
  }
}

export async function POST(request: NextRequest) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion
  if (sesion.role !== 'admin') return fail(403, 'Solo un administrador puede cambiar esto.')
  let cuerpo: Record<string, unknown>
  try {
    cuerpo = ((await request.json()) ?? {}) as Record<string, unknown>
  } catch {
    return fail(400, 'No se ha entendido lo que se ha mandado')
  }
  const analisis = analizarDireccion(typeof cuerpo.direccion === 'string' ? cuerpo.direccion : '')
  if (analisis.direccion === '' || !analisis.dominio || !analisis.local) return fail(400, 'Esa dirección no es válida.')
  try {
    const almacen = almacenDeSecuencias(createServiceClient())
    const ahora = Date.now()
    if (cuerpo.accion === 'liberar') {
      const hecho = await almacen.liberarDireccion(analisis.direccion, ahora)
      return hecho ? NextResponse.json({ ok: true }, { headers: SIN_CACHE }) : fail(404, 'Esa dirección no estaba marcada.')
    }
    if (cuerpo.accion === 'marcar') {
      await almacen.marcarDireccionMala(analisis.direccion, 'marcada a mano por un administrador', 'manual', ahora, ahora)
      return NextResponse.json({ ok: true }, { headers: SIN_CACHE })
    }
    return fail(400, 'No se entiende qué hacer con la dirección.')
  } catch (error) {
    return respuestaDeFalloDeSecuencias('Correo · direcciones malas: cambio', error)
  }
}
