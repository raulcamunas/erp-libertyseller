import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { crearJob, isMissingSchema, jobsDeCliente, jobsDeLaCola } from '@/lib/plataforma/jobs'
import { tareaDe, tareasRegistradas } from '@/lib/plataforma/motor'
import { registrarTareas } from '@/lib/plataforma/tareas'
import {
  AMAZON_JOB_TIPOS,
  AMAZON_JOB_TIPO_LABELS,
  jobNecesitaConexion,
  type AmazonJobTipo,
} from '@/lib/plataforma/tipos'

/**
 * LOS TRABAJOS DE LA PLATAFORMA: VER Y LANZAR.
 *
 * SOLO ADMIN, como todo lo que cuelga de este módulo. Y aquí importa más que en
 * otras rutas: desde este POST se lanza un barrido que lee el catálogo entero de
 * la tienda de un cliente y gasta el cupo de Amazon de esa cuenta. En
 * middleware.ts todo lo que empieza por /api/ está en la lista de rutas
 * públicas, así que una ruta de API que no comprueba nada contesta a cualquiera:
 * requireAmazonAdmin() no es una formalidad, es la única puerta que hay.
 *
 * A1 SOLO LEE de Amazon. Ninguno de los tipos que se pueden lanzar desde aquí
 * escribe nada en la tienda de nadie.
 */
export const dynamic = 'force-dynamic'

/* ------------------------------------------------------------------ */
/* Ver                                                                 */
/* ------------------------------------------------------------------ */

/**
 * La cola, o los trabajos de un cliente.
 *
 * Sin `clientId` devuelve LA COLA (lo pendiente y lo que está en marcha), que es
 * lo que contesta «¿esto se está moviendo?». Con `clientId`, el historial de ese
 * cliente, del más nuevo al más viejo.
 *
 * No hay ninguna vista que mezcle clientes con métricas agregadas y no la va a
 * haber: los datos de un vendedor se usan para operar SU cuenta. Esta lista es
 * de trabajos NUESTROS —filas del ERP, no datos de tienda— y aun así va por
 * cliente.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    registrarTareas()

    const clientId = request.nextUrl.searchParams.get('clientId')
    const limiteCrudo = Number(request.nextUrl.searchParams.get('limite') ?? '50')
    const limite = Number.isFinite(limiteCrudo) ? Math.min(200, Math.max(1, limiteCrudo)) : 50

    if (clientId && !UUID.test(clientId)) return fail(400, 'Ese cliente no es válido')

    const jobs = clientId ? await jobsDeCliente(clientId, limite) : await jobsDeLaCola(limite)

    return NextResponse.json({
      jobs,
      etiquetas: AMAZON_JOB_TIPO_LABELS,
      // Qué tipos sabe ejecutar el motor HOY. Es lo que permite que la pantalla
      // no ofrezca lanzar algo que se quedaría en la cola dando error.
      tiposEjecutables: tareasRegistradas(),
      leidoAt: new Date().toISOString(),
    })
  } catch (error) {
    if (isMissingSchema(error)) {
      return fail(
        503,
        'Faltan las tablas de la plataforma: lanza 123_plataforma_a1.sql en el editor SQL de Supabase'
      )
    }
    return errorResponse(error, 'Error leyendo los trabajos de la plataforma')
  }
}

/* ------------------------------------------------------------------ */
/* Lanzar                                                              */
/* ------------------------------------------------------------------ */

/** Tope de SKU en un subconjunto de prueba. Por encima de esto, es un barrido */
const MAX_SKUS_FILTRO = 500

