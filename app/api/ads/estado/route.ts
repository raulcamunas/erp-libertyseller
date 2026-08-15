import { NextResponse } from 'next/server'
import { fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { createServiceClient } from '@/lib/supabase/service'
import { faltaConfigurar, urlDeVuelta } from '@/lib/ads/config'
import {
  clientesDeMarketing,
  leerConexion,
  listarPerfiles,
  type ConexionAds,
  type PerfilAds,
} from '@/lib/ads/datos'

/**
 * TODO LO QUE NECESITA LA PESTAÑA DE PUBLICIDAD, EN UNA LLAMADA.
 *
 * La pestaña vive dentro de Amazon API, cuya carcasa reparte a todos los
 * paneles un `AmazonView` común. Meter aquí dentro las conexiones de Ads
 * obligaría a que ese objeto —que se carga en CADA visita a Amazon API, para
 * las nueve pestañas— arrastrara también esto. Se pide aparte y solo cuando se
 * abre esta pestaña.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const service = createServiceClient()
    const { data: filas } = await service
      .from('amazon_clients')
      .select('id, name')
      .order('name')

    const clientes: Array<{
      id: string
      nombre: string
      conexion: ConexionAds | null
      perfiles: PerfilAds[]
    }> = []

    for (const fila of (filas ?? []) as Array<{ id: string; name: string }>) {
      const conexion = await leerConexion(fila.id)
      const perfiles = conexion ? await listarPerfiles(conexion.id) : []
      clientes.push({ id: fila.id, nombre: fila.name, conexion, perfiles })
    }

    return NextResponse.json({
      clientes,
      clientesMarketing: await clientesDeMarketing(),
      urlDeVuelta: urlDeVuelta(),
      aviso: faltaConfigurar(),
    })
  } catch (error) {
    console.error('Error cargando el estado de Amazon Ads:', error)
    return fail(500, 'No se ha podido cargar el estado de las conexiones de publicidad')
  }
}
