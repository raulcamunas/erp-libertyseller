import type { createServiceClient } from '@/lib/supabase/service'
import { decryptToken, encryptToken, hasTokenKey } from '@/lib/amazon/crypto'

/**
 * LA CONTRASEÑA DE CADA BUZÓN — SOLO SERVIDOR.
 * ============================================
 * Hermano de lib/rendimiento/servidor.ts (la clave de Rinkel), con las mismas reglas:
 *
 *   1. Se guarda CIFRADA (AES-256-GCM, la pieza que cifra los tokens de Amazon) en una tabla cerrada al navegador.
 *      No se guarda ninguna huella ni resumen de la contraseña.
 *   2. NUNCA sale al navegador, ni se le devuelve a quien la escribió, ni a un supervisor.
 *   3. NUNCA se escribe en un registro ni en un mensaje de error.
 *   4. NO se recorta: hay contraseñas que terminan en espacio, y recortarlas es la forma de dejar un buzón sin poder
 *      entrar sin ninguna explicación.
 *
 * Va atada a su uso (`correo.password.v1`, el dato autenticado de GCM): una contraseña cifrada aquí no se descifra si
 * alguien la pega en la columna de otra cosa que use la misma clave del servidor, ni al revés.
 */

type Servicio = ReturnType<typeof createServiceClient>

const PROPOSITO = 'correo.password.v1'

/** Una contraseña de buzón tiene un tope razonable: más es una equivocación de pegado */
export const MAX_CONTRASENA = 256

export type LecturaDeContrasena = { password: string } | { sinContrasena: true } | { ilegible: true }

export async function guardarContrasena(service: Servicio, buzonId: string, password: string): Promise<{ ok: true } | { ok: false; motivo: 'sin_clave_de_cifrado' | 'vacia' | 'base' }> {
  if (typeof password !== 'string' || password === '' || password.length > MAX_CONTRASENA) return { ok: false, motivo: 'vacia' }
  if (!hasTokenKey()) return { ok: false, motivo: 'sin_clave_de_cifrado' }

  let cifrada: string
  try {
    cifrada = encryptToken(password, PROPOSITO)
  } catch {
    return { ok: false, motivo: 'sin_clave_de_cifrado' }
  }

  const { error } = await service
    .from('correo_credenciales')
    .upsert({ buzon_id: buzonId, secreto_cifrado: cifrada, actualizada_at: new Date().toISOString() }, { onConflict: 'buzon_id' })
  return error ? { ok: false, motivo: 'base' } : { ok: true }
}

/** La contraseña en claro, para usarla AHORA MISMO al abrir una conexión */
export async function leerContrasena(service: Servicio, buzonId: string): Promise<LecturaDeContrasena> {
  const { data, error } = await service.from('correo_credenciales').select('secreto_cifrado').eq('buzon_id', buzonId).maybeSingle()
  if (error) throw new Error('No se ha podido leer la contraseña guardada.', { cause: error })
  const fila = data as { secreto_cifrado: string } | null
  if (!fila) return { sinContrasena: true }
  try {
    return { password: decryptToken(fila.secreto_cifrado, PROPOSITO) }
  } catch {
    // Sin el texto del error: puede llevar material de lo descifrado
    return { ilegible: true }
  }
}

/** Borra la contraseña. Idempotente: borrar la que no hay no es un error */
export async function borrarContrasena(service: Servicio, buzonId: string): Promise<boolean> {
  const { error } = await service.from('correo_credenciales').delete().eq('buzon_id', buzonId)
  return !error
}

/** De estos buzones, cuáles tienen contraseña guardada (= están conectados) */
export async function buzonesConContrasena(service: Servicio, buzonIds: string[]): Promise<Set<string>> {
  if (buzonIds.length === 0) return new Set()
  const { data, error } = await service.from('correo_credenciales').select('buzon_id').in('buzon_id', buzonIds)
  if (error) throw new Error('No se han podido leer los buzones conectados.', { cause: error })
  return new Set(((data ?? []) as Array<{ buzon_id: string }>).map((f) => f.buzon_id))
}
