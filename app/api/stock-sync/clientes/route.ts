import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, fail, readText, requireAmazonAdmin } from '@/lib/amazon/api'
import { altaDesdeAmazon, loadPerfiles, marcarNoSincroniza } from '@/lib/stock-sync/perfiles'

/**
 * DAR DE ALTA EN EL SINCRONISMO A UN CLIENTE QUE SOLO ESTABA EN AMAZON.
 *
 * ============ QUÉ PROBLEMA RESUELVE ============
 *
 * La pestaña Origen tiene que poder decir «a este cliente NO le hace falta
 * sincronizar», que es un estado de primera y no un hueco. Pero la lista salía
 * solo de `stock_clients`, así que un cliente que únicamente estaba en
 * `amazon_clients` no aparecía —y no hay clave ajena entre las dos tablas, así
 * que ese caso es el normal, no el raro—. A la vez, Growth Partner enlazaba aquí
 * cuando el cliente no manda volcado: «si el suyo tiene que llegar, se dice en
 * Amazon API · Origen». Se pulsaba el enlace y el cliente no estaba en la lista.
 *
 * Ahora sí aparece, y decidir sobre él crea su fila por el camino. La fila NO
 * significa «le mandamos stock» —eso lo significa tener un perfil activo—: solo
 * significa que alguien ha mirado esto.
 *
 * SOLO ADMIN, por lo mismo que el PATCH de [id]: dejar de mandarle stock a un
 * cliente congela su stock en lo último que se subió, y quien lo decide tiene
 * que ser quien responde de ello. La decisión queda firmada por la 127.
 */
export const dynamic = 'force-dynamic'

/** Lo que cabe en el motivo. Es una frase, no un acta */
const MOTIVO_MAX = 300

/** El slug es la identidad compartida por las dos tablas de clientes */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => null)) as {
      slug?: unknown
      noSincroniza?: unknown
      motivo?: unknown
    } | null

    const slug = typeof body?.slug === 'string' ? body.slug.trim().toLowerCase() : ''
    if (!SLUG.test(slug)) return fail(400, 'Ese cliente no existe')

    // Booleano estricto, igual que en el PATCH: un `"false"` que llegara como
    // cadena marcaría al cliente justo al revés de lo que se ha pulsado, y sin
    // dar ningún error.
    if (typeof body?.noSincroniza !== 'boolean') {
      return fail(400, 'Hay que decir si el cliente sincroniza o no')
    }
    const noSincroniza = body.noSincroniza

    const clientId = await altaDesdeAmazon(slug)

    // Solo se escribe la decisión cuando es «no sincroniza». Dar de alta y
    // dejarlo en «sin configurar» es un estado legítimo —significa que hay
    // trabajo por hacer— y no hay nada que apuntar.
    if (noSincroniza) {
      await marcarNoSincroniza(clientId, {
        noSincroniza: true,
        motivo: readText(body.motivo, MOTIVO_MAX),
        porUsuario: session.userId,
      })
    }

    return NextResponse.json(await loadPerfiles())
  } catch (error) {
    return errorResponse(error, 'Error dando de alta al cliente en el sincronismo')
  }
}
