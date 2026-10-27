import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { FaltaLaMigracion } from './almacen'

/**
 * LO COMÚN DE LAS RUTAS DE LAS NOTAS DE GEMINI: QUIÉN PUEDE Y QUÉ SE CONTESTA CUANDO ALGO FALLA.
 * ===============================================================================================
 * Sincronizar, volver a analizar y asignar una nota a otro cliente son cosas de DIRECCIÓN (admin o partner), igual que editar una ficha del CRM: gastan dinero de la IA o
 * cambian a quién pertenece una reunión. Quien solo supervisa al equipo comercial puede LEER las notas (RLS de la 258), no tocarlas.
 */

export const SIN_CACHE = { 'Cache-Control': 'no-store' } as const

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function fallo(estado: number, error: string): NextResponse {
  return NextResponse.json({ ok: false, error }, { status: estado, headers: SIN_CACHE })
}

/** Dirección, o la respuesta con que se le cierra la puerta */
export async function requerirDireccion(): Promise<{ userId: string } | NextResponse> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fallo(401, 'No has iniciado sesión.')
  const { data: perfil } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (perfil?.role !== 'admin' && perfil?.role !== 'partner') return fallo(403, 'Esto solo lo puede hacer dirección.')
  return { userId: user.id }
}

/** Un fallo inesperado -> una respuesta que se entiende, sin soltar detalles del servidor. Si falta la migración, dice cuál */
export function respuestaDeFallo(contexto: string, error: unknown): NextResponse {
  if (error instanceof FaltaLaMigracion) return fallo(409, error.message)
  console.error(`[crm-gemini] ${contexto}:`, (error as Error)?.message ?? error)
  return fallo(500, 'No se ha podido completar. Prueba otra vez en un momento.')
}
