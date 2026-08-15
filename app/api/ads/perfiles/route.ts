import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { AdsError } from '@/lib/ads/oauth'
import { leerConexion, traerPerfiles } from '@/lib/ads/datos'

/**
 * VOLVER A PREGUNTARLE A AMAZON QUÉ CUENTAS TIENE ESTE CLIENTE.
 *
 * Se traen solas al conectar. Esto es para cuando eso falló, o cuando el cliente
 * abre una cuenta en otro país después: los perfiles no cambian casi nunca, así
 * que no hay ningún trabajo automático detrás — se pide a mano y ya está.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as { clienteId?: string }
    if (!body.clienteId || !UUID.test(body.clienteId)) {
      return fail(400, 'Falta el cliente.')
    }

    const conexion = await leerConexion(body.clienteId)
    if (!conexion) {
      return fail(400, 'Este cliente todavía no tiene conectada su cuenta de Amazon Ads.')
    }

    const perfiles = await traerPerfiles(conexion.id)
    return NextResponse.json({ perfiles })
  } catch (error) {
    if (error instanceof AdsError) return fail(400, error.message)
    console.error('Error trayendo los perfiles de Amazon Ads:', error)
    return fail(500, 'No se han podido traer los perfiles. Vuelve a intentarlo')
  }
}
