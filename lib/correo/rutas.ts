import { NextResponse } from 'next/server'
import { fail, requireAppAccess, type AmazonSession } from '@/lib/amazon/api'
import { FALTA_MIGRACION_CORREO, esFaltaDeMigracion, type ResultadoDeSincronizacion } from './servidor'

/**
 * LO QUE COMPARTEN LAS RUTAS DE /api/correo — SOLO SERVIDOR.
 *
 * Estas rutas manejan la contraseña de un correo y el contenido de correos ajenos, así que NINGUNA reenvía el texto de
 * una excepción (ver el aviso de errorResponse en lib/amazon/api.ts): lo que sale a la pantalla son frases fijas.
 */

export const SIN_CACHE = { 'Cache-Control': 'no-store' }

/**
 * La puerta de TODAS las rutas de /api/correo: sesión iniciada y permiso de la app «Correo» (admin, o un employee con la
 * casilla). Un partner NO pasa aunque requireAppAccess lo deje: es una figura externa a la que el middleware solo abre
 * Clientes, Cuadro mensual y Reportes de 15 días, y el correo de la agencia no es de su incumbencia.
 */
export async function requerirCorreo(): Promise<AmazonSession | NextResponse> {
  const sesion = await requireAppAccess('correo')
  if (sesion instanceof NextResponse) return sesion
  if (sesion.role === 'partner') return fail(403, 'El correo del ERP es solo para el equipo de Liberty Seller.')
  return sesion
}

export const FALLO_GENERICO = 'No se ha podido completar la operación. Vuelve a intentarlo en un momento.'

/** Lo que se apunta de un fallo: el mensaje y el código, nunca el objeto entero (puede traer datos del servidor de correo) */
export function registrar(contexto: string, error: unknown): void {
  const e = error as { message?: unknown; code?: unknown; cause?: { code?: unknown } } | null
  console.error(contexto, {
    mensaje: typeof e?.message === 'string' ? e.message : 'sin mensaje',
    codigo: e?.code ?? e?.cause?.code ?? null,
  })
}

/** El fallo de una ruta, como respuesta: 503 con el nombre del fichero si falta la migración, 500 si no */
export function respuestaDeFallo(contexto: string, error: unknown): NextResponse {
  registrar(contexto, error)
  if (esFaltaDeMigracion(error)) return fail(503, FALTA_MIGRACION_CORREO)
  return fail(500, FALLO_GENERICO)
}

/** Un texto del cuerpo, recortado y con tope; null si no es texto o está vacío */
export function textoDe(valor: unknown, maximo: number): string | null {
  if (typeof valor !== 'string') return null
  const t = valor.trim().slice(0, maximo)
  return t === '' ? null : t
}

/** Lo que el navegador necesita saber de una lectura */
export function resumenDeLectura(lectura: ResultadoDeSincronizacion) {
  if (lectura.tipo === 'hecha') return { importados: lectura.importados, quedan: lectura.quedan, completo: lectura.completo }
  if (lectura.tipo === 'error') return { error: lectura.mensaje }
  return { error: null }
}
