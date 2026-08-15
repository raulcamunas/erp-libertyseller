import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { marcarPerfilEnUso } from '@/lib/ads/datos'

/**
 * DECIDIR QUÉ CUENTAS DE ANUNCIANTE SE TRABAJAN.
 *
 * Al conectar salen TODAS las cuentas a las que llega el correo que autorizó,
 * incluidas las de encargos viejos. Este interruptor es lo único que decide a
 * cuáles se les van a pedir informes y de cuáles se van a guardar datos.
 *
 * No es una preferencia de pantalla: es cupo de la API de Amazon y son datos de
 * un anunciante en nuestra base. De una cuenta que ya no es cliente no se
 * guarda nada.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as {
      perfilId?: string
      enUso?: boolean
    }

    if (!body.perfilId || !UUID.test(body.perfilId)) return fail(400, 'Falta el perfil.')
    if (typeof body.enUso !== 'boolean') return fail(400, 'Falta decir si se usa o no.')

    await marcarPerfilEnUso(body.perfilId, body.enUso)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Error marcando un perfil de Amazon Ads:', error)
    return fail(500, 'No se ha podido guardar. Vuelve a intentarlo')
  }
}
