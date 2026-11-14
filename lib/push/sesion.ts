import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/** Quién tiene la sesión abierta; las rutas de push son de cada persona y no piden más permiso que haber iniciado sesión */
export async function usuarioDeLaSesion(): Promise<string | null> {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  return data.user?.id ?? null
}

export const sinSesion = () => NextResponse.json({ error: 'Hay que iniciar sesión' }, { status: 401 })
