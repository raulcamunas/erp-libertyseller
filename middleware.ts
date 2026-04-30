import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refrescar sesión si está expirada
  const { data: { user } } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl

  // Rutas públicas (no requieren autenticación)
  const publicRoutes = ['/auth/login', '/auth/signup', '/']
  const isPublicRoute = publicRoutes.includes(pathname) ||
                       pathname.startsWith('/auth/') ||
                       pathname.startsWith('/api/') ||
                       pathname.startsWith('/report/commissions/') ||
                       pathname.startsWith('/audit/share/')

  // Si no hay usuario y no es ruta pública, redirigir a login
  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/auth/login'
    return NextResponse.redirect(url)
  }

  // Si hay usuario y está en login/signup, redirigir a dashboard
  if (user && (pathname === '/auth/login' || pathname === '/auth/signup')) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  // Protección de rutas por rol
  if (user) {
    // Obtener el perfil del usuario
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const userRole = profile?.role || 'employee'

    // Ruta /admin/* - Solo admins
    if (pathname.startsWith('/admin')) {
      if (userRole !== 'admin') {
        const url = request.nextUrl.clone()
        url.pathname = '/dashboard'
        return NextResponse.redirect(url)
      }
    }

    // Ruta /dashboard/* - Admins, employees y partners
    if (pathname.startsWith('/dashboard')) {
      if (userRole !== 'admin' && userRole !== 'employee' && userRole !== 'partner') {
        const url = request.nextUrl.clone()
        url.pathname = '/auth/login'
        return NextResponse.redirect(url)
      }

      // Ruta /dashboard/users - Solo admin con email específico
      if (pathname === '/dashboard/users') {
        const { data: profile } = await supabase
          .from('profiles')
          .select('email, role')
          .eq('id', user.id)
          .single()

        if (profile?.role !== 'admin' || profile?.email !== 'raulcamunas369@gmail.com') {
          const url = request.nextUrl.clone()
          url.pathname = '/dashboard'
          return NextResponse.redirect(url)
        }
      }

      // Protección para partners: solo pueden acceder a /dashboard/clients si son miembros
      if (userRole === 'partner' && pathname.startsWith('/dashboard/clients')) {
        const { data: memberClients } = await supabase
          .from('client_members')
          .select('client_id')
          .eq('user_id', user.id)
          .limit(1)
        
        if (!memberClients || memberClients.length === 0) {
          const url = request.nextUrl.clone()
          url.pathname = '/dashboard'
          return NextResponse.redirect(url)
        }
      }

      // Bloquear partners de otras rutas excepto /dashboard y /dashboard/clients
      if (
        userRole === 'partner' &&
        pathname !== '/dashboard' &&
        !pathname.startsWith('/dashboard/clients') &&
        !pathname.startsWith('/dashboard/monthly-closings')
      ) {
        const url = request.nextUrl.clone()
        url.pathname = '/dashboard'
        return NextResponse.redirect(url)
      }

      // Verificar permisos por aplicación (excepto para admins, partners y rutas especiales)
      if (userRole === 'employee' && pathname !== '/dashboard' && pathname !== '/dashboard/users') {
        // Mapear rutas a app_ids
        const routeToAppId: Record<string, string> = {
          '/dashboard/leads': 'leads',
          '/dashboard/web-leads': 'web-leads',
          '/dashboard/linkedin': 'linkedin',
          '/dashboard/finances': 'finances',
          '/dashboard/commissions': 'commissions',
          '/dashboard/monthly-closings': 'monthly-closings',
          '/dashboard/reports': 'reports',
          '/dashboard/documents': 'documents',
        }

        const appId = routeToAppId[pathname]
        if (appId) {
          // Verificar si el usuario tiene permiso para esta app
          const { data: permission } = await supabase
            .from('user_app_permissions')
            .select('can_access')
            .eq('user_id', user.id)
            .eq('app_id', appId)
            .single()

          // Si no tiene permiso explícito, denegar acceso
          if (!permission?.can_access) {
            const url = request.nextUrl.clone()
            url.pathname = '/dashboard'
            return NextResponse.redirect(url)
          }
        }
      }
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

