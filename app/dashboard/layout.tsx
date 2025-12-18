import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { NotificationsBell } from '@/components/layout/NotificationsBell'
import { Toaster } from '@/components/ui/sonner'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
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

  return (
    <div className="min-h-screen bg-[#080808] flex relative">
      <AppSidebar />
      <main className="flex-1 lg:ml-64 transition-all duration-500 ease-in-out min-h-screen pt-16 lg:pt-0 relative z-10">
        {/* Header con notificaciones - fijo arriba a la derecha */}
        <div className="fixed top-4 right-4 lg:top-6 lg:right-8 z-50">
          <NotificationsBell />
        </div>
        <div className="p-6 lg:p-8 w-full page-transition animate-fadeInUp">
          {children}
        </div>
      </main>
      <Toaster position="top-right" richColors />
    </div>
  )
}
