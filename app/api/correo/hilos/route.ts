import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { SIN_CACHE, requerirCorreo, respuestaDeFallo } from '@/lib/correo/rutas'
import { POR_PAGINA, autorizarBuzon, listarHilos, nombreDeLaSesion, registrarAcceso } from '@/lib/correo/servidor'
import type { VistaDeCorreo } from '@/lib/correo/tipos'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LA LISTA DE HILOS DE UN BUZÓN.
 *
 * GET ?buzon=<id>&vista=todos|recibidos|enviados|destacados|pendientes&sinLeer=1&q=<texto>&antes=<fecha>&limite=<n>
 *
 * Su dueño la ve siempre; un administrador, un partner o quien supervisa el equipo comercial la ve según la regla de
 * lib/correo/acceso.ts, y cada vez que alguien mira un buzón ajeno queda una fila en correo_accesos. Si no se puede
 * dejar esa fila, no se enseña nada: se cierra en vez de abrir.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const VISTAS: readonly VistaDeCorreo[] = ['todos', 'recibidos', 'enviados', 'destacados', 'pendientes']
const MIN_BUSQUEDA = 2
const MAX_BUSQUEDA = 200

export async function GET(request: NextRequest) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion

  const p = request.nextUrl.searchParams
  const vista = VISTAS.find((v) => v === p.get('vista')) ?? 'todos'
  const q = (p.get('q') ?? '').trim().slice(0, MAX_BUSQUEDA)
  const busqueda = q.length >= MIN_BUSQUEDA ? q : null
  const antesCrudo = p.get('antes')
  const antes = antesCrudo && Number.isFinite(Date.parse(antesCrudo)) ? new Date(antesCrudo).toISOString() : null
  const limite = Number(p.get('limite')) || POR_PAGINA

  try {
    const service = createServiceClient()
    const auth = await autorizarBuzon(service, sesion, p.get('buzon'), 'leer')
    if (!auth.ok) return fail(auth.estado, auth.mensaje)

    if (auth.porSupervision) {
      await registrarAcceso(service, { userId: sesion.userId, nombre: await nombreDeLaSesion(service, sesion.userId) }, auth.buzon.id, busqueda ? 'busqueda' : 'lista')
    }

    const lista = await listarHilos(service, auth.buzon.id, { vista, soloNoLeidos: p.get('sinLeer') === '1', busqueda, antes, limite })
    return NextResponse.json(lista, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFallo('Correo · hilos: fallo', error)
  }
}
