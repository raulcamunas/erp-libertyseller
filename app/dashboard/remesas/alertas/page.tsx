import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import type { SesionFba } from '@/lib/fba/acceso'
import { leerPanelDeAlertas } from '@/lib/fba/alertas-lectura'
import { diaEnEspana } from '@/lib/fba/fechas'
import { PanelAlertas } from '@/components/remesas/alertas/PanelAlertas'

/**
 * ALERTAS FBA · EL TABLERO DE TODOS LOS CLIENTES.
 *
 * Lo que va mal en la logística de FBA —productos que se quedan sin stock antes de que llegue una reposición, envíos parados o recibidos de
 * menos, descuadres con Amazon, stock parado y antiguo—, de todos los clientes a la vez y lo más grave primero. Lo calcula una pasada diaria
 * (app/api/fba/cron-alertas); aquí solo se lee, así que se abre al instante.
 *
 * Es de la AGENCIA: un cliente de fuera, aunque entre en Remesas, vuelve a Remesas. Y cada persona de la agencia ve solo los clientes que
 * tiene en fba_accesos; un administrador, todos los que tienen Amazon conectado.
 */
export const dynamic = 'force-dynamic'

export default async function AlertasFbaPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const profile = await getUserProfile()
  if (!profile) redirect('/auth/login')
  if (profile.role === 'cliente') redirect('/dashboard/remesas')

  const esAdmin = profile.role === 'admin'
  let permitidos: string[] | null = null
  if (!esAdmin) {
    const { data } = await createServiceClient().from('fba_accesos').select('client_id').eq('user_id', user.id)
    permitidos = ((data ?? []) as Array<{ client_id: string }>).map((a) => a.client_id)
    if (permitidos.length === 0) redirect('/dashboard/remesas')
  }
  const sesion: SesionFba = { userId: user.id, role: profile.role, esAdmin, clientesPermitidos: permitidos, clientesEditables: permitidos }

  const panel = await leerPanelDeAlertas(sesion, diaEnEspana())
  return <PanelAlertas panel={panel} esAdmin={esAdmin} />
}
