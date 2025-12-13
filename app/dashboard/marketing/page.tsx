import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { ClientCard } from '@/components/ppc/ClientCard'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

export default async function MarketingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const profile = await getUserProfile()

  if (!profile) {
    redirect('/auth/login')
  }

  // Obtener todos los clientes PPC
  const { data: clients, error } = await supabase
    .from('ppc_clients')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching PPC clients:', error)
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="heading-medium text-white mb-2">
            Liberty PPC Agency Hub
          </h1>
          <p className="text-white/50">
            Gestiona tus clientes y campañas PPC
          </p>
        </div>
        <Button
          asChild
          className="bg-[#FF6600] text-white hover:bg-[#FF6600]/90"
        >
          <Link href="/dashboard/marketing/new-client">
            <Plus className="h-4 w-4 mr-2" />
            Añadir Cliente
          </Link>
        </Button>
      </div>

      {/* Grid de Clientes */}
      {clients && clients.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {clients.map((client) => (
            <ClientCard key={client.id} client={client} />
          ))}
        </div>
      ) : (
        <div className="glass-card p-12 text-center">
          <p className="text-white/60 mb-4">
            No hay clientes PPC registrados aún
          </p>
          <Button
            asChild
            variant="outline"
            className="border-[#FF6600]/30 text-[#FF6600] hover:bg-[#FF6600]/10"
          >
            <Link href="/dashboard/marketing/new-client">
              <Plus className="h-4 w-4 mr-2" />
              Crear Primer Cliente
            </Link>
          </Button>
        </div>
      )}
    </div>
  )
}

