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
  /**
   * PENDIENTE DE DECISIÓN: EL REGISTRO SIGUE ABIERTO, Y ESTA LISTA NO ES DONDE
   * SE CIERRA.
   *
   * Que conste por escrito, porque ya se intentó cerrar por aquí y no sirvió:
   * quitar '/auth/signup' de este array NO IMPIDE NADA. Dos líneas más abajo
   * está `pathname.startsWith('/auth/')`, que vuelve a hacer pública toda la
   * carpeta. Comprobado contra el servidor compilado con la línea quitada y sin
   * cookie: GET /auth/signup seguía contestando 200 con el formulario «Crear
   * Cuenta», exactamente igual que antes. Un endurecimiento que no endurece es
   * peor que ninguno, porque hace creer que la puerta está cerrada.
   *
   * EL AGUJERO ES REAL: cualquiera con un correo se hace una cuenta y el
   * trigger handle_new_user le da rol `employee`, y un employee llega por
   * PostgREST —saltándose la interfaz— a finance_periods, finance_payments, los
   * ajustes de NÓMINA y los 512 contactos de company_prospects, porque esas
   * políticas solo piden estar autenticado.
   *
   * CERRARLO SON DOS COSAS, LAS DOS FUERA DE ESTE FICHERO, y las decide el
   * humano porque se notan usando la aplicación (quien abra /auth/signup pasa
   * de ver el formulario a ver un 404):
   *
   *   1. Borrar app/auth/signup/page.tsx.
   *   2. Apagar Authentication › Providers › Email › «Allow new users to sign
   *      up» en el panel de Supabase. Sin esto la 1 no vale: la clave anónima
   *      viaja en el bundle del navegador y con ella se llama directamente a
   *      /auth/v1/signup sin pasar por ninguna página nuestra.
   *
   * Crear cuentas desde Gestión de Usuarios seguiría funcionando: usa
   * auth.admin.createUser() con la clave de servicio, que es la API de
   * administración y no se ve afectada por ese ajuste.
   */
  /**
   * NO HAY REGISTRO. Las cuentas las crea un admin desde Gestión de Usuarios.
   *
   * Lo pidió Raúl expresamente: «solo quiero que los ADMINS puedan hacerse
   * cuenta, nadie puede hacerse cuenta salvo yo y Mario».
   *
   * Antes `/auth/signup` estaba aquí y la página existía, así que cualquiera
   * con un correo se hacía una cuenta y el trigger handle_new_user le daba rol
   * `employee`. Y un employee NO es inofensivo: la auditoría comprobó que llega
   * por PostgREST —saltándose la interfaz— a finance_periods, finance_payments,
   * los ajustes de NÓMINA y los 512 contactos de company_prospects, porque esas
   * políticas solo piden estar autenticado.
   *
   * ESTO ES SOLO LA MITAD DEL ARREGLO. La otra mitad está en el panel de
   * Supabase (Authentication › Providers › Email › «Allow new users to sign up»
   * apagado), porque la clave anónima viaja en el bundle del navegador y con
   * ella se llama directamente a /auth/v1/signup sin pasar por ninguna página
   * nuestra. Borrar la página sin ese ajuste no cierra nada.
   *
   * Crear cuentas desde Gestión de Usuarios sigue funcionando igual: usa
   * auth.admin.createUser() con la clave de servicio, que es la API de
   * administración y ese ajuste no la toca.
   */
  const publicRoutes = ['/auth/login', '/']
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
  if (user && pathname === '/auth/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  // Protección de rutas por rol
  if (user) {
    // Obtener el perfil del usuario
    //
    // El `error` se recoge y SE REGISTRA, pero NO cambia la decisión: si la
    // consulta falla se sigue cayendo a 'employee', que es el rol de menos
    // privilegio. Abrir puertas durante una caída de la base es lo contrario de
    // lo que se quiere.
    //
    // QUÉ PROBLEMA RESUELVE: hasta ahora el error se descartaba entero.
    // Comprobado levantando el ERP contra un Supabase de mentira que devolvía
    // 500 en /rest/v1/profiles: el servidor falso registró la petición del
    // middleware, y en el log del ERP no apareció NI UNA LÍNEA por su parte
    // —las 8 líneas de error que sí salieron eran todas de getUserProfile(),
    // que sí hace console.error—. Con la base caída, todo el mundo pasaba a
    // 'employee' y no quedaba rastro de por qué.
    const { data: profile, error: errorPerfil } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (errorPerfil) {
      console.error(
        '[middleware] no se ha podido leer el perfil de',
        user.id,
        'para',
        pathname,
        '- se sigue con el rol employee:',
        errorPerfil.message
      )
    }

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
        // Mismo criterio que arriba: el error se registra y la decisión no
        // cambia. Aquí un fallo de la consulta deja `profile` a null y el `if`
        // de abajo redirige, que es el lado seguro.
        const { data: profile, error: errorPerfilUsuarios } = await supabase
          .from('profiles')
          .select('email, role')
          .eq('id', user.id)
          .single()

        if (errorPerfilUsuarios) {
          console.error(
            '[middleware] no se ha podido leer el perfil de',
            user.id,
            'para /dashboard/users - se deniega:',
            errorPerfilUsuarios.message
          )
        }

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

      // Ruta /dashboard/limpieza-ofertas - Solo admin
      //
      // Desde ahí se BORRAN los límites de precio y las rebajas que un cliente
      // puso a mano, de forma masiva y sin deshacer. Es la pantalla con más
      // capacidad de destrozo del ERP.
      if (pathname.startsWith('/dashboard/limpieza-ofertas')) {
        if (userRole !== 'admin') {
          const url = request.nextUrl.clone()
          url.pathname = '/dashboard'
          return NextResponse.redirect(url)
        }
      }

      // Ruta /dashboard/entrais-test - Solo admin
      //
      // Aquí se usan las credenciales de un cliente contra el sistema de su
      // proveedor, y se ven sus PRECIOS DE COMPRA, que es de lo más sensible que
      // hay en su negocio. Mismo listón que Amazon API.
      if (pathname.startsWith('/dashboard/entrais-test')) {
        if (userRole !== 'admin') {
          const url = request.nextUrl.clone()
          url.pathname = '/dashboard'
          return NextResponse.redirect(url)
        }
      }

      // Ruta /dashboard/marketing-api - Solo admin
      //
      // Desde aquí se autoriza el acceso a la cuenta de PUBLICIDAD de un
      // cliente y se guardan sus refresh tokens. El mismo listón que Amazon
      // API: ni employees ni partners. El filtro de verdad son las políticas
      // RLS de la migración 148 —ads_connections no tiene NINGUNA, así que con
      // la clave anónima no se lee ni una fila— y el redirect del propio
      // page.tsx, que corre en el servidor. Esto evita el viaje.
      //
      // El id 'marketing-api' tiene que coincidir letra por letra con
      // lib/config/apps.ts y con APPS_SOLO_ADMIN. Si baila en uno, el módulo
      // queda invisible sin dar ningún error.
      if (pathname.startsWith('/dashboard/marketing-api')) {
        if (userRole !== 'admin') {
          const url = request.nextUrl.clone()
          url.pathname = '/dashboard'
          return NextResponse.redirect(url)
        }
      }

      // Ruta /dashboard/growth - Solo admin
      // Growth Partner: el trabajo sobre la cuenta de un cliente —sincronismo
      // de stock, Buy Box, FBM→FBA—. Desde ahí se ven los catálogos y los
      // precios de las tiendas de los CLIENTES y se gasta su cupo de la API de
      // Amazon, así que el listón es el mismo que en Amazon API: ni employees
      // ni partners.
      //
      // Como allí, el filtro de verdad son las políticas RLS y el
      // requireAmazonAdmin() de cada ruta de /api/plataforma: esto evita el
      // viaje y la pantalla vacía. startsWith para que cualquier submódulo que
      // se añada después quede cerrado desde el primer día, sin acordarse.
      //
      // El id 'growth' tiene que coincidir letra por letra con lib/config/apps.ts
      // y con APPS_SOLO_ADMIN. Si baila en uno, el módulo queda invisible sin
      // dar ningún error.
      //
      // CON UNA EXCEPCIÓN, Y SOLO UNA: quien tenga el permiso suelto
      // 'stock-sync' entra, y la página le enseña ÚNICAMENTE ese submódulo (ver
      // lib/growth/acceso.ts). Es la persona de operaciones, que sube el stock
      // dos veces por semana y que hasta la mudanza entraba por
      // /dashboard/stock-sync. No se le abre nada nuevo: se le devuelve la
      // pantalla que ya usaba. Sin esto se quedaba sin ninguna puerta y sin
      // ningún mensaje, con el permiso todavía puesto en la pantalla de
      // usuarios.
      if (pathname.startsWith('/dashboard/growth')) {
        let puedeEntrar = userRole === 'admin'

        if (!puedeEntrar && userRole === 'employee') {
          const { data: permisoStock } = await supabase
            .from('user_app_permissions')
            .select('can_access')
            .eq('user_id', user.id)
            .eq('app_id', 'stock-sync')
            .single()
          puedeEntrar = permisoStock?.can_access === true
        }

        if (!puedeEntrar) {
          const url = request.nextUrl.clone()
          url.pathname = '/dashboard'
          return NextResponse.redirect(url)
        }
      }

      // Ruta /dashboard/plataforma - Solo admin
      // Ya no es un módulo: la página redirige a la pestaña «Ingesta» de Amazon
      // API, que está cerrada igual. El gate se queda porque la dirección sigue
      // viva en marcadores y no tiene sentido dejar que un employee llegue a un
      // redirect que va a rebotarle de todas formas.
      if (pathname.startsWith('/dashboard/plataforma')) {
        if (userRole !== 'admin') {
          const url = request.nextUrl.clone()
          url.pathname = '/dashboard'
          return NextResponse.redirect(url)
        }
      }

      // Ruta /dashboard/disenos - Solo admin
      // El comparador de propuestas de rediseño. Dos motivos para cerrarlo, no
      // uno: la elección del diseño la toman los socios —enseñar tres ERP
      // posibles antes de que haya uno elegido siembra tres expectativas para
      // defraudar dos—, y además las maquetas llevan nombres reales de cuentas y
      // clientes de la agencia (con cifras y estados inventados), que es lo que
      // hace que se pueda juzgar una tabla de verdad.
      //
      // No entra en el mapa routeToAppId de más abajo ni en
      // user_app_permissions: no se puede conceder suelto, es admin o nada.
      // El filtro de verdad es el redirect del propio page.tsx, que corre en el
      // servidor; esto evita el viaje.
      if (pathname.startsWith('/dashboard/disenos')) {
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
          // Sincronismo de stock ya no es una app del menú: su pantalla vive
          // dentro de Growth Partner. Esta dirección sigue existiendo y
          // redirige, así que la entrada se queda para que un employee sin el
          // permiso siga rebotando aquí y no en el destino.
          //
          // OJO: Growth Partner es SOLO ADMIN, así que un employee CON el
          // permiso 'stock-sync' pasa este filtro y rebota en el gate de
          // /dashboard/growth. Es la consecuencia de mover el módulo, está
          // dicha en el informe y hay que decidirla: hoy quien sube el stock a
          // Amazon dos veces por semana es la persona de operaciones, y su rol
          // es 'employee'.
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

