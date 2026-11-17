import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { BarraContabilidad } from '@/components/contabilidad/BarraContabilidad'
import { PanelContabilidad } from '@/components/contabilidad/PanelContabilidad'

/**
 * CONTABILIDAD · RESUMEN. La entrada del panel: de aquí se va a cada apartado (Tesorería, Facturas y cobros, Bancos, Pagos a empleados, Comisiones,
 * Tax Reports) con la barra de arriba. Los mismos que Tesorería y Facturación: administradores y socios.
 */
export default async function ContabilidadPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')
  if (profile.role !== 'admin' && profile.role !== 'partner') redirect('/dashboard')

  return (
    <div className="flex min-w-0 flex-col">
      <BarraContabilidad rol={profile.role} />
      <PanelContabilidad esAdmin={profile.role === 'admin'} />
    </div>
  )
}
