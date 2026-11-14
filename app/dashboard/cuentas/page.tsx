import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { entraEnApp } from '@/lib/cuentas/acceso'
import { CuentasApp } from '@/components/cuentas/CuentasApp'

/**
 * /dashboard/cuentas — CUENTAS DE CLIENTES. Administradores y quien lleve cuentas con la casilla (lib/cuentas/acceso.ts).
 *
 * El centro de control desde el que un administrativo lleva una cuenta entera: la salud por área, qué toca esta semana del ciclo S1–S4, y una pestaña
 * de solo lectura por área (Marketing, SEO, Cumplimiento, Remesas) con un botón a cada herramienta. Los datos los pide la pantalla a /api/cuentas.
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
  const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? null : v ?? null)
  // ?c=slug abre el panel de ese cliente y ?t= la pestaña (resumen, marketing, seo, cumplimiento o remesas)
  return <CuentasApp clienteInicial={uno(searchParams.c)} pestanaInicial={uno(searchParams.t)} />
}
