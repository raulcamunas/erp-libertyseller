import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect, notFound } from 'next/navigation'
import { ClientNavbar } from '@/components/ppc/ClientNavbar'

export default async function MarketingClientLayout({
  children,
  params,
}: {
  children: React.ReactNode
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

  // Verificar que el cliente existe
  const { data: client, error } = await supabase
    .from('ppc_clients')
    .select('*')
    .eq('id', params.clientId)
    .single()

  if (error || !client) {
    notFound()
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* Navbar Secundaria */}
      <ClientNavbar clientId={params.clientId} clientName={client.name} />

      {/* Contenido */}
      <div className="mt-6">
        {children}
      </div>
    </div>
  )
}

