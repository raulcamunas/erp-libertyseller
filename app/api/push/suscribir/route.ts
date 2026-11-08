import { NextResponse, type NextRequest } from 'next/server'
import { usuarioDeLaSesion, sinSesion } from '@/lib/push/sesion'
import { borrarSuscripcion, cambiarCategoria, enviarPrueba, guardarSuscripcion } from '@/lib/push/servidor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const cuerpoDe = async (request: NextRequest): Promise<Record<string, unknown>> => {
  const c = await request.json().catch(() => null)
  return c && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {}
}

/** Activa los avisos en este dispositivo: `{ suscripcion, categoria? }` */
export async function POST(request: NextRequest) {
  const usuario = await usuarioDeLaSesion()
  if (!usuario) return sinSesion()
  const c = await cuerpoDe(request)
  try {
    await guardarSuscripcion(usuario, c.suscripcion, c.categoria, request.headers.get('user-agent'))
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'No se ha podido activar' }, { status: 400 })
  }
}

/** Cambia qué avisos llegan a este dispositivo: `{ endpoint, categoria }` */
export async function PATCH(request: NextRequest) {
  const usuario = await usuarioDeLaSesion()
  if (!usuario) return sinSesion()
  const c = await cuerpoDe(request)
  if (typeof c.endpoint !== 'string') return NextResponse.json({ error: 'Falta el dispositivo' }, { status: 400 })
  await cambiarCategoria(usuario, c.endpoint, c.categoria)
  return NextResponse.json({ ok: true })
}

/** Desactiva los avisos en este dispositivo: `{ endpoint }` */
export async function DELETE(request: NextRequest) {
  const usuario = await usuarioDeLaSesion()
  if (!usuario) return sinSesion()
  const c = await cuerpoDe(request)
  if (typeof c.endpoint !== 'string') return NextResponse.json({ error: 'Falta el dispositivo' }, { status: 400 })
  await borrarSuscripcion(usuario, c.endpoint)
  return NextResponse.json({ ok: true })
}

/** Manda un aviso de prueba a los dispositivos de esta persona (`{ prueba: true }`) */
export async function PUT(request: NextRequest) {
  const usuario = await usuarioDeLaSesion()
  if (!usuario) return sinSesion()
  const c = await cuerpoDe(request)
  if (c.prueba !== true) return NextResponse.json({ error: 'Nada que hacer' }, { status: 400 })
  try {
    return NextResponse.json(await enviarPrueba(usuario))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'No se ha podido mandar la prueba' }, { status: 500 })
  }
}
