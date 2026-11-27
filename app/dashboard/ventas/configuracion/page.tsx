import { redirect } from 'next/navigation'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { ConfiguracionVentas } from '@/components/ventas/ConfiguracionVentas'

/**
 * /dashboard/ventas/configuracion — CONFIGURACIÓN (Sellerboard propio, 27 nov 2026): las cuentas del panel y los ajustes de cada una.
 * Solo administradores (el filtro de verdad está en /api/ventas).
 */
export const dynamic = 'force-dynamic'

export default async function ConfiguracionPage() {
  const perfil = await getUserProfile()
  if (!perfil) redirect('/auth/login')
  if (perfil.role !== 'admin') redirect('/dashboard')
  return <ConfiguracionVentas />
}
