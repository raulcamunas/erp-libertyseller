import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { TimeZonesDashboard } from '@/components/usos-horarios/TimeZonesDashboard'

export default async function UsosHorariosPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const profile = await getUserProfile()

  if (!profile) {
    redirect('/auth/login')
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="heading-medium text-white mb-2">
          Control de usos horarios
        </h1>
        <p className="text-white/50">
          México, Argentina y España (Madrid) en tiempo real
        </p>
      </div>
      <TimeZonesDashboard />
    </div>
  )
}
