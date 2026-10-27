import { NextResponse } from 'next/server'
import { fail, requireAdmin } from '@/lib/auth/api'
import { anularEnlaceDelConector, crearEnlaceDelConector, estadoDelConector, FALTA_MIGRACION_BRIEFING, FaltaMigracionDelBriefing } from '@/lib/briefing/servidor'
import { createServiceClient } from '@/lib/supabase/service'
import { urlBaseApp } from '@/lib/url-app'

/**
 * EL ENLACE SECRETO DEL CONECTOR QUE PUBLICA EL BRIEFING. SOLO ADMINISTRADORES.
 *
 *   · POST   crea un enlace nuevo (el anterior deja de valer) y lo devuelve ENTERO: es la única vez que se puede ver, en la base solo queda su huella.
 *   · DELETE lo anula: la rutina deja de poder publicar hasta que se cree otro.
 *   · GET    dice si hay enlace, desde cuándo y cuándo se usó por última vez.
 *
 * Quien tenga el enlace puede publicar un briefing y NADA más (lib/mcp/briefing.ts), pero aun así es una llave: la aplicación no lo escribe en ningún log ni lo manda a ningún sitio (el proxy del servidor sí puede guardar la dirección de cada petición, como con cualquier enlace secreto).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SIN_CACHE = { 'Cache-Control': 'no-store' }

function respuestaDeError(error: unknown, frase: string): NextResponse {
  if (error instanceof FaltaMigracionDelBriefing) return fail(503, FALTA_MIGRACION_BRIEFING)
  console.error('[briefing] el enlace del conector ha fallado', { mensaje: error instanceof Error ? error.message : 'desconocido' })
  return fail(500, frase)
}

export async function GET() {
  const sesion = await requireAdmin('Solo un administrador ve el conector del briefing')
  if (sesion instanceof NextResponse) return sesion
  try {
    return NextResponse.json(await estadoDelConector(createServiceClient()), { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeError(error, 'No se ha podido leer el estado del conector.')
  }
}

export async function POST() {
  const sesion = await requireAdmin('Solo un administrador crea el enlace del conector')
  if (sesion instanceof NextResponse) return sesion
  try {
    const { token } = await crearEnlaceDelConector(createServiceClient(), sesion.userId)
    return NextResponse.json({ url: `${urlBaseApp().replace(/\/+$/, '')}/api/mcp/briefing/${token}`, creadoAt: new Date().toISOString() }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeError(error, 'No se ha podido crear el enlace. Vuelve a probar en un momento.')
  }
}

export async function DELETE() {
  const sesion = await requireAdmin('Solo un administrador anula el enlace del conector')
  if (sesion instanceof NextResponse) return sesion
  try {
    await anularEnlaceDelConector(createServiceClient())
    return NextResponse.json({ ok: true }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeError(error, 'No se ha podido anular el enlace. Vuelve a probar en un momento.')
  }
}
