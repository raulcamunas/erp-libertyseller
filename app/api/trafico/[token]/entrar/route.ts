import { NextResponse, type NextRequest } from 'next/server'
import { DURACION_SESION_S, entrar, firmaDeSesion, nombreDeCookie } from '@/lib/trafico/servidor'

/** Entrar en la página de tráfico de un cliente con la clave: `{ clave }`. Si vale, deja una cookie firmada de 30 días (solo para /trafico y /api/trafico) */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const cuerpo = (await request.json().catch(() => ({}))) as { clave?: unknown }
    const r = await entrar(params.token, cuerpo.clave)
    if (!r.ok) return NextResponse.json({ error: r.motivo }, { status: r.status })
    const res = NextResponse.json({ ok: true })
    const opciones = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, maxAge: DURACION_SESION_S }
    res.cookies.set(nombreDeCookie(r.enlace.id), firmaDeSesion(r.enlace), { ...opciones, path: '/' })
    return res
  } catch (e) {
    console.error('[trafico] entrar', e)
    return NextResponse.json({ error: 'No se ha podido comprobar la clave. Prueba otra vez en un momento.' }, { status: 500 })
  }
}

/** Salir: borra la cookie */
export async function DELETE(request: NextRequest, { params }: { params: { token: string } }) {
  const { enlaceDelToken } = await import('@/lib/trafico/servidor')
  const e = await enlaceDelToken(params.token).catch(() => null)
  const res = NextResponse.json({ ok: true })
  if (e) res.cookies.set(nombreDeCookie(e.id), '', { path: '/', maxAge: 0 })
  return res
}
