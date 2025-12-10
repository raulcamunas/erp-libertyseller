import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Header } from '@/components/layout/Header'

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  const profile = await getUserProfile()

  if (!profile || profile.role !== 'admin') {
    redirect('/dashboard')
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto">
        <Header />
        <h1 className="heading-large text-white mb-8">
          Panel de Administración
        </h1>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Bienvenido, Admin</CardTitle>
              <CardDescription>
                {user.email}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-white/70">
                Tienes acceso completo al sistema como administrador.
              </p>
              <div className="mt-4">
                <span className="label-uppercase text-[#FF6600] bg-[#FF6600]/10 px-3 py-1 rounded-full">
                  {profile.role}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

