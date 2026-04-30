import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { notFound, redirect } from 'next/navigation'

export default async function MonthlyClosingsClientPage({
  params,
}: {
  params: { clientId: string }
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const profile = await getUserProfile()
  if (!profile) {
    redirect('/auth/login')
  }

  const { data: client, error: clientError } = await supabase
    .from('client_canvas')
    .select('id, name, created_by')
    .eq('id', params.clientId)
    .single()

  if (clientError || !client) {
    notFound()
  }

  if (profile.role !== 'admin') {
    const { data: membership, error: memberError } = await supabase
      .from('client_members')
      .select('id')
      .eq('client_id', params.clientId)
      .eq('user_id', user.id)
      .maybeSingle()

    const isCreator = client.created_by === user.id

    if (memberError) {
      console.error('Error checking client membership:', memberError)
    }

    if (!membership && !isCreator) {
      notFound()
    }
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="heading-medium text-white mb-2">Cuadro Mensual - {client.name}</h1>
        <p className="text-white/50">
          Aquí mostraremos el histórico de meses, subida de CSV y desglose por país.
        </p>
      </div>

      <div className="glass-card p-6">
        <div className="text-white/80 text-sm">
          Próximamente:
          <div className="mt-3 space-y-1 text-white/60">
            <div>- Subir CSV del mes</div>
            <div>- Tabla por meses (enero..diciembre) con ventas/devoluciones por país</div>
            <div>- Drilldown con desglose auditable</div>
          </div>
        </div>
      </div>
    </div>
  )
}
