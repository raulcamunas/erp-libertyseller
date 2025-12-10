import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/Header'
import { LeadsTable } from '@/components/leads/LeadsTable'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import Link from 'next/link'

export default async function LeadsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const profile = await getUserProfile()

  if (!profile) {
    redirect('/auth/login')
  }

  // Obtener leads
  const { data: leads, error } = await supabase
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('Error fetching leads:', error)
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto">
        <Header />
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="heading-large text-white mb-2">
              Leads
            </h1>
            <p className="text-white/50">
              Gestiona todos tus leads y oportunidades
            </p>
          </div>
          <Link href="/dashboard/leads/new">
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Nuevo Lead
            </Button>
          </Link>
        </div>
        <div className="glass-card p-6">
          <LeadsTable leads={leads || []} />
        </div>
      </div>
    </div>
  )
}
