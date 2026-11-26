import { redirect } from 'next/navigation'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { TableroVentas } from '@/components/ventas/TableroVentas'
import { ResumenDeCuentas } from '@/components/ventas/ResumenDeCuentas'

/**
 * /dashboard/ventas — EL «SELLERBOARD» PROPIO (26 nov 2026): ventas, tarifas, publicidad y beneficio de cada cliente con los datos de su cuenta de Amazon.
 * Solo administradores (como Amazon API: son las cifras de negocio de los clientes). El filtro de verdad está en /api/ventas (requireAmazonAdmin).
 */
export const dynamic = 'force-dynamic'

export default async function VentasPage({ searchParams }: { searchParams: { cuenta?: string } }) {
  const perfil = await getUserProfile()
  if (!perfil) redirect('/auth/login')
  if (perfil.role !== 'admin') redirect('/dashboard')
  // Sin cuenta: todas las cuentas de un vistazo. Con ?cuenta=: el panel de esa cuenta
  const cuenta = typeof searchParams.cuenta === 'string' && /^[0-9a-f-]{36}$/i.test(searchParams.cuenta) ? searchParams.cuenta : null
  return cuenta ? <TableroVentas cuentaInicial={cuenta} /> : <ResumenDeCuentas />
}
