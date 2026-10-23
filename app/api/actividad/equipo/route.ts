import { NextResponse } from 'next/server'
import { ventanaValida } from '@/lib/actividad/dia'
import { equipoDelDia } from '@/lib/actividad/lectura'
import type { RespuestaEquipo, RespuestaSinMigracion } from '@/lib/actividad/tipos'
import { fail, requireAppAccess } from '@/lib/auth/api'

/**
 * EL DÍA DE TODO EL EQUIPO (lectura). Solo administradores y quien tenga la casilla «Actividad del equipo» ('actividad').
 *
 * `desde` y `hasta` son instantes en ms (UTC): la pantalla calcula dónde empieza y acaba el día EN SU ZONA. Se aceptan
 * ventanas de hasta 49 horas (lib/actividad/dia.ts: ventanaValida).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const sesion = await requireAppAccess('actividad', 'No tienes acceso a la actividad del equipo')
  if (sesion instanceof NextResponse) return sesion

  const url = new URL(request.url)
  const ahora = Date.now()
  const ventana = ventanaValida(url.searchParams.get('desde'), url.searchParams.get('hasta'), ahora)
  if (!ventana) return fail(400, 'Las fechas pedidas no valen')

  try {
    const r = await equipoDelDia(ventana.desde, ventana.hasta)
    if (r.faltaMigracion) return NextResponse.json({ faltaMigracion: true } satisfies RespuestaSinMigracion, { headers: { 'Cache-Control': 'no-store' } })
    return NextResponse.json({ desde: ventana.desde, hasta: ventana.hasta, ahora, filas: r.filas } satisfies RespuestaEquipo, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[actividad] el equipo del día ha fallado', { mensaje: error instanceof Error ? error.message : 'desconocido' })
    return fail(500, 'No se ha podido leer la actividad. Vuelve a probar en un momento.')
  }
}
