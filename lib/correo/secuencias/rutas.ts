import { NextResponse } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { FALLO_GENERICO, registrar } from '../rutas'
import { esFaltaDeMigracion } from '../servidor'
import { FALTA_LA_MIGRACION_245 } from './servidor'

/**
 * LO QUE COMPARTEN LAS RUTAS DE /api/correo/secuencias — SOLO SERVIDOR.
 * Igual que las de /api/correo: ninguna reenvía el texto de una excepción (lleva nombres de tablas y, a veces, trozos de correos de clientes).
 */

/** El fallo de una ruta de secuencias, como respuesta: 503 con el nombre del fichero si falta la migración 245, 500 si no */
export function respuestaDeFalloDeSecuencias(contexto: string, error: unknown): NextResponse {
  registrar(contexto, error)
  if (esFaltaDeMigracion(error)) return fail(503, FALTA_LA_MIGRACION_245)
  return fail(500, FALLO_GENERICO)
}

/** Un entero de un parámetro de la URL, dentro de un rango; el valor por defecto si falta o no vale */
export function enteroDeUrl(valor: string | null, defecto: number, minimo: number, maximo: number): number {
  if (valor === null || !/^\d{1,6}$/.test(valor)) return defecto
  return Math.min(Math.max(Number(valor), minimo), maximo)
}

/**
 * Un límite de peticiones por persona y por minuto, en la memoria del proceso. Sirve contra un bucle o un doble clic, no contra un ataque: el
 * contenedor es uno solo y las rutas ya exigen sesión. Devuelve true si se puede seguir.
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
