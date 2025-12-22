import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> | { token: string } }
) {
  try {
    // Manejar parámetros asíncronos en Next.js 14+
    const resolvedParams = await Promise.resolve(params)
    const token = resolvedParams.token

    if (!token) {
      return NextResponse.json(
        { error: 'Token requerido' },
        { status: 400 }
      )
    }

    // Usar cliente anónimo para acceso público
    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    // Buscar reporte por public_token
    console.log('Buscando reporte con token:', token)
    const { data: report, error } = await supabase
      .from('audit_reports')
      .select('*')
      .eq('public_token', token)
      .single()

    if (error) {
      console.error('Error fetching audit report:', error)
      return NextResponse.json(
        { error: 'Reporte no encontrado', details: error.message },
        { status: 404 }
      )
    }

    if (!report) {
      console.log('No se encontró reporte con token:', token)
      return NextResponse.json(
        { error: 'Reporte no encontrado' },
        { status: 404 }
      )
    }

    console.log('Reporte encontrado:', report.id, report.status)

    // Extraer computed_metrics de input_data si existen
    let computedMetrics = null
    if (report.input_data && typeof report.input_data === 'object') {
      computedMetrics = report.input_data.computed_metrics || null
    }

    // Si el reporte está en processing pero tenemos computed_metrics, devolverlos
    if (report.status === 'processing' && computedMetrics) {
      return NextResponse.json({
        ...report,
        computed_metrics: computedMetrics,
        ai_analysis: report.ai_analysis || null,
      })
    }

    // Si está en processing sin métricas, devolver datos básicos
    if (report.status === 'processing') {
      return NextResponse.json({
        ...report,
        computed_metrics: null,
        ai_analysis: null,
      })
    }

    // Si no hay computed_metrics, intentar calcularlos desde input_data
    if (!computedMetrics && report.input_data) {
      const { calculateMetrics } = await import('@/lib/auditor/calculator')
      const { parseHeliumXray, parseHeliumCerebro } = await import('@/lib/parsers/helium')

      try {
        // Reconstruir datos parseados desde input_data
        if (report.input_data.xray && report.input_data.xray.total_rows > 0) {
          // Nota: Esto requeriría guardar el CSV original o reconstruir los datos
          // Por ahora, devolvemos lo que tenemos
        }
      } catch (err) {
        console.error('Error calculando métricas:', err)
      }
    }

    // Si hay ai_analysis, usarlo; si no, intentar generarlo
    let aiAnalysis = report.ai_analysis
    if (!aiAnalysis && computedMetrics && report.business_model) {
      try {
        // Construir URL base
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 
                       request.headers.get('origin') || 
                       `https://${request.headers.get('host')}`
        
        const analyzeResponse = await fetch(`${baseUrl}/api/auditor/analyze`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            computed_metrics: computedMetrics,
            business_model: report.business_model,
            seller_url: report.seller_url,
          }),
        })

        if (analyzeResponse.ok) {
          aiAnalysis = await analyzeResponse.json()
          
          // Guardar el análisis en la DB
          await supabase
            .from('audit_reports')
            .update({ ai_analysis: aiAnalysis })
            .eq('id', report.id)
        }
      } catch (err) {
        console.error('Error generando análisis IA:', err)
      }
    }

    return NextResponse.json({
      ...report,
      computed_metrics: computedMetrics,
      ai_analysis: aiAnalysis,
    })
  } catch (error: any) {
    console.error('Error en share endpoint:', error)
    return NextResponse.json(
      { error: 'Error al obtener el reporte' },
      { status: 500 }
    )
  }
}

