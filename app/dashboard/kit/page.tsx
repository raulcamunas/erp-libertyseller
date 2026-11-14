import { redirect } from 'next/navigation'
import { Muestrario } from '@/components/kit/Muestrario'
import { getUserProfile } from '@/lib/supabase/get-user-profile'

/**
 * KIT VISUAL · MUESTRARIO. Enseña todas las piezas de components/ui-ls con datos de mentira, para ver cómo quedan en los dos temas y en el móvil antes de usarlas en un
 * módulo. Solo administradores; no está en el menú (se entra escribiendo /dashboard/kit). No lee ni escribe nada en la base.
 */
export const dynamic = 'force-dynamic'

export default async function KitPage() {
  const perfil = await getUserProfile()
  if (!perfil) redirect('/auth/login')
  if (perfil.role !== 'admin') redirect('/dashboard')
  return <Muestrario />
}
