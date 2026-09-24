import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { APP_TAX_REPORTS } from '@/lib/config/apps'
import { PantallaTaxReports } from '@/components/tax-reports/PantallaTaxReports'
import { TITULO } from '@/lib/estilo/denso'

/**
 * TAX REPORTS — QUÉ FICHERO LE FALTA A CADA CLIENTE, MES A MES.
 *
 * Lo que sustituye: el día 3 de cada mes, abrir Seller Central cuenta por
 * cuenta, bajarse el fichero fiscal, dejarlo en una carpeta del escritorio y
 * acordarse de a cuáles ya les tocaba. Lo que no había forma de saber era CUÁL
 * FALTABA: la carpeta no contesta esa pregunta, y por eso se manda el correo con
 * el mes de antes o no se manda.
 *
 *
 * ============ YA NO ES SOLO ADMIN: ES EL PERMISO DE ESTA APP ============
 *
 * Nació cerrado a administradores, y eso era incompatible con para lo que
 * existe. Este trabajo —recorrer las cuentas el día 3 colgando el informe de
 * cada una— no lo hace un socio: lo hace la persona a la que se le encarga. Con
 * el gate de admin, o lo hacía un admin, o alguien le pasaba su sesión, que es
 * bastante peor que lo que el gate pretendía evitar.
 *
 * NO SE ABRE A CUALQUIER EMPLEADO, y la diferencia importa: entra quien tenga
 * concedida ESTA app en `user_app_permissions`. Un employee sin la casilla
 * marcada ni ve la entrada del menú ni pasa de aquí. Es el mismo corte que la
 * migración 189 hizo para el mapeo de stock —admin, o el permiso suelto que abre
 * el módulo—, y no `is_stock_team()` ni «rol employee», que serían TODO el
 * equipo interno.
 *
 * EL GATE SIGUE ESTANDO EN TRES CAPAS Y SOLO LA ÚLTIMA MANDA:
 *   1. lib/config/apps.ts, que decide si se pinta la tarjeta y la entrada del
 *      menú. Eso solo es pintura.
 *   2. Este redirect, que corre en el SERVIDOR y es el que ve quien llega
 *      tecleando la dirección.
 *   3. El requireAppAccess('tax-reports') de cada ruta de /api/tax-reports y las
 *      políticas de la migración 200. Es el único filtro que existe para quien
 *      no pasa por aquí: middleware.ts mete todo lo que empieza por /api/ en
 *      rutas públicas, así que una ruta que no comprobara nada le contestaría a
 *      cualquiera.
 *
 * Y NO SE ABRE PORQUE EL FICHERO SEA INOCUO. Dentro de un tax report de Amazon
 * hay, fila a fila, la ciudad, el código postal y el país de entrega de cada
 * pedido, el Order ID y el enlace a la factura del comprador: datos de los
 * COMPRADORES de nuestros clientes. Esta pantalla no los enseña —el fichero no
 * se abre ni se parsea en ningún sitio— pero sí reparte los enlaces con los que
 * se descargan. Por eso el permiso se concede a una persona concreta y no a un
 * rol entero.
 *
 * NO SE CARGA NADA AQUÍ A PROPÓSITO. La vista se pide desde el navegador a
 * /api/tax-reports, y no en esta función, porque la pantalla ya tiene que saber
 * recargarse sola después de cada subida —las rutas devuelven la vista entera— y
 * tener además una carga inicial por otro camino son dos formas distintas de
 * construir el mismo estado, que es como se llega a que después de subir un
 * fichero la lista diga una cosa y el contador de arriba otra.
 */
export default async function TaxReportsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')

  // Admin siempre —es quien reparte los permisos, y dejarlo fuera por una fila
  // que falte sería peor que el problema que se tapa—, y por lo demás solo quien
  // tenga concedida ESTA app. Un partner o un cliente no la tienen y rebotan.
  let puedeEntrar = profile.role === 'admin'
  if (!puedeEntrar) {
    const { data: permiso } = await supabase
      .from('user_app_permissions')
      .select('can_access')
      .eq('user_id', user.id)
      .eq('app_id', APP_TAX_REPORTS)
      .maybeSingle()
    puedeEntrar = permiso?.can_access === true
  }
  if (!puedeEntrar) redirect('/dashboard')

  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-2">
      <div className="min-w-0">
        <h1 className={TITULO.pantalla}>Tax Reports</h1>
        <p className={`${TITULO.entradilla} mt-[2px] max-w-[92ch]`}>
          Los clientes a la izquierda; al pinchar uno, a la derecha sus doce meses. El día 3 se
          recorre la lista de arriba abajo entrando en los que tengan meses en ámbar y colgando ahí
          el fichero de cada cuenta.
        </p>
      </div>

      <PantallaTaxReports />
    </div>
  )
}
