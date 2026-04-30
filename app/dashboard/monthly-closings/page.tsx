import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import Link from 'next/link'

export default async function MonthlyClosingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const profile = await getUserProfile()
  if (!profile) {
    redirect('/auth/login')
  }

  let clients: Array<{ id: string; name: string; created_at?: string | null }> = []

  if (profile.role === 'admin') {
    const { data: allClients, error } = await supabase
      .from('client_canvas')
      .select('id, name, created_at')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching clients:', error)
    }
    clients = (allClients || []) as any
  } else {
    const { data: memberClients, error: memberError } = await supabase
      .from('client_members')
      .select('client_id')
      .eq('user_id', user.id)

    const { data: createdClients, error: createdError } = await supabase
      .from('client_canvas')
      .select('id')
      .eq('created_by', user.id)

    if (memberError || createdError) {
      console.error('Error fetching clients:', memberError || createdError)
    }

    const memberClientIds = new Set((memberClients || []).map((m: any) => m.client_id))
    const createdClientIds = new Set((createdClients || []).map((c: any) => c.id))
    const allClientIds = new Set([...memberClientIds, ...createdClientIds])
    const clientIdsArray = Array.from(allClientIds)

    if (clientIdsArray.length > 0) {
      const { data: allClients, error: clientsError } = await supabase
        .from('client_canvas')
        .select('id, name, created_at')
        .in('id', clientIdsArray)
        .order('created_at', { ascending: false })

      if (clientsError) {
        console.error('Error fetching clients:', clientsError)
      } else {
        clients = (allClients || []) as any
      }
    }
  }

  return (
    <div className="max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="heading-medium text-white mb-2">Cuadro Mensual</h1>
        <p className="text-white/50">
          Sube el CSV de cada mes y consulta el desglose por país, devoluciones y comisiones.
        </p>
      </div>

      <div className="glass-card p-6">
        <div className="text-white/80 text-sm">
          Selecciona un cliente para ver (y próximamente subir) sus cierres mensuales.
        </div>

        {clients.length === 0 ? (
          <div className="mt-4 text-white/60 text-sm">
            No tienes acceso a ningún cliente.
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {clients.map((c) => (
              <Link
                key={c.id}
                href={`/dashboard/monthly-closings/${c.id}`}
                className="glass-card px-4 py-3 hover:border-[#FF6600]/30 transition-colors"
              >
                <div className="text-white font-medium">{c.name}</div>
                <div className="text-white/50 text-xs">Abrir cuadro mensual →</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
