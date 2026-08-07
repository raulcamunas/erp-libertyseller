import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { disconnectConnection, loadAmazonData } from '@/lib/amazon/data'

/**
 * DESCONECTA UNA CUENTA DE AMAZON.
 *
 * Borra la fila de la conexión, y con ella la llave de acceso a la tienda de
 * ese cliente. Se borra de verdad y no se marca un `is_active = false`:
 * quedarse el token de alguien a quien has desconectado no es desconectar.
 *
 * EL HISTORIAL DE CAMBIOS NO SE TOCA. amazon_submissions tiene la conexión con
 * ON DELETE SET NULL y guarda congelados el identificador de la tienda y el
 * marketplace de cada cambio, así que las filas siguen ahí y se siguen
 * entendiendo solas. La respuesta devuelve cuántas se conservan para poder
 * decir un número en pantalla en vez de pedir que se confíe en la frase.
 *
 * Lo que sí desaparece es el espejo del catálogo (amazon_listings, en CASCADE),
 * que es una copia de lo que hay en Amazon y se vuelve a leer entera si el
 * cliente vuelve a autorizar.
 */
export const dynamic = 'force-dynamic'

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    if (!UUID.test(params.id)) return fail(400, 'Esa conexión no existe')

    const { keptSubmissions } = await disconnectConnection(params.id)
    const data = await loadAmazonData()

    return NextResponse.json({
      ...data,
      keptSubmissions,
      message:
        keptSubmissions > 0
          ? `Cuenta desconectada. Se conservan ${keptSubmissions} cambios en el historial`
          : 'Cuenta desconectada',
    })
  } catch (error) {
    return errorResponse(error, 'Error desconectando una cuenta de Amazon')
  }
}
