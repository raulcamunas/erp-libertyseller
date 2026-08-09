import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { fetchAllTolerante } from '@/lib/supabase/paginacion'
import type { TargetCompany, CompanyProspect } from '@/lib/types/linkedin'
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

  // PAGINADAS Y EN PARALELO.
  //
  // Paginadas porque PostgREST corta a 1000 filas sin dar error: hoy hay 463
  // empresas y 512 prospectos, así que la mitad del tablero desaparecería en
  // silencio en cuanto la tabla cruzara el millar — y el que desaparece es un
  // prospecto al que nadie vuelve a llamar. El `.order('id')` de desempate es
  // obligatorio para paginar; comprobado contra la base real que NO cambia el
  // orden actual, porque ninguna de las dos tablas tiene created_at repetido.
  //
  // En paralelo porque son dos consultas independientes que antes iban una
  // detrás de otra: 116 + 119 ms medidos, que pasan a ser el máximo de los dos.
  //
  // TOLERANTE, no `fetchAll` a secas: el código de antes recogía el error y
  // seguía a propósito —`if (companiesError) { console.error(...) }`, sin
  // cortar— y pintaba el tablero con listas vacías. Con la versión que lanza,
  // una caída de PostgREST llevaba esta página a app/dashboard/error.tsx: un
  // cambio visible que nadie pidió. Se conserva el modo de fallo de antes.
  const [companies, prospects] = await Promise.all([
    fetchAllTolerante<TargetCompany>('target_companies', (desde, hasta) =>
      supabase
        .from('target_companies')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(desde, hasta)
    ),
    fetchAllTolerante<CompanyProspect>('company_prospects', (desde, hasta) =>
      supabase
        .from('company_prospects')
        .select('*')
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(desde, hasta)
    ),
  ])

  // Agrupar prospectos por empresa
  const companiesWithProspects = companies.map((company) => ({
    ...company,
    prospects: prospects.filter((p) => p.company_id === company.id),
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

      <LinkedInDashboard 
        initialCompanies={companiesWithProspects} 
        userRole={profile.role || 'employee'} 
      />
    </div>
  )
}

