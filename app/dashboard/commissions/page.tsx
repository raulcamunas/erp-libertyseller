import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { CommissionsCalculator } from '@/components/commissions/CommissionsCalculator'
import { PanelComisiones } from '@/components/commissions/PanelComisiones'
import { CLIENTES_FUERA_DEL_PANEL } from '@/lib/comisiones-puente/tipos'

/**
 * COMISIONES.
 * Administradores: el panel nuevo (clientes a la izquierda con su comisión del mes, detalle a la derecha, y la calculadora de siempre
 * en «Subir CSV a mano»). Quien entra por el permiso de app 'commissions' sin ser admin sigue teniendo la calculadora de antes: el
 * panel enseña fees y comisiones de todos los clientes y escribe en Tesorería, y eso es solo de administración.
 */
export default async function CommissionsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const profile = await getUserProfile()

  if (!profile) {
    redirect('/auth/login')
  }

  // Cargar clientes (sin los que ya no se liquidan)
  const { data: todos } = await supabase
    .from('clients')
    .select('*')
    .order('name', { ascending: true })
  const clients = (todos || []).filter((c: { name: string }) => !CLIENTES_FUERA_DEL_PANEL.includes(c.name))

  const esAdmin = profile.role === 'admin'

  return (
    <div>
      <div className="mb-5">
        <h1 className="heading-medium text-white mb-2">
          {esAdmin ? 'Comisiones' : 'Calculadora de Comisiones'}
        </h1>
        <p className="text-white/50">
          {esAdmin
            ? 'Qué comisión toca a cada cliente cada mes, calculada con el informe que se sube a Tax Reports'
            : 'Procesa CSVs de Amazon/Sellerboard y calcula liquidaciones exactas'}
        </p>
      </div>
      {esAdmin ? <PanelComisiones clientesCalculadora={clients} /> : <CommissionsCalculator clients={clients} />}
    </div>
  )
}
