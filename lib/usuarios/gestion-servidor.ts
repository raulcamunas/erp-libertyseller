import { NextResponse } from 'next/server'
import { createClient as crearClienteSupabase, type SupabaseClient } from '@supabase/supabase-js'
import { fail, requireSession } from '@/lib/auth/api'
import { PUESTO_CEO } from '@/lib/usuarios/ceo'
import { puedeGestionarUsuarios, type PerfilParaGestion } from '@/lib/usuarios/gestion'

/**
 * LA PUERTA DE LAS RUTAS DE app/api/users — SOLO SERVIDOR.
 * ========================================================
 * Mismo criterio que la pantalla (lib/usuarios/gestion.ts: administrador pleno, no CEO, con el correo del dueño). El rol, el puesto y el correo se leen de la BASE con la sesión
 * de quien llama, nunca del cuerpo de la petición. Si la consulta falla, no se entra (fallo cerrado, como requireSession).
 */

export interface SesionDeGestor {
  userId: string
  /** Cliente con service_role: se salta la RLS. Solo después de pasar la puerta */
  servicio: SupabaseClient
}

export async function requireGestorDeUsuarios(mensaje = 'Solo el administrador del ERP puede gestionar usuarios'): Promise<SesionDeGestor | NextResponse> {
  const sesion = await requireSession()
  if (sesion instanceof NextResponse) return sesion
  if (!sesion.isAdmin || sesion.esCeo) return fail(403, mensaje)

  const { data: perfil, error } = await sesion.supabase.from('profiles').select('role, puesto, email').eq('id', sesion.userId).single()
  if (error || !puedeGestionarUsuarios(perfil as Pick<PerfilParaGestion, 'role' | 'puesto' | 'email'> | null)) return fail(403, mensaje)

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !clave) return fail(500, 'Error de configuración del servidor: faltan las claves de Supabase')

  const servicio = crearClienteSupabase(url, clave, { auth: { autoRefreshToken: false, persistSession: false } })
  return { userId: sesion.userId, servicio }
}

/** El perfil de la persona sobre la que se actúa (null si no existe) */
export async function leerPerfil(servicio: SupabaseClient, id: string): Promise<PerfilParaGestion | null> {
  const { data } = await servicio.from('profiles').select('id, role, puesto, email').eq('id', id).maybeSingle()
  return (data as PerfilParaGestion | null) ?? null
}

/** Cuántos administradores plenos (rol admin y no CEO) hay. Si la consulta falla devuelve 0: así ninguna baja de un admin pasa «por si acaso» */
export async function contarAdminsPlenos(servicio: SupabaseClient): Promise<number> {
  const { data, error } = await servicio.from('profiles').select('id, puesto').eq('role', 'admin')
  if (error || !data) return 0
  return (data as Array<{ puesto: string | null }>).filter((p) => p.puesto !== PUESTO_CEO).length
}
