import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { planificarRefrescos } from '@/lib/plataforma/planificador'
import { registrarTareas } from '@/lib/plataforma/tareas'

/**
 * LANZAR EL PLANIFICADOR A MANO.
 *
 * Solo admin. En marcha normal esto lo hace solo el cron cada cinco minutos
 * (app/api/amazon/cron-jobs); esta ruta existe para dos cosas concretas:
 *
 *   · VER QUÉ HARÍA sin esperar a la noche. La respuesta trae, refresco por
 *     refresco, si le tocaba y por qué no. «No le toca» sin fecha ni motivo es
 *     lo que hace que alguien abra la consola para entender una pantalla.
 *   · FORZAR el primer barrido de un cliente recién conectado, sin esperar a la
 *     ventana nocturna ni a que venza la cadencia.
 *
 * `forzar` NO salta la exclusión de trabajos vivos, y eso no es negociable: la
 * garantiza un índice único de la base, no este código. Forzar significa
 * «ignora el reloj», nunca «lanza dos barridos del mismo catálogo a la vez».
 *
 * Esto encola: no ejecuta nada ni habla con Amazon. Los trabajos los recoge el
 * motor en su pasada siguiente.
 */
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    // El planificador crea trabajos de tipos que tiene que saber ejecutar
    // alguien. Registrar aquí es idempotente y evita encolar a ciegas.
    registrarTareas()

    const body = (await request.json().catch(() => ({}))) as {
      clientId?: unknown
      forzar?: unknown
    }

    const clientId =
      typeof body.clientId === 'string' && body.clientId.trim() !== '' ? body.clientId.trim() : null
    if (clientId && !UUID.test(clientId)) return fail(400, 'Ese cliente no es válido')

    const plan = await planificarRefrescos({
      clientId,
      forzar: body.forzar === true,
    })

    if (plan.omitido) return fail(503, plan.omitido)

    return NextResponse.json({
      ...plan,
      mensaje:
        plan.creados > 0
          ? `${plan.creados} trabajos encolados. Empiezan en la próxima pasada del motor, dentro de cinco minutos como mucho.`
          : 'No le tocaba a nada. Mira el detalle de cada refresco para ver por qué y cuándo le toca.',
    })
  } catch (error) {
    return errorResponse(error, 'Error planificando los refrescos de la plataforma')
  }
}
