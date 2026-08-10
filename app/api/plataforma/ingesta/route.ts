import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { cargarEventos } from '@/lib/plataforma/eventos'
import { jobsDeCliente } from '@/lib/plataforma/jobs'
import { tareasRegistradas } from '@/lib/plataforma/motor'
import { FALTAN_MIGRACIONES, faltaEsquema, ultimosRefrescos } from '@/lib/plataforma/pantallas'
import { registrarTareas } from '@/lib/plataforma/tareas'
import { conexionesDeCliente, unidadesDe } from '@/lib/plataforma/datos'
import { ultimoFoepPorUnidad } from '@/lib/plataforma/buybox/datos'
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

    /**
     * Las conexiones hacen falta para DOS filas de la rejilla que no salen de
     * amazon_jobs y que aun asi tienen que verse ahi:
     *
     *   · el ciclo de catalogo (precio y stock), que lo mueve el cron y deja su
     *     marca en `last_sync_at` de la conexion;
     *   · el FOEP, que es una FASE dentro de «Precios y Buy Box» y no un trabajo.
     *
     * Sin ellas, la tabla de arriba dice cada cuanto se piden y abajo no hay
     * forma de comprobar si se estan pidiendo — que es justo el fallo que esta
     * pantalla existe para evitar.
     */
    const conexiones = await conexionesDeCliente(clientId)
    const unidades = unidadesDe(conexiones)

    const [refrescos, jobs, eventos, foep] = await Promise.all([
      ultimosRefrescos(clientId),
      jobsDeCliente(clientId, LIMITE_JOBS),
      cargarEventos({ clientId, soloAbiertos: true, limite: 50 }),
      ultimoFoepPorUnidad(unidades),
    ])

    return NextResponse.json({
      refrescos,
      jobs,
      eventos,
      /** Ultimo FOEP por «connectionId|marketplaceId» */
      foep,
      /** El ciclo de catalogo, por conexion: cuando refresco y cuantas trajo */
      catalogo: conexiones.map((c) => ({
        connectionId: c.id,
        nombre: c.name,
        ultimo: c.last_sync_at ?? null,
        items: c.last_sync_items ?? null,
      })),
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
