import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { apps } from '@/lib/config/apps'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'

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

  // Obtener permisos del usuario
  let userPermissions: Set<string> = new Set()
  
  // Si es admin, tiene acceso a todo
  if (profile.role === 'admin') {
    userPermissions = new Set(apps.map(app => app.id))
  } else if (profile.role === 'partner') {
    // Los partners solo tienen acceso a client-canvas (si son miembros de algún cliente)
    // Verificar si el partner es miembro de algún cliente
    const { data: memberClients } = await supabase
      .from('client_members')
      .select('client_id')
      .eq('user_id', user.id)
      .limit(1)
    
    if (memberClients && memberClients.length > 0) {
      userPermissions.add('client-canvas')
    }
  } else {
    // Si es employee, cargar permisos específicos
    const { data: permissions } = await supabase
      .from('user_app_permissions')
      .select('app_id')
      .eq('user_id', user.id)
      .eq('can_access', true)

    if (permissions) {
      userPermissions = new Set(permissions.map(p => p.app_id))
    }
  }

  // Filtrar apps según permisos
  const filteredApps = apps.filter(app => {
    // Home siempre visible
    if (app.id === 'home') return true
    
    // Gestión de usuarios solo para admin específico
    if (app.id === 'users') {
      return profile.role === 'admin' && profile.email === 'raulcamunas369@gmail.com'
    }

    // Control empleados solo para admin: son los sueldos de todo el equipo.
    // Se comprueba antes del "para admins, acceso a todo" de abajo para que
    // ni un employee con el permiso suelto en user_app_permissions lo vea.
    if (app.id === 'empleados') {
      return profile.role === 'admin'
    }

    // Amazon API solo para admin: desde ahí se cambian precios y stock en las
    // tiendas de los clientes. Mismo motivo que el de arriba para ir antes del
    // "para admins, acceso a todo": ni un employee con el permiso suelto en
    // user_app_permissions puede verlo.
    if (app.id === 'amazon-api') {
      return profile.role === 'admin'
    }

    // Diseños del ERP solo para admin: es una pantalla de decisión —enseñar tres
    // ERP posibles antes de que haya uno elegido siembra tres expectativas— y
    // además las maquetas llevan nombres reales de clientes de la agencia.
    if (app.id === 'disenos') {
      return profile.role === 'admin'
    }

    // Para admins, acceso a todo
    if (profile.role === 'admin') return true
    
    // Para partners, solo acceso a client-canvas si tienen permisos
    if (profile.role === 'partner') {
      return userPermissions.has(app.id)
    }
    
    // Para employees, verificar permisos
    return userPermissions.has(app.id)
  })

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
        {filteredApps.map((app) => {
          const Icon = app.icon

          return (
            <Link
              key={app.id}
              href={app.route}
              className="group"
            >
              <div className="glass-card p-6 h-full transition-all duration-300 hover:scale-[1.02] hover:border-[#FF6600]/30 cursor-pointer relative overflow-hidden">
                {/* Todos los iconos en naranja, sin punto de estado.
                    Antes el color y un punto parpadeante salían de app.status:
                    naranja los 'active' y gris apagado los 'new'. Como 'new' se
                    le pone a cada módulo recién hecho y nadie se lo quita
                    después, el efecto acababa siendo el contrario del que se
                    buscaba: lo más nuevo parecía lo apagado, y media rejilla
                    quedaba en gris sin que eso significara nada. */}
                <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 bg-[#FF6600]/[0.1] text-[#FF6600] transition-colors">
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
