import { NextResponse } from 'next/server'
import { fail, requireAppAccess, type AmazonSession } from '@/lib/amazon/api'
import { PERMISO_CONFIG_CORREOS } from '@/lib/config/apps'
import { FALTA_MIGRACION_CONFIGURACION, esFaltaDeConfiguracion } from './ia-laboratorio-servidor'
import { FALLO_GENERICO, registrar } from './rutas'

/**
 * LO QUE COMPARTEN LAS RUTAS DE /api/correo/laboratorio — SOLO SERVIDOR.
 *
 * Aquí se cambia lo que la IA le dice a los clientes de TODO el equipo, así que la puerta es el permiso «Configuración de la IA»
 * (un administrador entra siempre) y un partner no pasa aunque requireAppAccess lo deje: es una figura externa a la agencia.
 *
 * Ninguna ruta reenvía el texto de una excepción: lo que sale a la pantalla son frases fijas (puede traer parte de un correo o de un lead).
 */

export async function requerirConfigCorreos(): Promise<AmazonSession | NextResponse> {
  const sesion = await requireAppAccess(PERMISO_CONFIG_CORREOS)
  if (sesion instanceof NextResponse) return sesion
  if (sesion.role === 'partner') return fail(403, 'La configuración de correos es solo para el equipo de Liberty Seller.')
  return sesion
}

/** El fallo de una ruta, como respuesta: 503 con el nombre del fichero si falta la migración, 500 si no */
export function respuestaDeFalloDeConfiguracion(contexto: string, error: unknown): NextResponse {
  registrar(contexto, error)
  if (esFaltaDeConfiguracion(error)) return fail(503, FALTA_MIGRACION_CONFIGURACION)
  return fail(500, FALLO_GENERICO)
}

/** El cuerpo JSON de una petición, o null si no se entiende */
export async function leerJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const cuerpo = await request.json()
    return cuerpo && typeof cuerpo === 'object' && !Array.isArray(cuerpo) ? (cuerpo as Record<string, unknown>) : null
  } catch {
    return null
  }
}
