import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { InformesMarketing } from '@/components/marketing/InformesMarketing'

/**
 * /dashboard/marketing-ads — INFORMES MARKETING. SOLO ADMIN.
 *
 * Elegir una cuenta de anunciante, un rango de fechas y qué informes de Amazon
 * Ads se quieren. Sale un Excel con una pestaña por informe.
 *
 *
 * ============ LO QUE HABÍA AQUÍ ANTES ============
 *
 * Una revisión de campañas en vivo: tabla de campañas, panel de palabras clave,
 * panel de productos y un diario de cambios. Se ha retirado a petición — lo que
 * se necesita de esta pantalla es sacar los datos a Excel, no mirarlos aquí.
 *
 * Los componentes están en el historial de git (CampaignsTable, KeywordsPanel,
 * ProductsPanel, ChangesLog, MarketingBoard, TablaCampanas) y las tablas
 * `marketing_*` de la base NO se han tocado: siguen con todo lo que se anotó
 * cuando esto se llevaba a mano.
 *
 *
 * ============ ESTA PANTALLA NO ESPERA A AMAZON ============
 *
 * Los informes de la v3 de Ads tardan de diez segundos a varios minutos CADA
 * UNO, y una selección normal son diez o quince. No hay petición HTTP que
 * aguante eso, así que aquí se ENCARGAN: quedan apuntados, un proceso los va
 * empujando, y se vuelve a por el Excel cuando están.
 */
export const dynamic = 'force-dynamic'

export default async function InformesMarketingPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  /**
   * EL PERMISO DE LA APP, NO EL ROL.
   *
   * Aquí ponía `role !== 'admin'` y estaba mal, con un síntoma que no parece un
   * fallo de permisos: a quien tenía la app concedida le SALÍA en el menú, y al
   * pulsarla la pantalla la devolvía al dashboard sin decir nada. Se lee como
   * «el botón no va».
   *
   * `marketing-ads` está en el mapa `routeToAppId` del middleware, o sea que es
   * una app que SE PUEDE conceder a un employee — y de hecho se concede: quien
   * saca los informes de publicidad no es el admin. Un rol clavado aquí
   * contradice el reparto de permisos y gana siempre, porque va después.
   *
   * Se comprueba igualmente en vez de fiarse solo del middleware: una ruta que
   * se añada mal al mapa dejaría esta pantalla abierta, y desde aquí se ve el
   * gasto y las ventas de la cuenta de un cliente.
   */
  const perfil = await getUserProfile()
  if (!perfil) redirect('/auth/login')

  const esAdmin = perfil.role === 'admin' || perfil.role === 'partner'
  if (!esAdmin) {
    const { data: permiso } = await supabase
      .from('user_app_permissions')
      .select('can_access')
      .eq('user_id', user.id)
      .eq('app_id', 'marketing-ads')
      .maybeSingle()
    if (!permiso?.can_access) redirect('/dashboard')
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] p-4 space-y-3">
      <div>
        <h1 className="text-[18px] font-semibold text-white">Informes Marketing</h1>
        <p className="text-[12px] text-white/40">
          Los informes de Amazon Ads de un cliente, en el rango de fechas que elijas, y en un solo
          Excel con una pestaña por informe.
        </p>
      </div>
      <InformesMarketing />
    </div>
  )
}
