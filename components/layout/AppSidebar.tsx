'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { 
  Home, 
  Users, 
  Settings, 
  LogOut,
  Menu,
  X,
  ChevronLeft,
  ChevronRight
} from 'lucide-react'
import { Logo } from '@/components/ui/Logo'
import { LogoutButton } from '@/components/auth/logout-button'
import { apps } from '@/lib/config/apps'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'

export function AppSidebar() {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const [userPermissions, setUserPermissions] = useState<Set<string>>(new Set())
  const [userRole, setUserRole] = useState<'admin' | 'employee' | null>(null)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    loadUserPermissions()
  }, [])

  const loadUserPermissions = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Obtener perfil del usuario
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, email')
        .eq('id', user.id)
        .single()

      if (profile) {
        setUserRole(profile.role)
        setUserEmail(profile.email)

        // Si es admin, tiene acceso a todo
        if (profile.role === 'admin') {
          setUserPermissions(new Set(apps.map(app => app.id)))
          return
        }

        // Si es employee, cargar permisos específicos
        const { data: permissions } = await supabase
          .from('user_app_permissions')
          .select('app_id')
          .eq('user_id', user.id)
          .eq('can_access', true)

        if (permissions) {
          setUserPermissions(new Set(permissions.map(p => p.app_id)))
        }
      }
    } catch (error) {
      console.error('Error loading permissions:', error)
    }
  }

  // Filtrar apps según permisos
  const filteredApps = apps.filter(app => {
    // Home siempre visible
    if (app.id === 'home') return true
    // Gestión de usuarios solo para admin específico
    if (app.id === 'users') {
      return userRole === 'admin' && userEmail === 'raulcamunas369@gmail.com'
    }
    // Para admins, acceso a todo
    if (userRole === 'admin') return true
    // Para employees, verificar permisos
    return userPermissions.has(app.id)
  })

  const isActive = (route: string) => {
    if (route === '/dashboard') {
      return pathname === '/dashboard'
    }
    return pathname.startsWith(route)
  }

  const toggleCollapse = () => {
    setIsCollapsed(!isCollapsed)
  }

  const toggleMobile = () => {
    setIsMobileOpen(!isMobileOpen)
  }

  return (
    <>
      {/* Mobile Menu Button */}
      <button
        onClick={toggleMobile}
        className="lg:hidden fixed top-4 left-4 z-50 p-2 glass-card border border-white/10 rounded-lg"
        aria-label="Toggle menu"
      >
        {isMobileOpen ? (
          <X className="h-5 w-5 text-white" />
        ) : (
          <Menu className="h-5 w-5 text-white" />
        )}
      </button>

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed left-0 top-0 h-full z-40 transition-all duration-300",
          "glass-card-light border-r border-white/10",
          "flex flex-col",
          isCollapsed ? "w-16" : "w-64",
          "lg:translate-x-0",
          isMobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        {/* Header con Logo */}
        <div className="p-4 border-b border-white/10 flex items-center justify-between">
          {!isCollapsed && (
            <Logo width={120} height={40} />
          )}
          {isCollapsed && (
            <div className="w-8 h-8 bg-[#FF6600] rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">LS</span>
            </div>
          )}
          <button
            onClick={toggleCollapse}
            className="hidden lg:flex p-1.5 rounded-lg hover:bg-white/[0.05] transition-colors"
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4 text-white/70" />
            ) : (
              <ChevronLeft className="h-4 w-4 text-white/70" />
            )}
          </button>
        </div>

        {/* Apps Menu */}
        <nav className="flex-1 overflow-y-auto py-4 px-2">
          <div className="space-y-1">
            {filteredApps.map((app) => {
              const Icon = app.icon
              const active = isActive(app.route)
              
              return (
                <Link
                  key={app.id}
                  href={app.route}
                  onClick={() => setIsMobileOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200",
                    "hover:bg-white/[0.05]",
                    active
                      ? "bg-[#FF6600]/[0.1] text-[#FF6600] border border-[#FF6600]/30"
                      : "text-white/70 hover:text-white"
                  )}
                  title={isCollapsed ? app.name : undefined}
                >
                  <Icon className={cn(
                    "h-5 w-5 flex-shrink-0",
                    active && "text-[#FF6600]"
                  )} />
                  {!isCollapsed && (
                    <>
                      <span className="flex-1 text-sm font-medium">{app.name}</span>
                      {app.badge && (
                        <span className="px-2 py-0.5 text-xs bg-[#FF6600] text-white rounded-full">
                          {app.badge}
                        </span>
                      )}
                    </>
                  )}
                </Link>
              )
            })}
          </div>
        </nav>

        {/* Footer con Gestión de Usuarios y Logout */}
        <div className="border-t border-white/10 p-4 space-y-1">
          <Link
            href="/dashboard/users"
            onClick={() => setIsMobileOpen(false)}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200",
              "text-white/70 hover:text-white hover:bg-white/[0.05]",
              isActive('/dashboard/users') && "bg-[#FF6600]/[0.1] text-[#FF6600]"
            )}
            title={isCollapsed ? "Gestión de usuarios" : undefined}
          >
            <Users className="h-5 w-5 flex-shrink-0" />
            {!isCollapsed && <span className="text-sm font-medium">Gestión de usuarios</span>}
          </Link>
          
          <div className={cn(
            "px-3 py-2.5",
            isCollapsed && "flex justify-center"
          )}>
            {isCollapsed ? (
              <button
                onClick={async () => {
                  await supabase.auth.signOut()
                  router.push('/auth/login')
                  router.refresh()
                }}
                className="p-2 rounded-xl hover:bg-white/[0.05] transition-colors w-full flex justify-center"
                title="Cerrar Sesión"
              >
                <LogOut className="h-5 w-5 text-white/70" />
              </button>
            ) : (
              <div className="w-full">
                <LogoutButton />
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Mobile Overlay */}
      {isMobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 backdrop-blur-sm z-30"
          onClick={toggleMobile}
        />
      )}
    </>
  )
}

