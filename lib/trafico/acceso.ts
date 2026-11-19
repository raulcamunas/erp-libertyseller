import type { NextRequest } from 'next/server'
import { enlaceDelToken, nombreDeCookie, sesionValida, type Enlace } from './servidor'

/** El enlace de la dirección, si es del tipo pedido y quien pide trae la cookie que deja la clave. null = 404; 'clave' = 401 */
export async function enlaceConSesion(request: NextRequest, token: string, tipo: 'trafico' | 'stock'): Promise<Enlace | null | 'clave'> {
  const e = await enlaceDelToken(token)
  if (!e || (e.tipo ?? 'trafico') !== tipo) return null
  return sesionValida(e, request.cookies.get(nombreDeCookie(e.id))?.value) ? e : 'clave'
}
