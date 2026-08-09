import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { leerCuerpoConTope } from '@/lib/subidas-limite'

// Tipos para la request
interface TrackerLog {
  url: string
  title: string
  startTime: string
  endTime: string
  duration: number
  domain: string
}

interface TrackerIngestRequest {
  employee_id: string
  report_date: string
  logs: TrackerLog[]
}

/**
 * TOPE DE REGISTROS POR PETICIÓN.
 *
 * QUÉ IMPIDE: que cualquiera de Internet —esta ruta NO pide sesión— haga crecer
 * la base sin freno. El bucle de más abajo hace UNA llamada RPC por cada
 * elemento de `logs`, así que un array de un millón de elementos son un millón
 * de escrituras con la clave `service_role`, que se salta RLS.
 *
 * POR QUÉ 20.000 Y NO UN NÚMERO A OJO: una petición cubre UN día de UNA persona
 * (la ruta agrupa por `employee_id` + día). El día más cargado que existe en
 * producción son 2.201 registros (medido informe a informe: 15, 1.072, 1, 764,
 * 1.419, 1.521, 2.201). El tope deja NUEVE VECES ese máximo, así que ninguna
 * jornada real, por larga que sea, se acerca. Si algún día se acercara, esto es
 * UNA constante en UN sitio.
 */
const MAX_LOGS_POR_PETICION = 20_000

/**
 * TOPE DE BYTES DEL CUERPO JSON.
 *
 * Va ANTES de `request.json()` porque ese parseo se come el cuerpo entero en
 * memoria antes de que la ruta pueda mirar nada — el mismo problema que el de
 * las subidas de fichero (lib/subidas-limite.ts), aquí con JSON.
 *
 * 20.000 registros con URL, título y dominio ocupan del orden de 6 MB; 32 MB
 * dejan margen de sobra para el peor día real y aun así cortan el cuerpo de
 * cientos de MB que tumbaría el contenedor.
 */
const MAX_BYTES_CUERPO = 32 * 1024 * 1024