/**
 * Mete un trabajo en la cola. NO lo ejecuta.
 *
 * La respuesta vuelve en cuanto la fila está escrita, y el trabajo lo recoge el
 * motor en su pasada siguiente (cinco minutos como mucho). No se ejecuta aquí a
 * propósito: un barrido de 13.700 referencias tarda horas y ninguna petición
 * HTTP aguanta eso. Lo que sí hace la prioridad es adelantarlo: un trabajo que
 * pide una persona va por delante del barrido semanal.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    registrarTareas()

    const body = (await request.json().catch(() => ({}))) as {
      tipo?: unknown
      clientId?: unknown
      connectionId?: unknown
      marketplaceId?: unknown
      skus?: unknown
      soloActivos?: unknown
      prioridad?: unknown
      parametros?: unknown
    }

    const tipo = typeof body.tipo === 'string' ? (body.tipo.trim() as AmazonJobTipo) : null
    if (!tipo || !AMAZON_JOB_TIPOS.includes(tipo)) {
      return fail(400, `Ese tipo de trabajo no existe. Los que hay: ${AMAZON_JOB_TIPOS.join(', ')}`)
    }

    // Se corta ANTES de escribir la fila. Un trabajo de un tipo sin tarea acaba
    // en error y suena la campana —eso ya está resuelto en el motor— pero hacer
    // sonar una alarma por algo que se sabía en el momento de pulsar el botón es
    // gastar la atención de alguien para nada.
    if (!tareaDe(tipo)) {
      return fail(
        409,
        `«${AMAZON_JOB_TIPO_LABELS[tipo]}» está declarado pero el motor todavía no sabe ejecutarlo. ` +
          'Se construye en un módulo posterior.'
      )
    }

    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : ''
    if (!UUID.test(clientId)) return fail(400, 'Elige el cliente sobre el que lanzar el trabajo')

    const connectionId =
      typeof body.connectionId === 'string' && body.connectionId.trim() !== ''
        ? body.connectionId.trim()
        : null
    if (connectionId && !UUID.test(connectionId)) return fail(400, 'Esa cuenta no es válida')

    const marketplaceId =
      typeof body.marketplaceId === 'string' && body.marketplaceId.trim() !== ''
        ? body.marketplaceId.trim()
        : null

    if (jobNecesitaConexion(tipo) && (!connectionId || !marketplaceId)) {
      return fail(
        400,
        `«${AMAZON_JOB_TIPO_LABELS[tipo]}» habla con Amazon, así que hay que decirle con qué cuenta y en qué país`
      )
    }

    // ---------- El subconjunto de prueba ----------
    // La especificación lo exige: «todo debe poder ejecutarse sobre un
    // subconjunto de SKUs, no solo sobre el catálogo entero». Es como se prueba
    // un barrido nuevo sin gastar una noche de cupo.
    let skus: string[] | null = null
    if (Array.isArray(body.skus)) {
      const limpios = [
        ...new Set(
          body.skus
            .filter((s): s is string => typeof s === 'string')
            .map((s) => s.trim())
            .filter((s) => s !== '')
        ),
      ]
      if (limpios.length > MAX_SKUS_FILTRO) {
        return fail(
          400,
          `Un subconjunto de prueba admite ${MAX_SKUS_FILTRO} referencias como mucho. Para más, lanza el barrido completo`
        )
      }
      // Vacío se queda en null: un array vacío NO es «sin filtro», es un filtro
      // que no selecciona nada, y el trabajo acabaría en verde sin haber hecho
      // nada.
      skus = limpios.length > 0 ? limpios : null
    }

    const prioridadCruda = Number(body.prioridad)
    const prioridad = Number.isFinite(prioridadCruda)
      ? Math.min(1000, Math.max(1, Math.round(prioridadCruda)))
      : // Por delante de todo lo que planifica el sistema (40 a 90): lo ha
        // pedido una persona y está esperando.
        10

    const parametros: Record<string, unknown> = {
      ...(body.parametros && typeof body.parametros === 'object'
        ? (body.parametros as Record<string, unknown>)
        : {}),
    }
    if (typeof body.soloActivos === 'boolean') parametros.soloActivos = body.soloActivos

    const { job, yaExistia } = await crearJob({
      tipo,
      clientId,
      connectionId,
      marketplaceId,
      prioridad,
      skusFiltro: skus,
      parametros,
      createdBy: session.userId,
    })

    return NextResponse.json({
      job,
      // No es un error: es la respuesta correcta a pulsar dos veces el botón. La
      // pantalla enseña el que ya estaba en marcha.
      yaExistia,
      mensaje: yaExistia
        ? `Ya había un «${AMAZON_JOB_TIPO_LABELS[tipo]}» en marcha para este destino: se te devuelve ese.`
        : `«${AMAZON_JOB_TIPO_LABELS[tipo]}» encolado. Empieza en la próxima pasada del motor, dentro de cinco minutos como mucho.`,
    })
  } catch (error) {
    if (isMissingSchema(error)) {
      return fail(
        503,
        'Faltan las tablas de la plataforma: lanza 123_plataforma_a1.sql en el editor SQL de Supabase'
      )
    }
    if ((error as { code?: string })?.code === '23503') {
      return fail(404, 'Ese cliente o esa cuenta ya no existen')
    }
    return errorResponse(error, 'Error encolando un trabajo de la plataforma')
  }
}
