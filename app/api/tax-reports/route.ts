import { NextResponse, type NextRequest } from 'next/server'
import { requireAppAccess } from '@/lib/auth/api'
import { errorResponse, fail } from '@/lib/amazon/api'
import { anioValido, leerVista } from '@/lib/tax-reports/datos'

/**
 * LA REJILLA DE UN ANO: CLIENTES, MESES Y QUE HAY COLGADO EN CADA CELDA.
 *
 *
 * ============ LA COMPROBACION EN LA PRIMERA LINEA, Y NO ES CEREMONIA ========
 *
 * middleware.ts mete `pathname.startsWith('/api/')` ENTERO en la lista de rutas
 * publicas —linea 41, y tiene que seguir asi porque por ahi entran los crons y
 * los webhooks sin cookie—. O sea que una ruta de este arbol que no compruebe
 * nada por dentro LE CONTESTA A CUALQUIERA DE INTERNET, y esta en concreto
 * dice que clientes tenemos y de que meses guardamos su informe fiscal. La
 * hermana de /ficheros/[id] devuelve directamente un enlace al fichero.
 *
 * Es lo mismo que acaba de pasar con los informes de comisiones en la 199, solo
 * que por PostgREST en vez de por una ruta.
 *
 *
 * ============ QUIEN ENTRA: EL PERMISO DE LA APP, NO EL ROL ============
 *
 * Era requireAdmin(), y eso dejaba el dia 3 sin poder hacerse: quien va cuenta
 * por cuenta adjuntando los informes es un empleado, y a un empleado esto le
 * contestaba 403 —y las RLS de la 200 tampoco le dejaban leer la rejilla—.
 *
 * Lo que NO vale en su lugar es «cualquier empleado». Esta ruta dice QUE
 * CLIENTES TENEMOS y de que meses guardamos su informe fiscal, y la hermana de
 * /ficheros/[id] devuelve un enlace al fichero, que lleva dentro la ciudad, el
 * codigo postal y el Order ID de los compradores de ese cliente. El corte es el
 * mismo que abre la pantalla: tener CONCEDIDA ESTA APP.
 *
 * El 'tax-reports' de aqui tiene que ser LETRA POR LETRA el de lib/config/apps.ts,
 * el del mapa routeToAppId de middleware.ts y el `app_id` que mira
 * public.puede_ver_tax_reports(uid) en la migracion 200. Si bailan, la pantalla
 * se abre y la API contesta 403, o al reves. El filtro de verdad son esas dos
 * ultimas cosas: esta solo evita el viaje.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const sesion = await requireAppAccess(
      'tax-reports',
      'No tienes acceso a Tax Reports. Pideselo a un administrador: se concede por usuario desde Usuarios.'
    )
    if (sesion instanceof NextResponse) return sesion

    const crudo = request.nextUrl.searchParams.get('anio')
    // Sin parametro, el ano en curso: es el que se mira el dia 3.
    const anio = crudo === null ? new Date().getFullYear() : anioValido(crudo)
    if (anio === null) {
      return fail(400, `«${crudo}» no es un ano. Tiene que ser un numero entre 2020 y 2100.`)
    }

    return NextResponse.json(await leerVista(anio))
  } catch (error) {
    return errorResponse(error, 'Error leyendo la rejilla de Tax Reports')
  }
}
