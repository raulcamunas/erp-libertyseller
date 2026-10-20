import { NextResponse } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { TEXTO_DE_ENLACE_NO_VALIDO, resolverEnlace, type ResolucionDeEnlace } from './encaje-enlace'
import { ipDe, limitar } from './limite-publico'

/**
 * LA PUERTA DE LAS RUTAS PÚBLICAS DEL ENCAJE.
 * ===========================================
 * SOLO SERVIDOR. Estas rutas no piden sesión —quien llega trae un enlace—, así que TODAS pasan por
 * aquí antes de hacer nada: se frena al que insiste de más y se comprueba el token. Lo que sale por
 * esta puerta es o un enlace comprobado o la respuesta de error ya montada.
 *
 * LO QUE NO SE CUENTA A QUIEN LLAMA: ni de qué parte falló la base ni qué mensaje dio Postgres. Una
 * ruta sin sesión que devuelve el texto de un error interno es un buzón de pistas. Aquí sale una frase
 * genérica y el detalle queda en el registro del servidor, sin el token.
 */

export type EnlaceComprobado = Extract<ResolucionDeEnlace, { ok: true }>

/** Cuántas peticiones por minuto, por IP y enlace, se aceptan en cada acción. Más de lo que teclea una persona */
export const PETICIONES_POR_MINUTO = { ver: 60, guardar: 120, terminar: 20 } as const

/** Y en total por IP, con cualquier enlace: lo que hace una persona con varias pestañas no se acerca a esto */
export const PETICIONES_POR_IP_POR_MINUTO = 300

export async function entrarConEnlace(request: Request, token: string, accion: keyof typeof PETICIONES_POR_MINUTO): Promise<EnlaceComprobado | NextResponse> {
  // Dos cuentas. Por IP y enlace: una pestaña que se vuelve loca no deja sin servicio al resto. Y por IP a secas:
  // quien prueba enlaces distintos uno tras otro cambia de cubo en cada intento y se saltaría la primera
  const ip = ipDe(request)
  const limite = limitar(`encajar|${accion}|${ip}|${token.slice(0, 8)}`, PETICIONES_POR_MINUTO[accion])
  const limiteDeLaIp = limitar(`encajar|todo|${ip}`, PETICIONES_POR_IP_POR_MINUTO)
  if (!limite.ok || !limiteDeLaIp.ok) {
    return NextResponse.json(
      { error: 'Demasiadas peticiones seguidas. Espera un momento y vuelve a probar.' },
      { status: 429, headers: { 'Retry-After': String(Math.max(limite.reintentarEnS, limiteDeLaIp.reintentarEnS)), 'Cache-Control': 'no-store' } }
    )
  }
  const r = await resolverEnlace(token)
  if (!r.ok) return fail(404, TEXTO_DE_ENLACE_NO_VALIDO[r.motivo])
  return r
}

/** Un fallo inesperado, dicho en una frase que no cuenta nada de dentro */
export function respuestaDeFalloInterno(error: unknown, contexto: string): NextResponse {
  // El detalle va al registro; no lleva el token, que no forma parte de ningún mensaje de error de la base
  console.error(`${contexto}:`, error instanceof Error ? error.message : error)
  return fail(500, 'No se ha podido completar. Vuelve a probar en un momento; si sigue fallando, avisa a Liberty Seller.')
}
