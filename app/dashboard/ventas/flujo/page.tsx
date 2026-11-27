import { redirect } from 'next/navigation'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { FlujoDeCaja } from '@/components/ventas/FlujoDeCaja'

/**
 * /dashboard/ventas/flujo — FLUJO DE CAJA (Sellerboard propio, 27 nov 2026): los pagos de Amazon de cada liquidación y los apuntes a mano.
 * Solo administradores (el filtro de verdad está en /api/ventas/flujo).
 */
export const dynamic = 'force-dynamic'

export default async function FlujoPage() {
  const perfil = await getUserProfile()
  if (!perfil) redirect('/auth/login')
  if (perfil.role !== 'admin') redirect('/dashboard')
  return <FlujoDeCaja />
}
