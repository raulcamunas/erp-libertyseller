import { NextResponse, type NextRequest } from 'next/server'
import { FaltaMigracion, MAX_BYTES, guardarDatos } from '@/lib/empleados/enlace-pago'

/**
 * EL FORMULARIO PÚBLICO DE DATOS DE PAGO: ENVIAR. Sin sesión: el token del cuerpo es la credencial (lib/empleados/enlace-pago.ts).
 *
 * Un token que no vale se contesta siempre igual, sin decir por qué. Los errores de un campo sí se devuelven, por campo, para que la persona los corrija.
 */
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const crudo = await request.text().catch(() => '')
  if (crudo.length > MAX_BYTES) return NextResponse.json({ error: 'Demasiados datos.' }, { status: 413 })
  let c: { token?: unknown; datos?: unknown }
  try {
    c = JSON.parse(crudo)
  } catch {
    return NextResponse.json({ error: 'Petición no válida.' }, { status: 400 })
  }
  if (typeof c.token !== 'string' || !c.datos || typeof c.datos !== 'object') return NextResponse.json({ error: 'Petición no válida.' }, { status: 400 })
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip')?.trim() || null
    const r = await guardarDatos(c.token, c.datos as Record<string, unknown>, { ip, userAgent: request.headers.get('user-agent') })
    if (r.ok) return NextResponse.json({ ok: true })
    if (r.noValido) return NextResponse.json({ error: 'Este enlace no es válido o ya se ha usado. Pide uno nuevo.' }, { status: 410 })
    return NextResponse.json({ errores: r.errores }, { status: 422 })
  } catch (e) {
    console.error('Datos de pago: no se han podido guardar', e)
    return NextResponse.json({ error: e instanceof FaltaMigracion ? 'El formulario aún no está activo. Avisa a quien te mandó el enlace.' : 'No se han podido guardar. Inténtalo de nuevo en un momento.' }, { status: 500 })
  }
}
