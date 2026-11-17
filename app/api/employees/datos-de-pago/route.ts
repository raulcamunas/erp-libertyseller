import { NextResponse, type NextRequest } from 'next/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { crearEnlace, estadoDelEquipo, FaltaMigracion, rutaDelEnlace } from '@/lib/empleados/enlace-pago'

/**
 * DATOS DE PAGO DEL EQUIPO. SOLO ADMINISTRADORES (ni socios: son datos bancarios, como los sueldos de Control empleados).
 *
 *   GET                   de cada empleado: si ya ha enviado sus datos (resumidos: banco y las 4 últimas cifras) y si tiene un enlace vivo
 *   POST {employeeId}     genera un enlace nuevo de 7 días (desactiva el anterior) y devuelve su ruta
 */
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function soloAdmin() {
  const p = await getUserProfile()
  if (!p) return { ok: false as const, res: NextResponse.json({ error: 'No autorizado' }, { status: 401 }) }
  if (p.role !== 'admin') return { ok: false as const, res: NextResponse.json({ error: 'Solo administradores' }, { status: 403 }) }
  return { ok: true as const, id: p.id }
}

const fallo = (e: unknown) =>
  e instanceof FaltaMigracion
    ? NextResponse.json({ error: e.message, faltaMigracion: true }, { status: 503 })
    : NextResponse.json({ error: e instanceof Error ? e.message : 'Error inesperado' }, { status: 500 })

export async function GET() {
  const a = await soloAdmin()
  if (!a.ok) return a.res
  try {
    return NextResponse.json({ equipo: (await estadoDelEquipo()).map((e) => ({ ...e, enlace: e.enlace ? { ...e.enlace, ruta: rutaDelEnlace(e.enlace.token) } : null })) })
  } catch (e) {
    return fallo(e)
  }
}

export async function POST(request: NextRequest) {
  const a = await soloAdmin()
  if (!a.ok) return a.res
  const c = (await request.json().catch(() => ({}))) as { employeeId?: string }
  if (!c.employeeId || !UUID.test(c.employeeId)) return NextResponse.json({ error: 'Falta el empleado' }, { status: 400 })
  try {
    const { token, caduca } = await crearEnlace(c.employeeId, a.id)
    return NextResponse.json({ ruta: rutaDelEnlace(token), caduca })
  } catch (e) {
    return fallo(e)
  }
}
