import { NextResponse } from 'next/server'
import { ventanaValida } from '@/lib/actividad/dia'
import { ID_DE_PERSONA, personaDelDia } from '@/lib/actividad/lectura'
import type { RespuestaSinMigracion } from '@/lib/actividad/tipos'
import { fail, requireAppAccess } from '@/lib/auth/api'

/**
 * EL DÍA DE UNA PERSONA (lectura): sus tramos activos, el tiempo en cada pantalla y el registro de lo que hizo.
 * Solo administradores y quien tenga la casilla «Actividad del equipo» ('actividad').
 *
 * Solo contesta por EMPLEADOS (rol 'employee'): el id de un administrador, un socio o un cliente da 404, igual que uno
 * que no existe.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const sesion = await requireAppAccess('actividad', 'No tienes acceso a la actividad del equipo')
  if (sesion instanceof NextResponse) return sesion

  const url = new URL(request.url)
  const id = url.searchParams.get('id') ?? ''
  if (!ID_DE_PERSONA.test(id)) return fail(400, 'Falta la persona')
  const ventana = ventanaValida(url.searchParams.get('desde'), url.searchParams.get('hasta'), Date.now())
  if (!ventana) return fail(400, 'Las fechas pedidas no valen')

  try {
    const r = await personaDelDia(id, ventana.desde, ventana.hasta)
    if (r === null) return fail(404, 'Esa persona no está en el equipo')
    if ('faltaMigracion' in r) return NextResponse.json({ faltaMigracion: true } satisfies RespuestaSinMigracion, { headers: { 'Cache-Control': 'no-store' } })
    return NextResponse.json(r, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[actividad] el día de una persona ha fallado', { mensaje: error instanceof Error ? error.message : 'desconocido' })
    return fail(500, 'No se ha podido leer la actividad. Vuelve a probar en un momento.')
  }
}
