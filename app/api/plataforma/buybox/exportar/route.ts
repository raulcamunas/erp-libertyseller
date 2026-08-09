import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { marketplaceById } from '@/lib/types/amazon'
import {
  FALTAN_MIGRACIONES,
  csvDeBuyBox,
  faltaEsquema,
  listadoBuyBox,
} from '@/lib/plataforma/buybox/pantalla'
import { VEREDICTOS, type Veredicto } from '@/lib/plataforma/buybox/tipos'

/**
 * EL INFORME DE BUY BOX PARA ENSEÑARLE AL CLIENTE.
 *
 * La especificación lo pide explícitamente: «exportable para presentar al
 * cliente». Y va con EL MOTIVO ENTERO de cada veredicto, no solo la etiqueta,
 * porque ahí está la mitad del valor del módulo: un cliente que recibe «no
 * recuperable» discute, y uno que recibe «bajar a 24,90 € dejaría un 3,1 % de
 * margen, por debajo de tu mínimo del 12 %, y quien la tiene entrega por FBA»
 * entiende.
 *
 * UN CLIENTE POR FICHERO. Nunca dos, ni un resumen de la cartera: los datos de
 * un vendedor se usan exclusivamente para operar y asesorar SU cuenta, y un CSV
 * es justamente lo que sale del sistema y acaba en un correo.
 */
export const dynamic = 'force-dynamic'

/** Tope de filas de una exportación. Por encima, es un volcado de base de datos */
const MAX_FILAS = 5000

export async function GET(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const params = request.nextUrl.searchParams
    const clientId = params.get('clientId') ?? ''
    if (!UUID.test(clientId)) return fail(400, 'Elige el cliente cuyo informe quieres exportar')

    const connectionId = limpio(params.get('connectionId'))
    if (connectionId && !UUID.test(connectionId)) return fail(400, 'Esa cuenta no es válida')

    const veredictos = (params.get('veredictos') ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter((v): v is Veredicto => VEREDICTOS.includes(v as Veredicto))

    const { filas } = await listadoBuyBox({
      clientId,
      connectionId,
      marketplaceId: limpio(params.get('marketplaceId')),
      veredictos,
      busqueda: limpio(params.get('busqueda')),
      desde: 0,
      limite: MAX_FILAS,
    })

    const csv = csvDeBuyBox(filas, (id) => marketplaceById(id)?.label ?? id)
    const fecha = new Date().toISOString().slice(0, 10)

    return new NextResponse(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="buybox-${fecha}.csv"`,
        // Sin caché: son datos de la tienda de un cliente y no tienen por qué
        // quedarse en ningún proxy intermedio.
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES)
    return errorResponse(error, 'Error exportando el informe de Buy Box')
  }
}

function limpio(valor: string | null): string | null {
  if (!valor) return null
  const texto = valor.trim()
  return texto === '' ? null : texto
}
