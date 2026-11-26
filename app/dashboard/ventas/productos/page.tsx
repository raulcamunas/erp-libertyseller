import { redirect } from 'next/navigation'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { ProductosVentas } from '@/components/ventas/ProductosVentas'

/** /dashboard/ventas/productos — como «Productos» de Sellerboard: el COGS editable de cada producto, su beneficio por unidad y su velocidad de venta. Solo administradores */
export const dynamic = 'force-dynamic'

export default async function ProductosVentasPage() {
  const perfil = await getUserProfile()
  if (!perfil) redirect('/auth/login')
  if (perfil.role !== 'admin') redirect('/dashboard')
  return <ProductosVentas />
}
