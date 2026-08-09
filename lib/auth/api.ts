import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * QUIÉN PUEDE LLAMAR A UNA RUTA DE /api QUE NO TIENE MÓDULO PROPIO.
 * ================================================================
 * SOLO SERVIDOR.
 *
 * EL AGUJERO QUE ESTE FICHERO TAPA
 * --------------------------------
 * middleware.ts, línea 41, mete `pathname.startsWith('/api/')` en la lista de
 * RUTAS PÚBLICAS. Eso es a propósito y tiene que seguir así —por ahí entran los
 * tres crons del contenedor, los dos webhooks de la web y los informes públicos
 * por enlace, que no tienen cookie de sesión—, pero significa que
 *
 *     UNA RUTA DE API QUE NO COMPRUEBE NADA POR DENTRO
 *     LE CONTESTA A CUALQUIERA DE INTERNET.
 *
 * No es teoría. Contra el código real, sin una sola cookie:
 *
 *     $ curl -X POST http://SERVIDOR/api/users/update -d '{}'
 *     {"error":"ID de usuario es requerido"}          <- HTTP 400, NUNCA 401
 *
 *     $ curl http://SERVIDOR/api/finance/balance
 *     {"success":true,"balances":[...],"balance":...}  <- HTTP 200, saldos de
 *                                                         la empresa en Wise
 *
 * El 400 del primero es de su PROPIA validación: la petición anónima ya había
 * pasado la puerta. Con el cuerpo bueno, esa ruta crea el cliente service_role
 * y llama a la API de administración de Supabase (ver la cabecera de
 * app/api/users/update/route.ts).
 *
 * LOS MÓDULOS QUE YA TENÍAN ESTO RESUELTO —y de los que se copia el patrón—
 * son lib/amazon/api.ts, lib/vacations/api.ts y lib/stock-sync/api.ts. Este
 * fichero es para las rutas sueltas que no pertenecen a ninguno de los tres.
 *
 * LA REGLA QUE NO SE NEGOCIA
 * --------------------------
 * El rol y el permiso se leen de la BASE DE DATOS con la sesión de quien llama,
 * NUNCA del cuerpo de la petición ni de una cabecera. Un `{"role":"admin"}` en
 * el JSON no convierte a nadie en admin.
 *
 * Y se consulta con la sesión del que llama, no con service_role: las políticas
 * de `profiles` y `user_app_permissions` ya dejan a cada uno leer lo suyo, así
 * que el rol de otra persona no se puede leer ni por error.
 */

export type AuthSupabase = Awaited<ReturnType<typeof createClient>>

export interface Sesion {
  supabase: AuthSupabase
  userId: string
  role: string
  isAdmin: boolean
}

/**
 * Error con forma de respuesta.
 *
 * Se DEVUELVE en vez de lanzarse para que en la ruta quede un `return` a la
 * vista —`if (sesion instanceof NextResponse) return sesion`— que es el mismo
 * gesto que ya hacen los otros tres módulos.
 */
export function fail(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status })
}

/**
 * Sesión iniciada, con el rol leído de la base de datos.
 *
 * QUÉ IMPIDE: que alguien SIN CUENTA en el ERP dispare la ruta desde internet.
 * Nada más. No comprueba rol ni permiso de módulo a propósito: casi todas las
 * rutas que pasan por aquí las usa hoy cualquier persona con sesión —las de
 * marketing cuelgan de /dashboard/marketing, que NO está en el mapa
 * `routeToAppId` de middleware.ts, así que hoy la abre cualquier employee—, y
 * exigir un permiso que hoy no se exige dejaría fuera a alguien que trabaja.
 *
 * Si un día se decide que una de esas pantallas tiene dueño, se sube el listón
 * aquí y en el mapa del middleware A LA VEZ, no en uno solo: si bailan, la
 * pantalla se abre y la API contesta 403, o al revés.
 *
 * El fallo es CERRADO por diseño: si la consulta de `profiles` no responde, el
 * rol se queda en 'employee' y quien exija admin no entra. Se prefiere dejar
 * fuera a un admin durante una caída antes que abrir la puerta durante una
 * caída.
 */
