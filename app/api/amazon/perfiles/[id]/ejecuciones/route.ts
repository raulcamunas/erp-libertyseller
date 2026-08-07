import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { isMissingSchema, loadPerfil, runsDePerfil } from '@/lib/stock-sync/perfiles'

/**
 * EL HISTORIAL DE UN PERFIL: qué hizo el ciclo cada vez que lo miró.
 *
 * Es lo que contesta a la pregunta que llega por teléfono: «¿por qué este
 * producto lleva tres días con el stock viejo?». La respuesta está siempre en
 * una de estas filas —saltó un freno, el fichero no llegó, se mandó y Amazon lo
 * rechazó— y sin ellas la única salida es reprocesar y esperar a que vuelva a
 * pasar.
 *
 * Va en su propia ruta y no dentro de la vista general por dos razones: la vista
 * trae las últimas cuarenta de TODOS los perfiles, que para un cliente concreto
 * puede ser ninguna; y desde aquí se puede refrescar sin recargar la pantalla
 * entera, que es lo que se hace mientras se está mirando un envío en marcha.
 */
export const dynamic = 'force-dynamic'

/**
 * Cuántas se devuelven. Con la cadencia de quince minutos y un fichero que
 * cambia una o dos veces al día, sesenta filas son varias semanas: las pasadas
 * en las que no hay nada nuevo no escriben fila.
 */
const MAX_RUNS = 60

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    if (!UUID.test(params.id)) return fail(400, 'Ese perfil no existe')

    const perfil = await loadPerfil(params.id)
    if (!perfil) return fail(404, 'Ese perfil ya no existe')

    const runs = await runsDePerfil(params.id, MAX_RUNS)

    // El perfil vuelve con las ejecuciones porque la pantalla enseña las dos
    // cosas juntas y tienen que ser de la misma foto: el estado del cerrojo y la
    // hora de la última pasada cambian solos mientras se mira.
    return NextResponse.json({ perfil, runs, limite: MAX_RUNS })
  } catch (error) {
    if (isMissingSchema(error)) {
      return fail(
        400,
        'Falta lanzar 121_stock_ciclo.sql en el editor SQL de Supabase: el historial usa columnas que todavía no existen.'
      )
    }
    return errorResponse(error, 'Error leyendo el historial de un perfil')
  }
}
