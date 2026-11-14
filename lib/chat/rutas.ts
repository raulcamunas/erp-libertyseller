import { NextResponse } from 'next/server'
import { exigirChat, type PermisoChat } from './acceso'
import { ErrorDeChat } from './servidor'

export type QuienChat = Extract<PermisoChat, { ok: true }>

/** El envoltorio de todas las rutas del chat: comprueba quién es y si tiene acceso, y convierte los errores en una respuesta que se puede enseñar */
export async function conChat(fn: (quien: QuienChat) => Promise<unknown>, estadoOk = 200): Promise<NextResponse> {
  const permiso = await exigirChat()
  if (!permiso.ok) return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })
  try {
    return NextResponse.json(await fn(permiso), { status: estadoOk })
  } catch (e) {
    if (e instanceof ErrorDeChat) return NextResponse.json({ error: e.message }, { status: e.estado })
    console.error('Chat:', e)
    return NextResponse.json({ error: 'No se ha podido completar la operación. Inténtalo otra vez.' }, { status: 500 })
  }
}

export async function cuerpoDe(request: Request): Promise<Record<string, unknown>> {
  const c = await request.json().catch(() => null)
  return c && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {}
}
