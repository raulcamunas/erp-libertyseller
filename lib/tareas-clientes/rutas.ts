import { NextResponse } from 'next/server'
import { exigirTareas, type PermisoTareas } from './acceso'
import { ErrorDeNotion } from './notion/cliente'
import { ErrorDeTareas } from './servidor'

/**
 * EL ENVOLTORIO DE TODAS LAS RUTAS DE TAREAS DE CLIENTES.
 *
 * Comprueba quién es y si tiene acceso, y convierte los errores en una respuesta que se puede enseñar: un fallo conocido sale con su motivo; uno que no se conoce, con un
 * mensaje general (el detalle va al registro del servidor y no al navegador).
 */

export type PermisoConcedido = Extract<PermisoTareas, { ok: true }>

export async function conPermiso(fn: (p: PermisoConcedido) => Promise<unknown>, estadoOk = 200): Promise<NextResponse> {
  const permiso = await exigirTareas()
  if (!permiso.ok) return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })
  try {
    return NextResponse.json(await fn(permiso), { status: estadoOk })
  } catch (e) {
    return respuestaDeError(e)
  }
}

export function respuestaDeError(e: unknown): NextResponse {
  if (e instanceof ErrorDeTareas) return NextResponse.json({ error: e.message }, { status: e.estado })
  if (e instanceof ErrorDeNotion) return NextResponse.json({ error: e.message }, { status: e.estado >= 400 && e.estado < 600 ? e.estado : 502 })
  console.error('Tareas de clientes:', e)
  return NextResponse.json({ error: 'No se ha podido completar la operación. Inténtalo otra vez.' }, { status: 500 })
}

/** El cuerpo JSON de la petición; si no es JSON válido, un objeto vacío (y la validación de cada ruta dirá qué falta) */
export async function cuerpoDe(request: Request): Promise<Record<string, unknown>> {
  const c = await request.json().catch(() => null)
  return c && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {}
}

export const actorDe = (p: PermisoConcedido) => ({ userId: p.userId, nombre: p.nombre, clientes: p.clientes })