export async function requireSession(
  mensaje = 'Hay que iniciar sesión'
): Promise<Sesion | NextResponse> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail(401, mensaje)

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  // El error se registra pero NO cambia la decisión: sin perfil legible se cae
  // a 'employee', que es el rol de menos privilegio. Sin esta línea, una caída
  // de la consulta de perfiles degradaba a todo el mundo sin dejar ni un rastro
  // en el log de por qué.
  if (error) {
    console.error('[auth] no se ha podido leer el perfil de', user.id, error)
  }

  const role = profile?.role ?? 'employee'

  return { supabase, userId: user.id, role, isAdmin: role === 'admin' }
}

/**
 * Sesión iniciada Y rol admin.
 *
 * QUÉ IMPIDE: las tres rutas de /api/users, que son las que crean cuentas,
 * cambian roles y resetean contraseñas con service_role. Sin esto, un POST
 * anónimo con `{"userId":"<uid>","role":"admin"}` ascendía a quien quisiera, y
 * uno con `{"userId":"<uid>","password":"..."}` le cambiaba la contraseña a
 * cualquiera de los dos socios. Desde ahí se llega a los tokens de Amazon de
 * los 16 clientes, a los sueldos y a la tesorería.
 *
 * Ni employees ni partners. La pantalla que las usa —/dashboard/users— está
 * cerrada en middleware.ts a un admin CON un correo concreto, así que este
 * listón es más bajo que el de la pantalla y no deja fuera a nadie que hoy
 * entre. No se copia aquí la comprobación del correo a propósito: una lista de
 * correos repartida por el código es lo que hace que un cambio de cuenta rompa
 * cosas en sitios que nadie recuerda.
 */
export async function requireAdmin(
  mensaje = 'Solo un administrador puede hacer esto'
): Promise<Sesion | NextResponse> {
  const sesion = await requireSession()
  if (sesion instanceof NextResponse) return sesion
  if (!sesion.isAdmin) return fail(403, mensaje)
  return sesion
}

/**
 * Sesión iniciada y permiso para ESE módulo, con el mismo criterio que usa
 * middleware.ts para dejar abrir la pantalla: admin entra siempre, y al resto
 * se le pide la fila de `user_app_permissions`.
 *
 * QUÉ IMPIDE: que el permiso mande solo en la pantalla y no en la API. El
 * bloque de permisos por aplicación del middleware SOLO se evalúa sobre rutas
 * que empiezan por /dashboard: a /api/... no llega nunca. Sin esto, a alguien a
 * quien un admin nunca le dio Tesorería se le redirigía al abrir la pantalla,
 * pero un `GET /api/finance/balance` le devolvía igual los saldos de la
 * empresa. Es el mismo razonamiento —y la misma redacción— de
 * lib/vacations/api.ts.
 *
 * `appId` tiene que coincidir LETRA POR LETRA con lib/config/apps.ts y con el
 * mapa `routeToAppId` de middleware.ts. Si bailan, la pantalla se abre y la API
 * contesta 403.
 *
 * Un admin no pasa por la consulta: es quien reparte los permisos, y dejarlo
 * fuera de un módulo por una fila que falte en una tabla sería peor que el
 * problema que se está tapando.
 */
export async function requireAppAccess(
  appId: string,
  mensaje = 'No tienes acceso a este módulo'
): Promise<Sesion | NextResponse> {
  const sesion = await requireSession()
  if (sesion instanceof NextResponse) return sesion
  if (sesion.isAdmin) return sesion

  const { data: permiso } = await sesion.supabase
    .from('user_app_permissions')
    .select('can_access')
    .eq('user_id', sesion.userId)
    .eq('app_id', appId)
    .maybeSingle()

  if (!permiso?.can_access) return fail(403, mensaje)

  return sesion
}