export async function POST(request: NextRequest) {
  // Configurar CORS headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  // Manejar preflight OPTIONS
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 200, headers })
  }

  /**
   * CERROJO OPCIONAL, APAGADO MIENTRAS NO SE PONGA LA VARIABLE.
   *
   * QUÉ IMPIDE cuando se enciende: que cualquiera de Internet escriba horas de
   * la plantilla. Reproducido sin cookie y con «Origin: https://malicioso.example»:
   *
   *     POST /api/tracker/ingest
   *     Content-Type: text/plain          <- petición «simple»: NO hay preflight,
   *     {"employee_id":"Alejandro",        y request.json() la parsea igual, así
   *      "report_date":"2025-12-31",       que el JavaScript de cualquier web
   *      "logs":[...]}                     puede dispararla a ciegas
   *     -> HTTP 200, y la ruta llegó a insertar con SUPABASE_SERVICE_ROLE_KEY
   *
   * `employee_id` no es un UUID: es el NOMBRE («Alejandro» en las 8 filas de
   * producción). Adivinable. Con eso se inflan o se falsean las horas con las
   * que se calcula lo que se le paga a una persona.
   *
   * POR QUÉ NO SE EXIGE SIEMPRE (regla D): quien alimenta esta ruta es una
   * extensión de navegador que NO está en este repositorio y que hoy publica sin
   * credencial. Fallar cerrado sin más dejaría la ingesta muda, y muda EN
   * SILENCIO, que es la peor forma de romper algo. Así que la cerradura está
   * puesta pero sin llave echada:
   *
   *   · Sin TRACKER_INGEST_SECRET  -> se comporta EXACTAMENTE como hasta hoy.
   *   · Con TRACKER_INGEST_SECRET  -> exige la cabecera `x-tracker-secret` y
   *     contesta 401 a todo lo demás. Mismo patrón que
   *     app/api/amazon/cron-sync/route.ts:67.
   *
   * PARA ENCENDERLO hay que hacer las dos cosas EN ESTE ORDEN: primero publicar
   * la extensión mandando la cabecera, y después poner la variable en Easypanel.
   * Al revés se pierden las horas de las jornadas que haya en medio.
   */
  /**
   * LA LLAVE VA ECHADA, y ya no depende de que alguien ponga la variable.
   *
   * Arriba se explicaba por qué nacía apagada: encenderla sin publicar antes la
   * extensión perdería las horas de las jornadas de en medio. Raúl decidió que
   * ese riesgo le da igual —«lo del tracker me la pela, es más quítalo si
   * quieres»—, así que se cierra del todo, que es lo que quita el agujero.
   *
   * QUÉ IMPIDE: que cualquiera de Internet inserte horas de trabajo a nombre de
   * quien quiera. El `employee_id` es adivinable (los nombres del equipo), y
   * esta ruta escribe con la clave de servicio, o sea saltándose RLS.
   *
   *     $ curl -X POST https://SERVIDOR/api/tracker/ingest \
   *            -d '{"employee_id":"Alejandro","logs":[...]}'
   *     -> antes: 200 y las horas dentro.  ahora: 401 sin tocar la base.
   *
   * PARA VOLVER A ABRIRLO: poner TRACKER_INGEST_SECRET en Easypanel y publicar
   * la extensión mandando `x-tracker-secret`. En ese orden no se pierde nada,
   * porque hasta que exista la variable esto contesta 401 igual.
   */
  const secretoIngesta = process.env.TRACKER_INGEST_SECRET
  if (!secretoIngesta || request.headers.get('x-tracker-secret') !== secretoIngesta) {
    return NextResponse.json(
      { success: false, error: 'No autorizado' },
      { status: 401, headers }
    )
  }

  /**
   * QUÉ IMPIDE: que un cuerpo de cientos de MB se bufferice entero en memoria
   * antes de que la ruta mire nada. Se comprueba la cabecera Content-Length,
   * que es lo único que se conoce sin haber leído el cuerpo, y corta sin tocar
   * un byte del cuerpo.
   *
   * Un cuerpo troceado NO trae esa cabecera y se salta esto: ese caso lo corta
   * `leerCuerpoConTope()` más abajo, leyendo el flujo a trozos. El tope de
   * 20.000 registros NO sirve para eso —salta después del parseo, así que
   * frena las escrituras pero no el pico de memoria—; aquí decía que sí y era
   * falso.
   */
  const largoCuerpo = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(largoCuerpo) && largoCuerpo > MAX_BYTES_CUERPO) {
    return NextResponse.json(
      {
        success: false,
        error: `El cuerpo ocupa ${(largoCuerpo / (1024 * 1024)).toFixed(1)} MB y el máximo son ${MAX_BYTES_CUERPO / (1024 * 1024)} MB`,
      },
      { status: 413, headers }
    )
  }

  try {
    // Verificar variables de entorno
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      console.error('❌ [TRACKER] Missing Supabase URL')
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500, headers }
      )
    }

    // Usar service role key si está disponible (bypass RLS), sino usar anon key
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    
    if (!supabaseKey) {
      console.error('❌ [TRACKER] Missing Supabase key')
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500, headers }
      )
    }

    // Crear cliente de Supabase
    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      supabaseKey
    )

    // Aquí había un console.log que anunciaba en cada petición si el servidor
    // tenía o no SUPABASE_SERVICE_ROLE_KEY. QUÉ IMPIDE quitarlo: decirle a
    // quien lea los logs —o a quien provoque un error para verlos— con qué
    // privilegio escribe esta ruta, que es la información que decide si vale la
    // pena atacarla.

    /**
     * EL CUERPO SE LEE A TROZOS Y SE CORTA SI SE PASA.
     *
     * QUÉ IMPIDE: lo mismo que la comprobación de Content-Length de más
     * arriba, pero para el caso que aquélla no puede ver. Un cuerpo con
     * `Transfer-Encoding: chunked` NO trae esa cabecera —`Number(null ?? '')`
     * da 0— y entraba entero a parsearse. Esta ruta NO pide sesión, así que
     * ese cuerpo lo manda cualquiera de Internet. Reproducido contra el
     * servidor compilado local, sin cookie:
     *
     *   curl -H 'Transfer-Encoding: chunked' --data-binary @40MB
     *     -> HTTP 413 {"success":false,"error":"El cuerpo pasa de 32 MB…"}
     *        en 0,057 s
     *
     * El tope de 20.000 registros de más abajo NO cubre esto: salta DESPUÉS
     * del parseo, o sea que corta las escrituras pero no el parseo.
     *
     * LO QUE NO ARREGLA: el pico de RSS del proceso, que sube igual en una
     * ruta que ni lee el cuerpo. Eso se corta en el proxy de delante, no aquí.
     * Explicado en lib/subidas-limite.ts.
     *
     * Para la extensión no cambia nada: el texto es el mismo que devolvía
     * `request.json()` por dentro, y el peor informe real medido son 2.201
     * registros (del orden de cientos de kB) contra un tope de 32 MB.
     */
    const cuerpo = await leerCuerpoConTope(request, MAX_BYTES_CUERPO)
    if (cuerpo instanceof NextResponse) {
      // Se rehace la respuesta con las cabeceras CORS de esta ruta, que es la
      // única que las lleva: sin ellas la extensión recibiría un error de CORS
      // en vez del 413, y no sabría por qué.
      return NextResponse.json(
        {
          success: false,
          error: `El cuerpo pasa de ${MAX_BYTES_CUERPO / (1024 * 1024)} MB, que es el máximo`,
        },
        { status: 413, headers }
      )
    }

    // Parsear body
    let body: TrackerIngestRequest
    try {
      body = JSON.parse(cuerpo.texto)
    } catch (parseError) {
      console.error('❌ [TRACKER] Error parsing JSON:', parseError)
      return NextResponse.json(
        { success: false, error: 'Invalid JSON format' },
        { status: 400, headers }
      )
    }

    console.log('📥 [TRACKER] Received request:', {
      employee_id: body.employee_id,
      report_date: body.report_date,
      logs_count: body.logs?.length || 0
    })

    // Validación básica
    if (!body.employee_id || !body.report_date || !Array.isArray(body.logs)) {
      console.error('❌ [TRACKER] Invalid request format:', {
        has_employee_id: !!body.employee_id,
        has_report_date: !!body.report_date,
        is_logs_array: Array.isArray(body.logs)
      })
      return NextResponse.json(
        { success: false, error: 'Invalid request format. Required: employee_id, report_date, logs[]' },
        { status: 400, headers }
      )
    }

    // Tope de registros: ver MAX_LOGS_POR_PETICION arriba. Esta comprobación va
    // ANTES del bucle, que es lo que importa: dentro del bucle cada elemento es
    // una escritura con service_role.
    if (body.logs.length > MAX_LOGS_POR_PETICION) {
      console.error('❌ [TRACKER] Petición por encima del tope de registros:', {
        recibidos: body.logs.length,
        maximo: MAX_LOGS_POR_PETICION,
      })
      return NextResponse.json(
        {
          success: false,
          error: `Se han enviado ${body.logs.length} registros y el máximo por petición son ${MAX_LOGS_POR_PETICION}`,
        },
        { status: 413, headers }
      )
    }

    // Parsear fecha del reporte
    const reportDate = new Date(body.report_date)
    if (isNaN(reportDate.getTime())) {
      console.error('❌ [TRACKER] Invalid date format:', body.report_date)
      return NextResponse.json(
        { success: false, error: 'Invalid date format' },
        { status: 400, headers }
      )
    }

    // Redondear la fecha al inicio del día (00:00:00) para agrupar por día completo
    const dayStart = new Date(reportDate)
    dayStart.setHours(0, 0, 0, 0)

    // Buscar si ya existe un reporte para este empleado en este día
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
    
    console.log('🔍 [TRACKER] Buscando reporte existente:', {
      employee_id: body.employee_id,
      employee_id_type: typeof body.employee_id,
      employee_id_length: body.employee_id?.length,
      dayStart: dayStart.toISOString(),
      dayEnd: dayEnd.toISOString()
    })
    
    const { data: existingReports, error: findError } = await supabase
      .from('tracker_reports')
      .select('id, employee_id, report_date, created_at')
      .eq('employee_id', body.employee_id.trim()) // Trim para eliminar espacios
      .gte('report_date', dayStart.toISOString())
      .lt('report_date', dayEnd.toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
    
    if (findError) {
      console.error('❌ [TRACKER] Error buscando reporte existente:', findError)
    } else {
      console.log('📋 [TRACKER] Reportes existentes encontrados:', existingReports?.length || 0, existingReports)
    }

    let report: { id: string; employee_id: string; report_date: string; created_at: string }

    /**
     * ¿EL INFORME LO HA CREADO ESTA MISMA PETICIÓN, O YA ESTABA?
     *
     * De esto depende si el `delete` de más abajo es una limpieza o una
     * destrucción de histórico ajeno. Ver el comentario largo junto al delete.
     */
    let reporteCreadoEnEstaPeticion = false

    if (existingReports && existingReports.length > 0 && !findError) {
      // Usar el reporte existente
      report = existingReports[0]
      console.log('✅ [TRACKER] Using existing report:', report.id)
    } else {
      // Crear nuevo reporte con la fecha al inicio del día
      const trimmedEmployeeId = body.employee_id.trim()
      console.log('📝 [TRACKER] Creando nuevo reporte:', {
        employee_id: trimmedEmployeeId,
        report_date: dayStart.toISOString()
      })
      
      const { data: reportData, error: reportError } = await supabase.rpc('insert_tracker_report', {
        p_employee_id: trimmedEmployeeId,
        p_report_date: dayStart.toISOString()
      })

      if (reportError || !reportData || reportData.length === 0) {
        console.error('❌ [TRACKER] Error inserting tracker report:', reportError)
        return NextResponse.json(
          { 
            success: false, 
            error: 'Failed to create report',
            details: reportError?.message || 'Unknown error'
          },
          { status: 500, headers }
        )
      }

      report = reportData[0]
      reporteCreadoEnEstaPeticion = true
      console.log('✅ [TRACKER] Report created:', report.id)
    }

    // Insertar logs uno por uno usando función SQL con SECURITY DEFINER
    const logErrors: any[] = []
    let insertedLogsCount = 0
    
    console.log(`📝 [TRACKER] Insertando ${body.logs.length} logs en el reporte ${report.id}`)
    
    for (let i = 0; i < body.logs.length; i++) {
      const log = body.logs[i]
      try {
        const { error: logError } = await supabase.rpc('insert_tracker_log', {
          p_report_id: report.id,
          p_domain: log.domain,
          p_url: log.url,
          p_title: log.title || null,
          p_duration_seconds: log.duration,
          p_start_time: new Date(log.startTime).toISOString(),
          p_end_time: log.endTime ? new Date(log.endTime).toISOString() : null,
        })

        if (logError) {
          logErrors.push({ index: i, log, error: logError })
          // Sin el dominio ni la URL: es el historial de navegación de una
          // persona de la plantilla y acababa entero en el log del servidor.
          // Para diagnosticar basta con qué posición falló y por qué.
          console.error(`❌ [TRACKER] Error inserting log ${i + 1}/${body.logs.length}:`, logError)
        } else {
          insertedLogsCount++
        }
      } catch (err: any) {
        logErrors.push({ index: i, log, error: { message: err.message, stack: err.stack } })
        console.error(`❌ [TRACKER] Exception inserting log ${i + 1}:`, err)
      }
    }

    if (logErrors.length > 0) {
      console.error('❌ [TRACKER] Error inserting tracker logs:', {
        total_errors: logErrors.length,
        total_logs: body.logs.length,
        // Los objetos `log` NO se registran: llevan la URL, el título y el
        // dominio de lo que la persona estaba mirando. Para saber por qué no
        // entró la fila basta el error de Postgres y la posición.
        errores: logErrors.map(e => ({
          index: e.index,
          mensaje: e.error?.message ?? String(e.error),
        })),
      })

      /**
       * EL BORRADO SOLO ALCANZA A LO QUE HA CREADO ESTA MISMA PETICIÓN.
       *
       * QUÉ IMPIDE: que cualquiera de Internet, SIN sesión, borre el histórico
       * de horas de la plantilla. Reproducido de punta a punta contra el
       * servidor Next real apuntando a un Supabase de mentira (para no escribir
       * en producción), sin cookie:
       *
       *     POST /api/tracker/ingest
       *     {"employee_id":"Alejandro",        <- el employee_id es el NOMBRE,
       *      "report_date":"2025-12-31",          no un UUID: adivinable
       *      "logs":[{"startTime":"basura",…}]}   <- new Date('basura').toISOString()
       *                                              lanza RangeError -> logErrors
       *     -> el servidor ejecutó literalmente
       *        DELETE /rest/v1/tracker_reports?id=eq.<INFORME QUE YA EXISTÍA>
       *
       * Y supabase/migrations/021_create_employee_tracker_tables.sql:17 declara
       * `tracker_logs.report_id REFERENCES tracker_reports(id) ON DELETE CASCADE`,
       * así que ese DELETE se lleva por delante TODOS los registros del día.
       * Iterando las 8 fechas que hay, un anónimo vaciaba las 6.993 filas de
       * tracker_logs: la fuente con la que se calcula lo que se le paga a cada
       * persona.
       *
       * El fallo estaba en QUÉ informe se borraba: la ruta busca por
       * `employee_id` + día y REUTILIZA el que encuentre, así que `report.id`
       * podía ser un informe de hace meses lleno de datos. Borrarlo no era una
       * limpieza: era destruir el trabajo de otro día.
       *
       * LO QUE NO CAMBIA: cuando el informe lo acaba de crear esta petición
       * —que es el único caso para el que se escribió este borrado— la limpieza
       * se hace igual que siempre, y la respuesta que recibe la extensión es la
       * misma en los dos casos. Lo único que cambia es que un informe que ya
       * estaba se queda donde estaba.
       */
      if (reporteCreadoEnEstaPeticion) {
        try {
          await supabase.from('tracker_reports').delete().eq('id', report.id)
        } catch (deleteErr) {
          console.error('❌ [TRACKER] Error deleting report after log failure:', deleteErr)
        }
      } else {
        console.error(
          '❌ [TRACKER] El informe ya existía antes de esta petición, NO se borra:',
          report.id
        )
      }

      /**
       * EL ERROR SALE RECORTADO AL MENSAJE, SIN LA PILA.
       *
       * QUÉ IMPIDE: que esta ruta —que NO pide sesión— le regale a quien la
       * llame la ruta de despliegue del contenedor. Reproducido sin cookie
       * contra el servidor compilado, mandando un log con una fecha inválida:
       *
       *   POST /api/tracker/ingest
       *   {"employee_id":"Alejandro","report_date":"2025-12-31",
       *    "logs":[{"startTime":"basura",…}]}
       *
       *   HTTP 500 … "stack":"RangeError: Invalid time value\n
       *     at Date.toISOString (<anonymous>)\n
       *     at p (/RUTA/ABSOLUTA/DEL/SERVIDOR/.next/server/app/api/tracker/
       *           ingest/route.js:1:4319)…"
       *
       * Eso confirma además que el 500 lo da la ruta y no el proxy, que es
       * información de reconocimiento gratis para quien esté probando.
       *
       * Es el MISMO recorte que ya se hacía unas líneas más arriba para el
       * console.error. `details` no cambia —ya salía recortado— y la extensión
       * solo mira `success`, así que para quien lo usa no cambia nada.
       */
      return NextResponse.json(
        {
          success: false,
          error: `Failed to insert ${logErrors.length} of ${body.logs.length} logs`,
          details: logErrors[0]?.error?.message || logErrors[0]?.error || 'Unknown error',
          errors: logErrors.map(e => ({
            index: e.index,
            mensaje: e.error?.message ?? String(e.error),
          }))
        },
        { status: 500, headers }
      )
    }

    console.log(`✅ [TRACKER] Report created: ${report.id} with ${insertedLogsCount} logs`)
    
    /**
     * VERIFICACIÓN SIN DEVOLVER NAVEGACIÓN DE NADIE.
     *
     * QUÉ IMPIDE: que esta ruta —que NO pide sesión— le enseñe a quien la llame
     * por dónde ha navegado un empleado. Antes hacía
     * `.select('id, domain, start_time')` y metía las filas tal cual en la
     * respuesta, dentro de `verification.sample_logs`, además de volcarlas al
     * log del servidor. Con eso, cualquiera que acertara el nombre —«Alejandro»,
     * que es lo que hay en las 8 filas de producción— y una fecha, se llevaba
     * dominios y horas reales de trabajo de esa persona: no hacía falta ni
     * escribir nada.
     *
     * Se sigue consultando la misma tabla con el mismo `.limit(5)`, así que
     * `logs_found` devuelve EXACTAMENTE el mismo número que antes y lo que la
     * extensión reciba no cambia. Lo que ya no se pide a la base —ni se
     * devuelve, ni se escribe en el log— son las columnas `domain` y
     * `start_time`: solo el `id`, que es un UUID y no dice nada de nadie.
     */
    const { data: verifyLogs, error: verifyError } = await supabase
      .from('tracker_logs')
      .select('id')
      .eq('report_id', report.id)
      .limit(5)

    console.log('🔍 [TRACKER] Verificación de logs guardados:', {
      report_id: report.id,
      logs_found: verifyLogs?.length || 0,
      verify_error: verifyError,
    })

    return NextResponse.json(
      {
        success: true,
        report_id: report.id,
        logs_inserted: insertedLogsCount,
        verification: {
          logs_found: verifyLogs?.length || 0,
        }
      },
      { status: 200, headers }
    )
  } catch (error: any) {
    console.error('❌ [TRACKER] Unexpected error:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error',
        details: error?.message || String(error)
      },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
    )
  }
}

