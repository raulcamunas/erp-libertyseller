import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

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
    const supabase = await createClient()
    const body: TrackerIngestRequest = await request.json()

    // Validación básica
    if (!body.employee_id || !body.report_date || !Array.isArray(body.logs)) {
      return NextResponse.json(
        { success: false, error: 'Invalid request format' },
        { status: 400, headers }
      )
    }

    // Validar que employee_id existe (opcional por ahora, pero verificamos en profiles)
    // Por ahora aceptamos cualquier employee_id

    // Parsear fecha del reporte
    const reportDate = new Date(body.report_date)

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
      console.error('Error inserting tracker report:', reportError)
      return NextResponse.json(
        { success: false, error: 'Failed to create report' },
        { status: 500, headers }
      )
    }

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
      console.error('Error inserting tracker logs:', logsError)
      // Intentar eliminar el reporte si falla la inserción de logs
      await supabase.from('tracker_reports').delete().eq('id', report.id)
      return NextResponse.json(
        { success: false, error: 'Failed to insert logs' },
        { status: 500, headers }
      )
    }

    console.log(`✅ [TRACKER] Report created: ${report.id} with ${logsToInsert.length} logs`)

    return NextResponse.json(
      { success: true, report_id: report.id },
      { status: 200, headers }
    )
  } catch (error) {
    console.error('Error in tracker ingest:', error)
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
    )
  }
}

