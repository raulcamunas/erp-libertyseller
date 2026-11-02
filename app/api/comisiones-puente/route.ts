import { NextResponse, type NextRequest } from 'next/server'
import { exigirSoloAdmin } from '@/lib/comisiones-puente/acceso'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { leerEstadoDelMes } from '@/lib/comisiones-puente/datos'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * QUÉ HAY PARA ESE CLIENTE Y ESE MES.
 *
 * Contesta las cuatro preguntas que hoy se responden abriendo tres pantallas:
 * ¿está el informe de ese mes en Tax Reports?, ¿hace falta también el del año
 * pasado?, ¿con qué cliente de Tesorería está emparejado este?, y ¿qué tiene ese
 * mes ya apuntado —y está facturado—?
 *
 *
 * ============ EL LISTÓN: ADMIN O SOCIO, Y SE COMPRUEBA AQUÍ ============
 *
 * `exigirAdmin` es el mismo de Facturación, y es el listón de Tesorería: aquí se
 * lee lo que cobra cada cliente y desde las rutas hermanas se escribe en el mes
 * que se va a facturar.
 *
 * NO SE HEREDA EL DE LA CALCULADORA. `app/api/commissions/process` pide SESIÓN y
 * nada más —está razonado a propósito en sus líneas 12-24, porque esa pantalla
 * la usa hoy cualquiera que trabaje—, pero esto no es la calculadora: esto mueve
 * dinero a Tesorería.
 *
 * Y NO SE HEREDA EL DE TAX REPORTS: ese es un permiso de app que tiene la
 * persona que el día 3 cuelga los ficheros. Si esta ruta fuera con ese permiso,
 * quien sube los informes vería el fee y la comisión de todos los clientes.
 * middleware.ts declara pública toda /api/, así que si esta línea no estuviera,
 * esto se lo contestaría a cualquiera de internet.
 */
export async function GET(request: NextRequest) {
  const permiso = await exigirSoloAdmin()
  if (!permiso.ok) return fail(permiso.estado, permiso.mensaje)

  try {
    const params = request.nextUrl.searchParams
    const clienteId = params.get('clienteId') ?? ''
    const anio = Number(params.get('anio'))
    const mes = Number(params.get('mes'))

    if (!UUID.test(clienteId)) return fail(400, 'Falta el cliente')
    if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) return fail(400, 'Ese año no vale')
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) return fail(400, 'Ese mes no vale')

    const estado = await leerEstadoDelMes(clienteId, anio, mes)
    if ('noExiste' in estado) return fail(404, 'Ese cliente no existe')

    return NextResponse.json(estado)
  } catch (error) {
    return errorResponse(error, 'Error leyendo el estado de un mes en el puente de comisiones')
  }
}
