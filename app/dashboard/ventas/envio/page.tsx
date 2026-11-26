import { redirect } from 'next/navigation'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { CostoDeEnvio } from '@/components/ventas/CostoDeEnvio'

/**
 * /dashboard/ventas/envio — COSTO DE ENVÍO (Sellerboard propio, 27 nov 2026): los perfiles de lo que cuesta mandar los pedidos FBM de cada cuenta.
 * Solo administradores (el filtro de verdad está en /api/ventas).
 */
export const dynamic = 'force-dynamic'

export default async function EnvioPage() {
  const perfil = await getUserProfile()
  if (!perfil) redirect('/auth/login')
  if (perfil.role !== 'admin') redirect('/dashboard')
  return <CostoDeEnvio />
}
