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

    // Insertar el reporte
    const { data: report, error: reportError } = await supabase
      .from('tracker_reports')
      .insert({
        employee_id: body.employee_id,
        report_date: reportDate.toISOString(),
      })
      .select()
      .single()

    if (reportError || !report) {
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

    console.log('✅ [TRACKER] Report created:', report.id)

    // Preparar logs para inserción
    const logsToInsert = body.logs.map((log) => ({
      report_id: report.id,
      domain: log.domain,
      url: log.url,
      title: log.title || null,
      duration_seconds: log.duration,
      start_time: new Date(log.startTime).toISOString(),
      end_time: log.endTime ? new Date(log.endTime).toISOString() : null,
    }))

    // Insertar todos los logs
    const { error: logsError } = await supabase
      .from('tracker_logs')
      .insert(logsToInsert)

    if (logsError) {
      console.error('❌ [TRACKER] Error inserting tracker logs:', logsError)
      // Intentar eliminar el reporte si falla la inserción de logs
      await supabase.from('tracker_reports').delete().eq('id', report.id)
      return NextResponse.json(
        { 
          success: false, 
          error: 'Failed to insert logs',
          details: logsError?.message || 'Unknown error'
        },
        { status: 500, headers }
      )
    }

    console.log(`✅ [TRACKER] Report created: ${report.id} with ${logsToInsert.length} logs`)

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

