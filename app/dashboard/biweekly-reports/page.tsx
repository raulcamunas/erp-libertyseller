import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'

export default async function BiweeklyReportsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const profile = await getUserProfile()
  if (!profile) {
    redirect('/auth/login')
  }

  const { data: memberClients } = await supabase
    .from('client_members')
    .select('client_id')
    .eq('user_id', user.id)

  const memberClientIds = new Set((memberClients || []).map((m: any) => m.client_id))

  let clients: Array<{ id: string; name: string; created_by: string }> = []

  if (profile.role === 'admin') {
    const { data } = await supabase.from('client_canvas').select('id, name, created_by').order('name')
    clients = (data || []) as any
  } else {
    const { data } = await supabase.from('client_canvas').select('id, name, created_by').order('name')
    const all = (data || []) as any as Array<{ id: string; name: string; created_by: string }>
    clients = all.filter((c) => c.created_by === user.id || memberClientIds.has(c.id))
  }

  return (
    <div className="w-full">
      <div className="glass-card p-6">
        <h1 className="heading-medium text-white mb-2">Reportes 15 días</h1>
        <p className="text-white/50 mb-6">Selecciona un cliente para generar el reporte con los 3 CSVs de Sellerboard.</p>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {clients.map((c) => (
            <a
              key={c.id}
              href={`/dashboard/biweekly-reports/${c.id}`}
              className="glass-card-light border border-white/10 rounded-2xl p-4 hover:border-[#FF6600]/50 transition"
            >
              <div className="text-white font-semibold">{c.name}</div>
              <div className="text-white/40 text-xs mt-1">Abrir reporte</div>
            </a>
          ))}
        </div>

        {clients.length === 0 && (
          <div className="text-white/50 text-sm">No tienes clientes asignados.</div>
        )}
      </div>
    </div>
  )
}
