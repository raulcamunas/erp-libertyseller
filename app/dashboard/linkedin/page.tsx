import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { LinkedInDashboard } from '@/components/linkedin/LinkedInDashboard'
import { LinkedInHeaderButton } from '@/components/linkedin/LinkedInHeaderButton'

export default async function LinkedInPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const profile = await getUserProfile()

  if (!profile) {
    redirect('/auth/login')
  }

  // Obtener empresas con sus prospectos
  const { data: companies, error: companiesError } = await supabase
    .from('target_companies')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false })

  if (companiesError) {
    console.error('Error fetching companies:', companiesError)
  }

  // Obtener todos los prospectos
  const { data: prospects, error: prospectsError } = await supabase
    .from('company_prospects')
    .select('*')
    .order('created_at', { ascending: false })

  if (prospectsError) {
    console.error('Error fetching prospects:', prospectsError)
  }

  // Agrupar prospectos por empresa
  const companiesWithProspects = (companies || []).map((company) => ({
    ...company,
    prospects: (prospects || []).filter((p) => p.company_id === company.id),
  }))

  return (
    <div className="linkedin-module">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="heading-medium text-white mb-2">
            LinkedIn Prospección
          </h1>
          <p className="text-white/50">
            Hub de monitoreo de prospectos en LinkedIn
          </p>
        </div>
        <LinkedInHeaderButton />
      </div>

      <LinkedInDashboard initialCompanies={companiesWithProspects} />
    </div>
  )
}

