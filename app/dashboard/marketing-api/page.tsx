import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { createServiceClient } from '@/lib/supabase/service'
import { faltaConfigurar, urlDeVuelta } from '@/lib/ads/config'
import { leerConexion, listarPerfiles, type ConexionAds, type PerfilAds } from '@/lib/ads/datos'
import { MarketingApiBoard, type ClienteAds } from '@/components/marketing-api/MarketingApiBoard'

/**
 * /dashboard/marketing-api — MARKETING API. SOLO ADMIN.
 *
 * EL PRIMER LADRILLO, Y A PROPÓSITO SOLO ESO: conectar la cuenta de Amazon Ads
 * de un cliente y ver qué cuentas de anunciante tiene. Ni campañas, ni informes,
 * ni métricas.
 *
 * El orden importa y no es pereza: sin una autorización viva y sin un profileId
 * no se puede pedir NADA a la API de Ads —ese número va en la cabecera de todas
 * las llamadas—, así que cualquier estructura que se montara antes se montaría
 * sobre suposiciones. Primero el dato en crudo delante; la forma, después.
 *
 * Es un módulo APARTE de «Marketing», que es la revisión semanal a mano. Cuando
 * este traiga datos de verdad se decidirá si se fusionan o si el otro pasa a
 * beber de aquí.
 */
export const dynamic = 'force-dynamic'

export default async function MarketingApiPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const perfil = await getUserProfile()
  // Aquí se abre la puerta a la cuenta de publicidad de un cliente: el mismo
  // listón que Amazon API y Growth Partner.
  if (perfil?.role !== 'admin') redirect('/dashboard')

  const service = createServiceClient()
  const { data: filas } = await service
    .from('amazon_clients')
    .select('id, name')
    .order('name')

  const clientes: ClienteAds[] = []
  for (const fila of (filas ?? []) as Array<{ id: string; name: string }>) {
    const conexion: ConexionAds | null = await leerConexion(fila.id)
    const perfiles: PerfilAds[] = conexion ? await listarPerfiles(conexion.id) : []
    clientes.push({ id: fila.id, nombre: fila.name, conexion, perfiles })
  }

  return (
    <MarketingApiBoard
      clientes={clientes}
      urlDeVuelta={urlDeVuelta()}
      aviso={faltaConfigurar()}
    />
  )
}
