import { NextResponse } from 'next/server'
import { fail, requireAppAccess } from '@/lib/auth/api'
import { claveExisteEn, esClaveDePunto, FALTA_MIGRACION_BRIEFING, FaltaMigracionDelBriefing, leerBriefing, marcarPunto } from '@/lib/briefing/servidor'
import { APP_BRIEFING } from '@/lib/briefing/tipos'
import { esDia } from '@/lib/correo/secuencias/fechas'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * MARCAR UN PUNTO DEL BRIEFING COMO RESUELTO (o quitar la marca). Solo administradores y quien tenga la casilla «Briefing» ('briefing').
 *
 * Cuerpo: { dia: 'AAAA-MM-DD', clave: 'r-1a2b3c4d', hecho: true | false }. La clave tiene que ser de un punto que EXISTE en el briefing de ese día
 * (si no, 404): una marca no puede apuntar a algo inventado. Contesta con quién la ha puesto y cuándo, para que la pantalla lo enseñe sin volver a leer.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  const sesion = await requireAppAccess(APP_BRIEFING, 'No tienes acceso al briefing')
  if (sesion instanceof NextResponse) return sesion

  let cuerpo: unknown
  try {
    cuerpo = await request.json()
  } catch {
    return fail(400, 'El cuerpo no es un JSON válido')
  }
  const { dia, clave, hecho } = (cuerpo && typeof cuerpo === 'object' ? cuerpo : {}) as Record<string, unknown>
  if (!esDia(dia)) return fail(400, 'El día no es válido')
  if (!esClaveDePunto(clave)) return fail(400, 'El punto no es válido')
  if (typeof hecho !== 'boolean') return fail(400, 'Falta decir si está resuelto o no')

  try {
    const service = createServiceClient()
    const guardado = await leerBriefing(service, dia)
    if (!guardado || !claveExisteEn(guardado.briefing, clave)) return fail(404, 'Ese punto ya no está en el briefing de ese día')
    await marcarPunto(service, { dia, clave, hecho, userId: sesion.userId })

    // El nombre de quien la pone, con su propia sesión (cada uno lee su perfil)
    const { data: perfil } = await sesion.supabase.from('profiles').select('full_name').eq('id', sesion.userId).maybeSingle()
    return NextResponse.json(
      { ok: true, marca: hecho ? { por: (perfil as { full_name: string | null } | null)?.full_name ?? null, cuando: new Date().toISOString() } : null },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    if (error instanceof FaltaMigracionDelBriefing) return fail(503, FALTA_MIGRACION_BRIEFING)
    console.error('[briefing] no se ha podido marcar un punto', { mensaje: error instanceof Error ? error.message : 'desconocido' })
    return fail(500, 'No se ha podido guardar la marca. Vuelve a probar en un momento.')
  }
}
