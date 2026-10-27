import { NextResponse, type NextRequest } from 'next/server'
import { fail, requireAppAccess } from '@/lib/amazon/api'
import { leerCuerpoConTope } from '@/lib/subidas-limite'
import { createServiceClient } from '@/lib/supabase/service'
import { puedeGestionarListas } from './listas-acceso'
import { aErrorDeListas } from './listas-servidor'

/**
 * LO QUE COMPARTEN LAS RUTAS DE /api/cold-calling/listas — SOLO SERVIDOR.
 *
 * Toda /api/ es pública para el middleware (cuelgan de ahí los crons y los webhooks), así que cada ruta tiene que comprobar por dentro quién llama. Aquí se hace una vez:
 * sesión iniciada, la app de Cold Calling concedida (administrador y partner la tienen siempre) y poder gestionar listas (administrador, partner o la casilla suelta
 * «Gestión de listas de leads»). El rol y el permiso se leen de la base con la sesión de quien llama, nunca del cuerpo de la petición.
 *
 * Las rutas hablan con la base con la clave de servicio: estas operaciones cambian el dueño de leads ajenos, cosa que el trigger de la migración 212 prohíbe desde el
 * navegador. Por eso lo que importa no es la RLS sino que NADIE llegue aquí sin permiso, y las funciones SQL lo vuelven a comprobar por dentro.
 */

export const SIN_CACHE = { 'Cache-Control': 'no-store' }

/** Lo más que ocupa lo que se manda: hasta 10.000 id de lead (39 bytes cada uno) y otros tantos excluidos caben de sobra */
export const MAX_BYTES_CUERPO = 1_000_000

export interface Gestor {
  userId: string
  role: string
  service: ReturnType<typeof createServiceClient>
}

export async function requerirGestorDeListas(): Promise<Gestor | NextResponse> {
  const sesion = await requireAppAccess('cold-calling')
  if (sesion instanceof NextResponse) return sesion
  if (!(await puedeGestionarListas(sesion.supabase, sesion.role, sesion.userId))) return fail(403, 'Solo quien gestiona las listas de leads puede hacer esto.')
  return { userId: sesion.userId, role: sesion.role, service: createServiceClient() }
}

/** El fallo de una ruta como respuesta: el estado y la frase que le tocan (nunca el texto técnico de la base) */
export function respuestaDeError(contexto: string, error: unknown): NextResponse {
  const e = aErrorDeListas(error)
  if (e.estado >= 500) console.error(contexto, { estado: e.estado })
  return NextResponse.json({ ok: false, error: e.message }, { status: e.estado, headers: SIN_CACHE })
}

/** El JSON del cuerpo, con tope de bytes. Un cuerpo que no es un objeto o que no se entiende es un 400 */
export async function leerCuerpoJson(request: NextRequest): Promise<Record<string, unknown> | NextResponse> {
  const cuerpo = await leerCuerpoConTope(request, MAX_BYTES_CUERPO)
  if (cuerpo instanceof NextResponse) return cuerpo
  try {
    const json = JSON.parse(cuerpo.texto) as unknown
    if (typeof json !== 'object' || json === null || Array.isArray(json)) return fail(400, 'No se ha entendido lo que se ha mandado')
    return json as Record<string, unknown>
  } catch {
    return fail(400, 'No se ha entendido lo que se ha mandado')
  }
}

/**
 * Un límite de peticiones por persona y por minuto, en la memoria del proceso. Sirve contra un bucle o un doble clic, no contra un ataque: el contenedor es uno solo y
 * las rutas ya exigen sesión y permiso. Devuelve true si se puede seguir.
 */
const ventanas = new Map<string, number[]>()
export function dentroDelLimite(clave: string, maximo: number, ventanaMs = 60_000, ahora = Date.now()): boolean {
  const recientes = (ventanas.get(clave) ?? []).filter((t) => ahora - t < ventanaMs)
  if (recientes.length >= maximo) {
    ventanas.set(clave, recientes)
    return false
  }
  recientes.push(ahora)
  ventanas.set(clave, recientes)
  if (ventanas.size > 2000) ventanas.clear()
  return true
}

export const DEMASIADAS_PETICIONES = 'Demasiadas peticiones seguidas. Espera un momento.'
