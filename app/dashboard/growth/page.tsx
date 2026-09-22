import { redirect } from 'next/navigation'
import { Users } from '@/components/ui/iconos'
import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { clientesGrowth, elegirCliente, type ClienteGrowth } from '@/lib/growth/clientes'
import { modulosPermitidos, PERMISO_STOCK_SYNC } from '@/lib/growth/acceso'
import { Vacio } from '@/components/plataforma/comun'
import { Carcasa } from '@/components/growth/Carcasa'
import {
  moduloDesdeUrl,
  PARAM_CLIENTE,
  PARAM_MODULO,
  type ModuloId,
} from '@/components/growth/modulos'
import { InfoStockSync, PanelStockSync } from '@/components/growth/paneles/PanelStockSync'
import { InfoBuyBox, PanelBuyBox } from '@/components/growth/paneles/PanelBuyBox'
import { InfoFbmFba, PanelFbmFba } from '@/components/growth/paneles/PanelFbmFba'

/**
 * /dashboard/growth — GROWTH PARTNER. SOLO ADMIN.
 *
 * El TRABAJO sobre la cuenta de un cliente. Configurar con qué se trabaja es el
 * otro módulo, Amazon API, en /dashboard/amazon-api.
 *
 * Un selector de cliente arriba, común a todos los submódulos, y la elección
 * viaja en la dirección: cambiar de submódulo no olvida sobre quién estabas
 * trabajando.
 *
 *
 * ============ AÑADIR UN SUBMÓDULO SON DOS LÍNEAS ============
 *
 * Una entrada en MODULOS (components/growth/modulos.ts) y una entrada en el mapa
 * PANELES de aquí abajo. La auditoría de repricing llega después y tiene que
 * entrar así; si para meterla hay que rehacer la carcasa, es que la carcasa se ha
 * estropeado.
 *
 *
 * ============ POR QUÉ SOLO ADMIN ============
 *
 * Desde aquí se ven los catálogos, los precios y el stock de las tiendas de los
 * CLIENTES, y se gasta su cupo de la API de Amazon. El listón es el mismo que en
 * Amazon API: ni employees ni partners. Cerrado en tres sitios —middleware.ts,
 * APPS_SOLO_ADMIN de lib/config/apps.ts y el redirect de esta función, que corre
 * en el servidor— más las políticas RLS de cada tabla, que son las que mandan.
 *
 * CON UNA EXCEPCIÓN, Y SOLO UNA: el sincronismo de stock lo usa la persona de
 * OPERACIONES, cuyo rol es 'employee' y que tiene el permiso suelto
 * 'stock-sync'. Al mudarse el módulo aquí dentro se quedó sin ninguna puerta.
 * Ahora entra, y ve ÚNICAMENTE ese submódulo —ni Buy Box, ni FBM→FBA, ni el
 * catálogo—: es la pantalla que ya usaba, no un permiso nuevo. El porqué entero
 * está en lib/growth/acceso.ts, que es donde se decide y donde hay que mirar
 * antes de tocar esto.
 *
 *
 * ============ CUMPLIMIENTO ANTE AMAZON ============
 *
 * Todo cuelga de UN cliente y no hay ni una vista que mezcle, agregue o compare
 * varios. Los datos de un vendedor se usan exclusivamente para operar y asesorar
 * SU cuenta. Una consulta que agregue sin filtrar por cliente ya lo incumple.
 */

export const dynamic = 'force-dynamic'

/**
 * EL SUBMÓDULO -> SU PANTALLA Y SU EXPLICACIÓN.
 *
 * `Record<ModuloId, …>` y no un objeto suelto: si mañana se añade un id a MODULOS
 * y se olvida el panel, esto DEJA DE COMPILAR. Con un objeto normal, el botón se
 * pintaría y al pulsarlo no habría nada, sin dar ningún error.
 *
 * Los paneles son componentes de SERVIDOR: cada uno carga sus propios datos y
 * solo se ejecuta el del submódulo abierto. Entrar a mirar el stock no se trae
 * también el histórico de Buy Box.
 */
const PANELES: Record<
  ModuloId,
  {
    Panel: (props: { cliente: ClienteGrowth }) => React.ReactNode
    Info: () => React.ReactNode
  }
> = {
  'stock-sync': { Panel: PanelStockSync, Info: InfoStockSync },
  buybox: { Panel: PanelBuyBox, Info: InfoBuyBox },
  'fbm-fba': { Panel: PanelFbmFba, Info: InfoFbmFba },
}

export default async function GrowthPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')

  // Desde aquí se ven los datos de las cuentas de los clientes: admin, más la
  // persona de operaciones para SU submódulo de stock. El motivo entero, en
  // lib/growth/acceso.ts.
  let tienePermisoStock = false
  if (profile.role !== 'admin') {
    const { data: permisoStock } = await supabase
      .from('user_app_permissions')
      .select('can_access')
      .eq('user_id', user.id)
      .eq('app_id', PERMISO_STOCK_SYNC)
      .single()
    tienePermisoStock = permisoStock?.can_access === true
  }

  const permitidos = modulosPermitidos(profile.role, tienePermisoStock)
  if (permitidos.length === 0) redirect('/dashboard')

  const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

  // El submódulo pedido, ACOTADO a lo que esta persona puede ver. Sin esto, un
  // enlace a ?m=buybox le abriría la Buy Box a quien solo tiene el stock.
  const pedido = moduloDesdeUrl(uno(searchParams[PARAM_MODULO]))
  const modulo: ModuloId = permitidos.includes(pedido) ? pedido : permitidos[0]

  const clientes = await clientesGrowth()
  const cliente = elegirCliente(clientes, uno(searchParams[PARAM_CLIENTE]), modulo)

  const { Panel, Info } = PANELES[modulo]

  return (
    // El alto fijo con scroll interno es el patrón de las pantallas con tabla del
    // ERP. El `min-w-0` es el eslabón de esta pantalla en la cadena que mantiene
    // el scroll horizontal DENTRO de la tabla: sin él, una tabla ancha arrastra
    // la página de lado y se lleva la barra lateral por delante.
    <div className="flex flex-col h-[calc(100dvh-8rem)] lg:h-[calc(100vh-4rem)] min-w-0">
      <Carcasa
        clientes={clientes}
        cliente={cliente}
        modulo={modulo}
        modulos={permitidos}
        info={<Info />}
      >
        {cliente ? (
          <Panel cliente={cliente} />
        ) : (
          <Vacio icono={<Users />} titulo="Todavía no hay ningún cliente dado de alta">
            Los clientes y sus cuentas de Amazon se dan de alta en{' '}
            <strong>Amazon API · Cuentas</strong>. En cuanto uno esté, aparece aquí y se puede
            empezar a trabajar sobre él.
          </Vacio>
        )}
      </Carcasa>
    </div>
  )
}
