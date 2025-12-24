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
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      console.error('❌ [TRACKER] Missing Supabase environment variables')
      return NextResponse.json(
        { success: false, error: 'Server configuration error' },
        { status: 500, headers }
      )
    }

    // Crear cliente de Supabase público (sin autenticación)
    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )

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
    const { data: existingReports, error: findError } = await supabase
      .from('tracker_reports')
      .select('id, employee_id, report_date, created_at')
      .eq('employee_id', body.employee_id)
      .gte('report_date', dayStart.toISOString())
      .lt('report_date', dayEnd.toISOString())
      .order('created_at', { ascending: false })
      .limit(1)

    let report: { id: string; employee_id: string; report_date: string; created_at: string }

    if (existingReports && existingReports.length > 0 && !findError) {
      // Usar el reporte existente
      report = existingReports[0]
      console.log('✅ [TRACKER] Using existing report:', report.id)
    } else {
      // Crear nuevo reporte con la fecha al inicio del día
      const { data: reportData, error: reportError } = await supabase.rpc('insert_tracker_report', {
        p_employee_id: body.employee_id,
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
    
    for (const log of body.logs) {
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
        logErrors.push(logError)
        console.error('❌ [TRACKER] Error inserting log:', logError)
      } else {
        insertedLogsCount++
      }
    }

    if (logErrors.length > 0) {
      console.error('❌ [TRACKER] Error inserting tracker logs:', logErrors)
      // Intentar eliminar el reporte si falla la inserción de logs
      await supabase.from('tracker_reports').delete().eq('id', report.id)
      return NextResponse.json(
        { 
          success: false, 
          error: 'Failed to insert logs',
          details: logErrors[0]?.message || 'Unknown error'
        },
        { status: 500, headers }
      )
    }

    console.log(`✅ [TRACKER] Report created: ${report.id} with ${insertedLogsCount} logs`)

    return NextResponse.json(
      { success: true, report_id: report.id },
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

