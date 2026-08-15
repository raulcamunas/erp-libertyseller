import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { asignarCliente } from '@/lib/ads/datos'

/**
 * DECIR DE QUÉ CLIENTE ES UNA CUENTA DE ANUNCIANTE.
 *
 * La autorización es de NUESTRA cuenta de agencia y bajo ella van apareciendo
 * los perfiles de cada cliente que nos da acceso. Esta asignación es lo único
 * que sabe de quién es cada uno.
 *
 * No es un adorno de organización: sin ella, el gasto de un anunciante acabaría
 * contabilizado en otro cliente. Los datos de un vendedor se usan exclusivamente
 * para operar su cuenta, y eso empieza por saber cuál es.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as {
      perfilId?: string
      clienteId?: string | null
    }

    if (!body.perfilId || !UUID.test(body.perfilId)) return fail(400, 'Falta el perfil.')

    // Cadena vacía y null son lo mismo: «quítale el cliente». Es lo que hace el
    // desplegable al elegir la opción de arriba.
    const clienteId = body.clienteId ? body.clienteId : null
    if (clienteId !== null && !UUID.test(clienteId)) return fail(400, 'Ese cliente no existe.')

    await asignarCliente(body.perfilId, clienteId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Error asignando el cliente de un perfil de Amazon Ads:', error)
    return fail(500, 'No se ha podido guardar. Vuelve a intentarlo')
  }
}
