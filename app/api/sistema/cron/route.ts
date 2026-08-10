import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import {
  FALTA_MIGRACION_CRON,
  TAREAS_CRON,
  guardarConfigCron,
  leerConfigCron,
  tareaCron,
} from '@/lib/sistema/cron'

/**
 * EL ESTADO DE LOS PROCESOS AUTOMÁTICOS, Y EL BOTÓN PARA LANZARLOS.
 *
 * GET  → qué hay: última pasada de cada proceso y las últimas ejecuciones.
 * POST → lanza uno a mano y devuelve lo que contestó.
 *
 *
 * ============ POR QUÉ EXISTE ESTA PANTALLA ============
 *
 * Los tres crones llevaban desde el primer día pidiendo a `localhost:3000`
 * cuando el servidor escucha en el 80. Contestaban HTTP 000 en cada pasada y
 * NADA lo dijo: el catálogo se quedó en «refrescado hace 17 horas», los trabajos
 * de plataforma acumularon 0 pasadas y la agenda solo se sincronizaba cuando
 * alguien pulsaba el botón.
 *
 * Se descubrió mirando los registros del contenedor de casualidad. Esto es para
 * que la próxima vez se vea en una pantalla.
 *
 *
 * ============ EL LANZAMIENTO A MANO NO PRUEBA QUE EL CRON FUNCIONE ============
 *
 * Y es la trampa en la que ya caímos con la agenda: se sincronizaba al pulsar,
 * así que parecía viva, y el automático llevaba meses muerto.
 *
 * Por eso una pasada lanzada desde aquí se guarda con `lanzado_por`, y el
 * cálculo de «cuándo corrió por última vez SOLA» ignora esas. Si no, el propio
 * acto de comprobarlo taparía el problema que se está buscando.
 */
export const dynamic = 'force-dynamic'

interface FilaEjecucion {
  id: string
  tarea: string
  iniciado_at: string
  terminado_at: string | null
  ok: boolean | null
  resumen: string | null
  error: string | null
  duracion_ms: number | null
  lanzado_por: string | null
}

const FIELDS = 'id, tarea, iniciado_at, terminado_at, ok, resumen, error, duracion_ms, lanzado_por'

export async function GET() {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const service = createServiceClient()

    // Las últimas 60 de todas las tareas. Con el de agenda cada 3 minutos, eso
    // es unas tres horas de historia, que es la ventana en la que se mira esto.
    const { data, error } = await service
      .from('cron_ejecuciones')
      .select(FIELDS)
      .order('iniciado_at', { ascending: false })
      .limit(60)
    if (error) throw error

    const filas = (data ?? []) as FilaEjecucion[]

    // El intervalo sale de cron_config, no del código: es lo que se puede
    // cambiar desde la pantalla. `cadaMinutos` de TAREAS_CRON queda como valor
    // por defecto para cuando la 138 todavía no está lanzada.
    const config = await leerConfigCron()

    const procesos = TAREAS_CRON.map((t) => {
      const suyas = filas.filter((f) => f.tarea === t.id)
      // La última que lanzó EL CRON, no una de prueba. Ver la cabecera.
      const ultimaSola = suyas.find((f) => f.lanzado_por === null) ?? null
      const suya = config.find((c) => c.tarea === t.id)
      return {
        ...t,
        cadaMinutos: suya?.cada_minutos ?? t.cadaMinutos,
        activo: suya?.activo ?? true,
        /** true = el horario todavía sale del código porque falta la 138 */
        horarioPorDefecto: suya?.pordefecto ?? true,
        ultima: suyas[0] ?? null,
        ultimaAutomatica: ultimaSola,
      }
    })

    /**
     * Y lo que ha corrido POR CLIENTE.
     *
     * Los tres procesos de arriba dicen si el motor está vivo; esto dice qué ha
     * hecho por cada cuenta. Son preguntas distintas: el cron puede estar
     * corriendo perfectamente y un cliente concreto llevar días sin que le toque
     * nada porque su cola está vacía o sus trabajos fallan.
     *
     * Sale de amazon_jobs y no de cron_ejecuciones: una pasada del cron avanza
     * un tramo de VARIOS clientes, así que el grano de «qué le ha pasado a este»
     * es el trabajo, no la pasada.
     */
    const { data: trabajos, error: errorTrabajos } = await service
      .from('amazon_jobs')
      .select(
        'id, tipo, client_id, marketplace_id, estado, iniciado_at, terminado_at, ' +
          'procesados, errores, pasadas, resumen, error_message'
      )
      .not('iniciado_at', 'is', null)
      .order('iniciado_at', { ascending: false })
      .limit(120)
    if (errorTrabajos) throw errorTrabajos

    const { data: clientes, error: errorClientes } = await service
      .from('amazon_clients')
      .select('id, name')
      .eq('is_active', true)
      .order('name', { ascending: true })
    if (errorClientes) throw errorClientes

    return NextResponse.json({
      procesos,
      ejecuciones: filas,
      trabajos: trabajos ?? [],
      clientes: clientes ?? [],
    })
  } catch (error) {
    if (isMissingSchema(error)) return fail(503, FALTA_MIGRACION_CRON)
    return errorResponse(error, 'No se ha podido leer el estado de los procesos')
  }
}

