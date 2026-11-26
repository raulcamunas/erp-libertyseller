import { redirect } from 'next/navigation'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { TableroVentas } from '@/components/ventas/TableroVentas'

/**
 * /dashboard/ventas — EL «SELLERBOARD» PROPIO (26 nov 2026): ventas, tarifas, publicidad y beneficio de cada cliente con los datos de su cuenta de Amazon.
 * Solo administradores (como Amazon API: son las cifras de negocio de los clientes). El filtro de verdad está en /api/ventas (requireAmazonAdmin).
 */
export const dynamic = 'force-dynamic'

export default async function VentasPage() {
  const perfil = await getUserProfile()
  if (!perfil) redirect('/auth/login')
  if (perfil.role !== 'admin') redirect('/dashboard')
  return <TableroVentas />
}
