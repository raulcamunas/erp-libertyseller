import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { EntraisTest } from '@/components/entrais/EntraisTest'

/**
 * /dashboard/entrais-test — ENTRAIS TEST. SOLO ADMIN.
 *
 * Un cliente compra a este proveedor y nos han dado acceso a su API para sacar
 * sus productos, precios y stock. Esto es el banco de pruebas: se llama, se mira
 * el JSON y ya. Nada se guarda todavía.
 *
 * Solo admin porque aquí se usan las credenciales de un cliente contra el
 * sistema de su proveedor, y porque desde aquí se ven los precios de compra de
 * ese cliente — que es de lo más sensible que hay en su negocio.
 */
export const dynamic = 'force-dynamic'

export default async function EntraisTestPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const perfil = await getUserProfile()
  if (perfil?.role !== 'admin') redirect('/dashboard')

  return <EntraisTest />
}