/**
 * CAMBIA CADA CUÁNTO CORRE UN PROCESO.
 *
 * Tiene efecto en el minuto siguiente y sin desplegar: el crontab del contenedor
 * llama a las tres rutas cada minuto y es cada ruta la que mira `cron_config`
 * para decidir si le toca. Ver el Dockerfile y tocaAhora() en lib/sistema/cron.
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as {
      tarea?: unknown
      cadaMinutos?: unknown
      activo?: unknown
    }
    const id = typeof body.tarea === 'string' ? body.tarea : ''
    if (!tareaCron(id)) {
      return fail(400, `No existe el proceso «${id}». Los que hay: ${TAREAS_CRON.map((t) => t.id).join(', ')}`)
    }

    const config = await guardarConfigCron(
      id,
      {
        cadaMinutos: typeof body.cadaMinutos === 'number' ? body.cadaMinutos : undefined,
        activo: typeof body.activo === 'boolean' ? body.activo : undefined,
      },
      session.userId
    )

    return NextResponse.json({ ok: true, config })
  } catch (error) {
    if (isMissingSchema(error)) {
      return fail(
        503,
        'Falta la tabla de horarios: lanza 138_cron_config.sql en el editor SQL de Supabase. ' +
          'Mientras tanto los procesos corren con los intervalos de siempre.'
      )
    }
    return errorResponse(error, 'No se ha podido guardar el horario')
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as { tarea?: unknown }
    const id = typeof body.tarea === 'string' ? body.tarea : ''
    const tarea = tareaCron(id)
    if (!tarea) {
      return fail(400, `No existe el proceso «${id}». Los que hay: ${TAREAS_CRON.map((t) => t.id).join(', ')}`)
    }

    /**
     * SE LLAMA A LA MISMA RUTA QUE LLAMA EL CRON, con su mismo secreto.
     *
     * Podría invocarse la función directamente y sería más rápido, pero entonces
     * esto probaría OTRA cosa: comprobaría que el código funciona, no que el
     * camino que usa el cron funciona. Y el fallo que nos ha traído aquí estaba
     * justo en el camino —un puerto equivocado—, no en el código.
     *
     * El puerto sale del entorno por el mismo motivo que en los scripts: el
     * Dockerfile pone 3000 y Easypanel lo pisa con el 80.
     */
    const secret = process.env.CRON_SECRET
    if (!secret) {
      return fail(
        503,
        'No hay CRON_SECRET puesta en el servidor, así que la ruta del proceso contestaría 401. ' +
          'Añádela en Easypanel: sin ella los automatismos no corren.'
      )
    }

    const puerto = process.env.PORT || '3000'
    const arranque = Date.now()

    let codigo = 0
    let cuerpo = ''
    try {
      /**
       * `?forzar=1` SALTA LA COMPROBACIÓN DE HORARIO, y solo aquí.
       *
       * Desde que el crontab entra cada minuto, la ruta contesta «todavía no»
       * casi siempre. Sin este parámetro, el botón «Lanzar ahora» diría que ha
       * ido bien —HTTP 200— sin haber hecho nada, que es la peor respuesta
       * posible en la pantalla que existe para comprobar si algo corre.
       *
       * Y la pasada sigue registrándose con `lanzado_por`, así que tampoco
       * cuenta como automática ni retrasa el reloj del cron.
       */
      const res = await fetch(`http://localhost:${puerto}${tarea.ruta}?forzar=1`, {
        method: 'POST',
        headers: {
          'x-cron-secret': secret,
          /**
           * QUIÉN LO HA LANZADO, para que la ruta lo registre como pasada A MANO.
           *
           * Sin esta cabecera la ruta escribía `lanzado_por: null` siempre —no
           * tiene forma de saberlo—, así que pulsar este botón contaba como
           * pasada automática. Con eso, la pantalla que existe para descubrir un
           * cron muerto se lo tapaba a sí misma en cuanto alguien comprobaba el
           * proceso, que es exactamente la trampa de la agenda otra vez.
           *
           * Va detrás del secreto, así que solo puede ponerla el propio servidor.
           */
          'x-lanzado-por': session.userId,
        },
        // Un tope propio: sin esto, un proceso colgado deja esta petición
        // esperando y la pantalla parece rota en vez de decir qué pasa.
        signal: AbortSignal.timeout(120_000),
      })
      codigo = res.status
      cuerpo = (await res.text()).slice(0, 2000)
    } catch (e) {
      return NextResponse.json({
        ok: false,
        codigo: 0,
        duracionMs: Date.now() - arranque,
        mensaje:
          e instanceof Error && e.name === 'TimeoutError'
            ? `«${tarea.nombre}» no ha contestado en 2 minutos. Puede seguir trabajando por dentro: mira la lista de abajo dentro de un rato.`
            : `No se ha podido llamar a ${tarea.ruta} en el puerto ${puerto}. Es lo mismo que le pasa al cron cuando el puerto no es el que escucha.`,
      })
    }

    return NextResponse.json({
      ok: codigo === 200,
      codigo,
      duracionMs: Date.now() - arranque,
      cuerpo,
      mensaje:
        codigo === 200
          ? `«${tarea.nombre}» ha corrido bien.`
          : `«${tarea.nombre}» ha contestado HTTP ${codigo}. Es exactamente lo que recibe el cron.`,
    })
  } catch (error) {
    return errorResponse(error, 'No se ha podido lanzar el proceso')
  }
}
