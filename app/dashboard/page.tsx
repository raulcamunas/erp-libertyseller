import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { redirect } from 'next/navigation'
import { apps, APPS_OCULTAS_A_ADMIN, APPS_SOLO_ADMIN, APP_GROWTH, puedeVerGrowth } from '@/lib/config/apps'
import { InicioApps } from '@/components/inicio/InicioApps'
import { primerNombre } from '@/lib/inicio/saludo'

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
    // El rol 'cliente' es gente de fuera: ve Remesas a FBA y absolutamente nada
    // más, ni el Inicio. El middleware ya le cierra las rutas; esto es para que
    // el menú no le enseñe puertas que no puede abrir.
    if (profile.role === 'cliente') return app.id === 'remesas'

    // Home siempre visible
    if (app.id === 'home') return true
    
    // Gestión de usuarios solo para admin específico
    if (app.id === 'users') {
      return profile.role === 'admin' && profile.email === 'raulcamunas369@gmail.com'
    }

    // Las apps de solo-admin, con el motivo de cada una escrito junto a la
    // lista en lib/config/apps.ts. Se comprueba ANTES del "para admins, acceso
    // a todo" de abajo para que ni un employee con el permiso suelto en
    // user_app_permissions las vea.
    if (APPS_SOLO_ADMIN.has(app.id)) {
      return profile.role === 'admin' && !APPS_OCULTAS_A_ADMIN.has(app.id)
    }

    // Las que el admin no usa. No es un permiso: el módulo sigue abierto y
    // quien lo tenga concedido lo sigue viendo. Ver APPS_OCULTAS_A_ADMIN.
    if (profile.role === 'admin' && APPS_OCULTAS_A_ADMIN.has(app.id)) return false

    // Growth Partner: admin, más quien tenga el permiso suelto 'stock-sync', que
    // dentro solo ve el sincronismo. Ver lib/growth/acceso.ts.
    if (app.id === APP_GROWTH) {
      return puedeVerGrowth(profile.role, userPermissions)
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

  // «Inicio» es esta misma pantalla: no se enseña su tarjeta. Cómo se pinta todo lo demás (cabecera, rejilla, movimiento) está en components/inicio
  return (
    <InicioApps
      nombre={primerNombre(profile.full_name, user.email)}
      rol={profile.role}
      apps={filteredApps.filter((app) => app.id !== 'home')}
    />
  )
}
