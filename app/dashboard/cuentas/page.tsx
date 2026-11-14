import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { entraEnApp } from '@/lib/cuentas/acceso'
import { CuentasApp } from '@/components/cuentas/CuentasApp'

/**
 * /dashboard/cuentas — CUENTAS DE CLIENTES. Administradores y quien lleve cuentas con la casilla (lib/cuentas/acceso.ts).
 *
 * El sitio desde el que un administrativo lleva una cuenta entera: qué toca esta semana del ciclo S1–S4, las cifras de publicidad, las tareas de SEO y
 * de cumplimiento, y un botón a cada herramienta. Los datos los pide la pantalla a /api/cuentas.
 */
export const dynamic = 'force-dynamic'

export default async function CuentasPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  const perfil = await getUserProfile()
  if (!perfil) redirect('/auth/login')
  if (!(await entraEnApp(supabase, user.id, perfil.role, perfil.puesto, 'cuentas'))) redirect('/dashboard')
  const c = searchParams.c
  return <CuentasApp clienteInicial={Array.isArray(c) ? c[0] ?? null : c ?? null} />
}
