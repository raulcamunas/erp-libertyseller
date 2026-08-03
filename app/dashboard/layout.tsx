import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { AppSidebar } from '@/components/layout/AppSidebar'
import { NotificationsBell } from '@/components/layout/NotificationsBell'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
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
    <div className="min-h-screen bg-[var(--bg-color)] flex relative">
      <AppSidebar />
      {/* min-w-0: sin esto, un hijo ancho (una tabla de muchas columnas)
          estira el main y arrastra toda la página en horizontal, barra
          lateral incluida. Con esto, quien scrollea es la propia tabla. */}
      <main className="flex-1 min-w-0 lg:ml-64 transition-all duration-500 ease-in-out min-h-screen pt-16 lg:pt-0 relative z-10">
        {/* Header con notificaciones - fijo arriba a la derecha */}
        <div className="fixed top-4 right-16 lg:top-6 lg:right-20 z-50 flex items-center gap-2">
          <ThemeToggle />
          <NotificationsBell />
        </div>
        <div className="p-6 lg:p-8 w-full min-w-0 page-transition animate-fadeInUp">
          {children}
        </div>
      </main>
      <Toaster position="top-right" richColors />
    </div>
  )
}
