import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { AdsError } from '@/lib/ads/oauth'
import { llamarAds, perfilParaLlamar } from '@/lib/ads/datos'

/**
 * EL BANCO DE PRUEBAS: una llamada a la API de Ads y su respuesta en crudo.
 *
 * Sirve para ver QUÉ devuelve Amazon antes de decidir qué se guarda. No
 * persiste nada: la respuesta va a la pantalla y ahí acaba.
 *
 *
 * ============ LAS TRES CERRADURAS ============
 *
 * Una ruta que reenvía a la API de un cliente lo que le manden es exactamente
 * lo que no se puede dejar abierto. Tres cosas la sujetan:
 *
 * 1. LA CUENTA TIENE QUE ESTAR MARCADA COMO EN USO. No se llama a la cuenta de
 *    un anunciante que alguien ha decidido no trabajar, ni para leer.
 *
 * 2. LA RUTA VA CONTRA UNA LISTA. Solo los prefijos de la API de Ads que este
 *    banco necesita. Sin esto, un `../` o una ruta absoluta podrían sacar la
 *    llamada del sitio previsto.
 *
 * 3. ESCRIBIR SE PIDE APARTE. Un PUT o un POST que no sea de listado modifica la
 *    cuenta de un cliente y gasta su dinero, así que quien llama tiene que
 *    mandar `escribir: true` a conciencia. Un método suelto no basta: casi todas
 *    las lecturas de la v3 son POST, y sin esta distinción «leer campañas» y
 *    «cambiar una puja» entrarían por la misma puerta.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/** Los prefijos que este banco puede tocar. Todo lo demás se rechaza */
const RUTAS_PERMITIDAS = [
  '/sp/',
  '/sb/',
  '/sd/',
  '/v2/profiles',
  '/portfolios',
  '/reporting/reports',
]

/** Las rutas de LISTADO son POST y leen. Se distinguen por terminar en /list */
function esLectura(metodo: string, ruta: string): boolean {
  if (metodo === 'GET') return true
  if (metodo === 'POST' && ruta.endsWith('/list')) return true
  // Pedir un informe es POST y no modifica nada de la cuenta: genera un fichero.
  if (metodo === 'POST' && ruta.startsWith('/reporting/reports')) return true
  return false
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as {
      perfilId?: string
      ruta?: string
      metodo?: string
      tipo?: string
      cuerpo?: unknown
      escribir?: boolean
    }

    if (!body.perfilId || !UUID.test(body.perfilId)) return fail(400, 'Falta la cuenta.')

    const ruta = (body.ruta ?? '').trim()
    const metodo = (body.metodo ?? 'GET').toUpperCase()

    if (!ruta.startsWith('/') || ruta.includes('..')) {
      return fail(400, 'La ruta tiene que empezar por «/» y no puede llevar «..».')
    }
    if (!RUTAS_PERMITIDAS.some((p) => ruta.startsWith(p))) {
      return fail(
        400,
        `«${ruta}» no está entre las rutas que este banco de pruebas puede llamar. ` +
          `Son: ${RUTAS_PERMITIDAS.join(', ')}`
      )
    }

    const perfil = await perfilParaLlamar(body.perfilId)
    if (!perfil) return fail(404, 'Esa cuenta ya no existe.')
    if (!perfil.enUso) {
      return fail(
        400,
        `«${perfil.nombre}» está apagada. Enciéndela arriba si de verdad se trabaja: no se llama ` +
          'a la cuenta de un anunciante que alguien ha decidido no tocar.'
      )
    }

    if (!esLectura(metodo, ruta) && body.escribir !== true) {
      return fail(
        400,
        `${metodo} ${ruta} MODIFICA la cuenta del cliente y gasta su dinero. Esta llamada tiene ` +
          'que pedirse marcando la casilla de escritura a conciencia.'
      )
    }

    const t0 = Date.now()
    const datos = await llamarAds<unknown>(perfil.conexionId, ruta, {
      perfilId: perfil.profileId,
      metodo,
      cuerpo: body.cuerpo,
      cabeceras: body.tipo ? { Accept: body.tipo, 'Content-Type': body.tipo } : undefined,
    })

    return NextResponse.json({
      ok: true,
      ms: Date.now() - t0,
      cuenta: perfil.nombre,
      profileId: perfil.profileId,
      datos,
    })
  } catch (error) {
    if (error instanceof AdsError) return fail(400, error.message)
    console.error('Error en el banco de pruebas de Amazon Ads:', error)
    return fail(500, error instanceof Error ? error.message : 'Ha fallado la llamada')
  }
}
