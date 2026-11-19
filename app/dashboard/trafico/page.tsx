import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { AdminTrafico } from '@/components/trafico/AdminTrafico'

/** /dashboard/trafico — los enlaces de tráfico para clientes (migración 322). Solo administradores: dan acceso a datos de venta de un cliente a gente de fuera */
export const dynamic = 'force-dynamic'

export default async function PaginaAdminTrafico() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  const perfil = await getUserProfile()
  if (!perfil || perfil.role !== 'admin') redirect('/dashboard')
  return <AdminTrafico />
}
