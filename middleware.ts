import { createServerClient, type CookieOptions } from '@supabase/ssr'
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
        // CookieOptions, el tipo real de @supabase/ssr, en vez del `any` que
        // había: `options` lleva la caducidad, el dominio y los flags de la
        // cookie de sesión, y son justo los que hay que pasar tal cual.
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
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
                       pathname.startsWith('/audit/share/') ||
                       // OAuth de Amazon. Quien llega a estas dos direcciones es
                       // el CLIENTE desde su Seller Central, sin sesión en el
                       // ERP: mandarle al login rompe el flujo a mitad y él no
                       // tiene forma de saber qué ha pasado. Las dos URI están
                       // registradas en el portal de desarrollador de Amazon y
                       // no se pueden cambiar sin volver a pasar por allí.
                       pathname === '/connect' ||
                       pathname === '/callback'

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

      // Ruta /dashboard/empleados - Solo admin
      // Aquí está el sueldo de cada persona del equipo. A diferencia de
      // Tesorería, un partner tampoco entra: le basta con el total del mes,
      // que ya recibe por /api/employees/monthly-cost. El filtro de verdad son
      // las políticas RLS de la migración 111 (is_erp_admin); esto evita el
      // viaje y la pantalla vacía.
      if (pathname === '/dashboard/empleados') {
        if (userRole !== 'admin') {
          const url = request.nextUrl.clone()
          url.pathname = '/dashboard'
          return NextResponse.redirect(url)
        }
      }

      // Ruta /dashboard/amazon-api - Solo admin
      // Desde aquí se cambian precios y stock en las tiendas de los CLIENTES, y
      // se guardan las llaves de acceso a esas tiendas. El listón es el mismo
      // que en Control empleados: ni employees ni partners. El filtro de verdad
      // son las políticas RLS de la migración 118 (is_erp_admin, y la tabla de
      // conexiones sin ningún permiso para `authenticated`); esto evita el viaje
      // y la pantalla vacía.
      //
      // startsWith y no una comparación exacta: cualquier subruta que se añada
      // después queda cerrada desde el primer día, sin tener que acordarse.
      //
      // No hace falta en el mapa routeToAppId de más abajo —ese bloque solo se
      // evalúa para `employee`, y un employee ya no ha llegado hasta aquí—,
      // igual que pasa con 'empleados'. El id 'amazon-api' sí tiene que
      // coincidir letra por letra con lib/config/apps.ts y con el INSERT de la
      // migración 118.
      if (pathname.startsWith('/dashboard/amazon-api')) {
        if (userRole !== 'admin') {
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
        !pathname.startsWith('/dashboard/monthly-closings') &&
        !pathname.startsWith('/dashboard/biweekly-reports')
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
          '/dashboard/biweekly-reports': 'biweekly-reports',
          '/dashboard/horas': 'horas',
          '/dashboard/cold-calling': 'cold-calling',
          '/dashboard/marketing-ads': 'marketing-ads',
          '/dashboard/stock-sync': 'stock-sync',
          '/dashboard/reports': 'reports',
          '/dashboard/documents': 'documents',
          // Vacaciones va aquí y no en el bloque de solo-admin de arriba: es la
          // pantalla del equipo, cada uno ve SU saldo y SUS peticiones y no
          // lleva ningún dato salarial. El permiso lo reparte la migración 116
          // a admins y employees; el filtro de verdad son sus políticas RLS.
          '/dashboard/vacaciones': 'vacaciones',
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

