import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

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
    
    console.log('🔑 [TRACKER] Using Supabase key type:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SERVICE_ROLE' : 'ANON')

    // Parsear body
    let body: TrackerIngestRequest
    try {
      body = await request.json()
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
      console.log('✅ [TRACKER] Report created:', report.id)
    }

    // Insertar logs uno por uno usando función SQL con SECURITY DEFINER
    const logErrors: any[] = []
    let insertedLogsCount = 0
    
    console.log(`📝 [TRACKER] Insertando ${body.logs.length} logs en el reporte ${report.id}`)
    
    for (let i = 0; i < body.logs.length; i++) {
      const log = body.logs[i]
      try {
        const { data: logData, error: logError } = await supabase.rpc('insert_tracker_log', {
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
          console.error(`❌ [TRACKER] Error inserting log ${i + 1}/${body.logs.length}:`, {
            log: { domain: log.domain, url: log.url, startTime: log.startTime },
            error: logError
          })
        } else {
          insertedLogsCount++
          if (i < 3 || i === body.logs.length - 1) {
            console.log(`✅ [TRACKER] Log ${i + 1}/${body.logs.length} insertado:`, logData)
          }
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
        errors: logErrors
      })
      // Intentar eliminar el reporte si falla la inserción de logs
      try {
        await supabase.from('tracker_reports').delete().eq('id', report.id)
      } catch (deleteErr) {
        console.error('❌ [TRACKER] Error deleting report after log failure:', deleteErr)
      }
      return NextResponse.json(
        { 
          success: false, 
          error: `Failed to insert ${logErrors.length} of ${body.logs.length} logs`,
          details: logErrors[0]?.error?.message || logErrors[0]?.error || 'Unknown error',
          errors: logErrors.map(e => ({ index: e.index, error: e.error }))
        },
        { status: 500, headers }
      )
    }

    console.log(`✅ [TRACKER] Report created: ${report.id} with ${insertedLogsCount} logs`)
    
    // Verificar que los logs se guardaron correctamente
    const { data: verifyLogs, error: verifyError } = await supabase
      .from('tracker_logs')
      .select('id, domain, start_time')
      .eq('report_id', report.id)
      .limit(5)
    
    console.log('🔍 [TRACKER] Verificación de logs guardados:', {
      report_id: report.id,
      logs_found: verifyLogs?.length || 0,
      sample_logs: verifyLogs,
      verify_error: verifyError
    })

    return NextResponse.json(
      { 
        success: true, 
        report_id: report.id,
        logs_inserted: insertedLogsCount,
        verification: {
          logs_found: verifyLogs?.length || 0,
          sample_logs: verifyLogs?.slice(0, 3) || []
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

