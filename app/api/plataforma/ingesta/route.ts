import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { cargarEventos } from '@/lib/plataforma/eventos'
import { jobsDeCliente } from '@/lib/plataforma/jobs'
import { tareasRegistradas } from '@/lib/plataforma/motor'
import { FALTAN_MIGRACIONES, faltaEsquema, ultimosRefrescos } from '@/lib/plataforma/pantallas'
import { registrarTareas } from '@/lib/plataforma/tareas'
import {
  AMAZON_JOB_ESTADO_LABELS,
  AMAZON_JOB_TIPO_LABELS,
  EVENTO_SEVERIDAD_LABELS,
} from '@/lib/plataforma/tipos'

/**
 * EL ESTADO DE LA INGESTA DE UN CLIENTE, EN UNA SOLA RESPUESTA.
 *
 * Solo admin.
 *
 * Las tres cosas vienen juntas —cuándo terminó bien cada refresco, qué trabajos
 * hay ahora y qué incidencias están abiertas— porque son la misma pregunta
 * partida en tres, y con tres peticiones la pantalla puede pintar un estado que
 * nunca existió: la lista de trabajos de hace dos segundos junto a los últimos
 * refrescos de ahora. Con una, lo que se ve es coherente consigo mismo.
 *
 * SIEMPRE DE UN SOLO CLIENTE: el clientId es obligatorio. No hay ninguna vista
 * que mezcle la ingesta de varios con métricas juntas y no la va a haber.
 */
export const dynamic = 'force-dynamic'

/** Cuántos trabajos se traen. Los del día caben de sobra; el resto es historia
    que nadie mira desde una pantalla de estado */
const LIMITE_JOBS = 60

export async function GET(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    registrarTareas()

    const clientId = request.nextUrl.searchParams.get('clientId') ?? ''
    if (!UUID.test(clientId)) return fail(400, 'Elige el cliente cuya ingesta quieres ver')

    const [refrescos, jobs, eventos] = await Promise.all([
      ultimosRefrescos(clientId),
      jobsDeCliente(clientId, LIMITE_JOBS),
      cargarEventos({ clientId, soloAbiertos: true, limite: 50 }),
    ])

    return NextResponse.json({
      refrescos,
      jobs,
      eventos,
      // Qué sabe ejecutar el motor HOY. Es lo que permite que el diálogo de
      // lanzar no ofrezca un tipo que se quedaría en la cola dando error.
      tiposEjecutables: tareasRegistradas(),
      etiquetas: {
        tipos: AMAZON_JOB_TIPO_LABELS,
        estados: AMAZON_JOB_ESTADO_LABELS,
        severidades: EVENTO_SEVERIDAD_LABELS,
      },
      leidoAt: new Date().toISOString(),
    })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTAN_MIGRACIONES)
    return errorResponse(error, 'Error leyendo el estado de la ingesta')
  }
}
