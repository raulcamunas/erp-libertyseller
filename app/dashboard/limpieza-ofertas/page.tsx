import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { createServiceClient } from '@/lib/supabase/service'
import { LimpiezaOfertas } from '@/components/ofertas/LimpiezaOfertas'

/**
 * /dashboard/limpieza-ofertas — SOLO ADMIN.
 *
 * Desde aquí se BORRAN los límites de precio y las rebajas que un cliente puso
 * a mano en su cuenta, de forma masiva. Es la pantalla con más capacidad de
 * destrozo del ERP, y por eso el filtro de rol es lo primero que hay.
 */
export const dynamic = 'force-dynamic'

export default async function LimpiezaOfertasPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const perfil = await getUserProfile()
  if (perfil?.role !== 'admin') redirect('/dashboard')

  const service = createServiceClient()
  const { data } = await service
    .from('amazon_connections')
    .select('id, name, marketplace_ids, marketplaces_activos, default_marketplace_id')
    .eq('is_active', true)
    .eq('status', 'activa')
    .order('name')

  return <LimpiezaOfertas conexiones={data ?? []} />
}
