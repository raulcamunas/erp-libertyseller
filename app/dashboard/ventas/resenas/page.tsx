import { redirect } from 'next/navigation'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { PanelResenas } from '@/components/ventas/PanelResenas'

/**
 * /dashboard/ventas/resenas — RESEÑAS (Sellerboard propio, 26 nov 2026): las solicitudes de reseña de Amazon en automático, por cliente.
 * Sin ?cuenta=: todas las cuentas. Con ?cuenta=: sus campañas, su cola y sus pedidos. Solo administradores (el filtro de verdad está en /api/ventas/resenas).
 */
export const dynamic = 'force-dynamic'

export default async function ResenasPage({ searchParams }: { searchParams: { cuenta?: string } }) {
  const perfil = await getUserProfile()
  if (!perfil) redirect('/auth/login')
  if (perfil.role !== 'admin') redirect('/dashboard')
  const cuenta = typeof searchParams.cuenta === 'string' && /^[0-9a-f-]{36}$/i.test(searchParams.cuenta) ? searchParams.cuenta : null
  return <PanelResenas key={cuenta ?? 'todas'} cuentaInicial={cuenta} />
}
