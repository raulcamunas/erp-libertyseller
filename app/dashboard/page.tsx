import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { apps } from '@/lib/config/apps'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

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
    <div className="max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="heading-medium text-white mb-2">
          Aplicaciones Instaladas
        </h1>
        <p className="text-white/50">
          Selecciona una aplicación para comenzar
        </p>
      </div>

      {/* Grid de Apps */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {apps.map((app) => {
          const Icon = app.icon
          const isActive = app.status === 'active'
          
          return (
            <Link
              key={app.id}
              href={app.route}
              className="group"
            >
              <div className="glass-card p-6 h-full transition-all duration-300 hover:scale-[1.02] hover:border-[#FF6600]/30 cursor-pointer relative overflow-hidden">
                {/* Status Indicator */}
                {isActive && (
                  <div className="absolute top-4 right-4">
                    <div className="w-2 h-2 bg-[#FF6600] rounded-full animate-pulse" />
                  </div>
                )}

                {/* Icon */}
                <div className={cn(
                  "w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-colors",
                  isActive 
                    ? "bg-[#FF6600]/[0.1] text-[#FF6600]" 
                    : "bg-white/[0.05] text-white/50"
                )}>
                  <Icon className="h-6 w-6" />
                </div>

                {/* Title */}
                <h3 className="text-lg font-semibold text-white mb-1 group-hover:text-[#FF6600] transition-colors">
                  {app.name}
                </h3>

                {/* Description */}
                <p className="text-sm text-white/50 mb-3 line-clamp-2">
                  {app.description}
                </p>

                {/* Badge y Status */}
                <div className="flex items-center gap-2 mt-4">
                  {app.badge && (
                    <Badge variant="nuevo" className="text-xs">
                      {app.badge}
                    </Badge>
                  )}
                  {app.status === 'inactive' && (
                    <span className="text-xs text-white/30">Próximamente</span>
                  )}
                </div>
              </div>
            </Link>
          )
        })}
      </div>

      {/* Welcome Card */}
      <div className="mt-8 glass-card p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-white mb-1">
              Bienvenido, {profile.full_name || user.email}
            </h3>
            <p className="text-sm text-white/50">
              Has iniciado sesión correctamente en Liberty Seller Hub
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-white/50">Rol:</span>
            <Badge variant="nuevo" className="text-xs">
              {profile.role}
            </Badge>
          </div>
        </div>
      </div>
    </div>
  )
}
