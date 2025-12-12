import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { AppSidebar } from '@/components/layout/AppSidebar'
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
        <div className="p-6 lg:p-8 max-w-7xl mx-auto page-transition animate-fadeInUp">
          {children}
        </div>
      </main>
      <Toaster position="top-right" richColors />
    </div>
  )
}
