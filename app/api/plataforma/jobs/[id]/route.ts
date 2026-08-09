import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, readText, requireAmazonAdmin } from '@/lib/amazon/api'
import { cargarEventos } from '@/lib/plataforma/eventos'
import {
  cargarJob,
  isMissingSchema,
  pausarJob,
  pedirCancelacion,
  reanudarJob,
} from '@/lib/plataforma/jobs'
import { AMAZON_JOB_TIPO_LABELS } from '@/lib/plataforma/tipos'

/**
 * UN TRABAJO: MIRARLO, CANCELARLO, PAUSARLO O RELANZARLO.
 *
 * Solo admin, igual que el resto del módulo.
 *
 *
 * POR QUÉ CANCELAR NO CANCELA (DE MOMENTO)
 * ========================================
 * `pedirCancelacion` PIDE la cancelación, no la impone. La diferencia importa:
 * poner el estado a 'cancelado' por debajo de una pasada que está trabajando la
 * dejaría escribiendo sobre un trabajo que ya nadie mira, y el lote a medias
 * quedaría contado a medias. Con la petición, el trabajador la ve al guardar el
 * progreso del lote siguiente y para él mismo, ordenadamente, con el cursor en
 * un punto coherente.
 *
 * Si el trabajo NO lo está procesando nadie ahora mismo, se cierra en el acto y
 * la respuesta lo dice (`inmediato`). Esperar cinco minutos a la próxima pasada
 * del cron para cancelar algo que está parado sería absurdo.
 */
export const dynamic = 'force-dynamic'

/* ------------------------------------------------------------------ */
/* Ver                                                                 */
/* ------------------------------------------------------------------ */

/**
 * El trabajo y lo que ha ido contando.
 *
 * Los eventos vienen en la misma respuesta a propósito: la pregunta que se hace
 * quien abre esta pantalla no es «¿en qué estado está?» sino «¿por qué va así?»,
 * y esa la contestan los eventos, no la fila.
 */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    if (!UUID.test(params.id)) return fail(400, 'Ese trabajo no es válido')

    const job = await cargarJob(params.id)
    if (!job) return fail(404, 'Ese trabajo ya no existe')

    const eventos = await cargarEventos({ jobId: job.id, limite: 100 })

    return NextResponse.json({
      job,
      eventos,
      etiqueta: AMAZON_JOB_TIPO_LABELS[job.tipo],
      leidoAt: new Date().toISOString(),
    })
  } catch (error) {
    if (isMissingSchema(error)) {
      return fail(
        503,
        'Faltan las tablas de la plataforma: lanza 123_plataforma_a1.sql en el editor SQL de Supabase'
      )
    }
    return errorResponse(error, 'Error leyendo un trabajo de la plataforma')
  }
}

/* ------------------------------------------------------------------ */
/* Cancelar, pausar, reanudar                                          */
/* ------------------------------------------------------------------ */

type Accion = 'cancelar' | 'pausar' | 'reanudar'

const ACCIONES: Accion[] = ['cancelar', 'pausar', 'reanudar']

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    if (!UUID.test(params.id)) return fail(400, 'Ese trabajo no es válido')

    const body = (await request.json().catch(() => ({}))) as {
      accion?: unknown
      motivo?: unknown
    }

    const accion = typeof body.accion === 'string' ? (body.accion.trim() as Accion) : null
    if (!accion || !ACCIONES.includes(accion)) {
      return fail(400, `Qué hay que hacer con el trabajo: ${ACCIONES.join(', ')}`)
    }

    const job = await cargarJob(params.id)
    if (!job) return fail(404, 'Ese trabajo ya no existe')

    if (accion === 'cancelar') {
      // El motivo es OBLIGATORIO —lo exige también el CHECK de la migración—
      // porque un trabajo cancelado sin explicación deja a quien lo mire mañana
      // sin saber si hay que relanzarlo o si se canceló por algo.
      const motivo = readText(body.motivo, 300)
      if (!motivo) return fail(400, 'Di por qué se cancela el trabajo')

      // `iniciadoAt` va porque el CHECK amazon_jobs_inicio_ok no deja salir de
      // 'pendiente' con la columna vacía, y un trabajo cancelado en la cola
      // nunca llegó a empezar. La fila ya está leída aquí arriba.
      const resultado = await pedirCancelacion(job.id, {
        userId: session.userId,
        motivo,
        iniciadoAt: job.iniciado_at,
      })
      if (!resultado.ok) {
        return fail(409, 'Ese trabajo ya había terminado, así que no hay nada que cancelar')
      }

      return NextResponse.json({
        job: await cargarJob(job.id),
        inmediato: resultado.inmediato,
        mensaje: resultado.inmediato
          ? 'Cancelado. No lo estaba procesando nadie, así que se ha cerrado en el acto.'
          : 'Cancelación pedida. El trabajo está en marcha ahora mismo: se parará al acabar el lote que tiene entre manos, sin dejarlo a medias.',
      })
    }

    if (accion === 'pausar') {
      const ok = await pausarJob(job.id, job.iniciado_at)
      if (!ok) {
        return fail(
          409,
          'No se ha podido pausar: o ya había terminado, o lo está procesando el motor justo ahora. Vuelve a intentarlo en un minuto'
        )
      }
      return NextResponse.json({
        job: await cargarJob(job.id),
        mensaje: 'Pausado. Se queda fuera de la cola con su progreso intacto: al reanudarlo sigue donde estaba.',
      })
    }

    const ok = await reanudarJob(job.id)
    if (!ok) {
      return fail(409, 'Solo se puede reanudar un trabajo pausado o uno que acabó con error')
    }
    return NextResponse.json({
      job: await cargarJob(job.id),
      mensaje:
        'De vuelta en la cola. Conserva el cursor y los contadores, así que sigue donde estaba: no repite lo que ya había leído.',
    })
  } catch (error) {
    if (isMissingSchema(error)) {
      return fail(
        503,
        'Faltan las tablas de la plataforma: lanza 123_plataforma_a1.sql en el editor SQL de Supabase'
      )
    }
    return errorResponse(error, 'Error actualizando un trabajo de la plataforma')
  }
}
