import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

export default async function DashboardPage() {
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
    <div className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto">
        <Header />
        <div className="flex justify-between items-center mb-8">
          <h1 className="heading-large text-white">
            Dashboard
          </h1>
          {profile.role === 'admin' && (
            <Link href="/admin">
              <Button variant="glass">
                Panel Admin
              </Button>
            </Link>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Bienvenido</CardTitle>
              <CardDescription>
                {user.email}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-white/70 mb-4">
                Has iniciado sesión correctamente en Liberty Seller Hub.
              </p>
              <div className="flex items-center gap-2">
                <span className="text-sm text-white/50">Rol:</span>
                <span className="label-uppercase text-[#FF6600] bg-[#FF6600]/10 px-3 py-1 rounded-full">
                  {profile.role}
                </span>
              </div>
              {profile.full_name && (
                <p className="text-white/70 mt-2">
                  {profile.full_name}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
