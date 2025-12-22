import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseHeliumXray, parseHeliumCerebro, generatePublicToken, BusinessModel } from '@/lib/parsers/helium'

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()
    
    // Verificar autenticación
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json(
        { error: 'No autenticado' },
        { status: 401 }
      )
    }

    const formData = await request.formData()
    
    // Obtener datos del formulario
    const seller_url = formData.get('seller_url') as string
    const xrayFile = formData.get('xray_file') as File
    const cerebroFile = formData.get('cerebro_file') as File | null

    if (!seller_url || !xrayFile) {
      return NextResponse.json(
        { error: 'Faltan campos requeridos: seller_url y xray_file' },
        { status: 400 }
      )
    }

    // Leer contenido de los archivos
    const xrayContent = await xrayFile.text()
    const cerebroContent = cerebroFile ? await cerebroFile.text() : null

    // Parsear archivos
    const xrayData = parseHeliumXray(xrayContent)
    const cerebroData = cerebroContent ? parseHeliumCerebro(cerebroContent) : null

    if (xrayData.rows.length === 0) {
      return NextResponse.json(
        { error: 'El archivo Xray está vacío o tiene formato incorrecto' },
        { status: 400 }
      )
    }

    // Preparar datos de entrada para guardar en JSONB
    const inputData = {
      seller_url,
      xray: {
        total_rows: xrayData.rows.length,
        products_analyzed: xrayData.top10Products.length, // Ahora puede ser hasta 100
        top10_products: xrayData.top10Products.slice(0, 10).map(p => ({
          asin: p.ASIN || p.asin || '',
          title: p.Title || p.title || '',
          price: p.price,
          sales: p.asinSales,
          reviews: p.reviews,
          activeSellers: p.activeSellers,
        })),
        all_products: xrayData.top10Products.map(p => ({
          asin: p.ASIN || p.asin || '',
          title: p.Title || p.title || '',
          price: p.price,
          sales: p.asinSales,
          reviews: p.reviews,
          activeSellers: p.activeSellers,
        })),
        metrics: {
          avgActiveSellers: xrayData.avgActiveSellers,
          avgPrice: xrayData.avgPrice,
          avgFees: xrayData.avgFees,
          avgSales: xrayData.avgSales,
          avgReviews: xrayData.avgReviews,
        },
      },
      cerebro: cerebroData ? {
        total_rows: cerebroData.rows.length,
        top_keywords: cerebroData.topKeywords.map(k => ({
          keyword: k.keyword,
          searchVolume: k.searchVolume,
        })),
      } : null,
    }

    // Generar token público único
    let publicToken = generatePublicToken()
    let tokenExists = true
    let attempts = 0
    const maxAttempts = 10

    // Verificar que el token sea único
    while (tokenExists && attempts < maxAttempts) {
      const { data: existing } = await supabase
        .from('audit_reports')
        .select('id')
        .eq('public_token', publicToken)
        .single()

      if (!existing) {
        tokenExists = false
      } else {
        publicToken = generatePublicToken()
        attempts++
      }
    }

    if (tokenExists) {
      return NextResponse.json(
        { error: 'Error al generar token único. Intenta de nuevo.' },
        { status: 500 }
      )
    }

    // Determinar modelo de negocio
    const businessModel: BusinessModel = xrayData.businessModel

    // Calcular métricas
    const { calculateMetrics } = await import('@/lib/auditor/calculator')
    const computedMetrics = calculateMetrics(xrayData, cerebroData, businessModel)

    // Crear input_data completo con computed_metrics
    const inputDataWithMetrics = {
      ...inputData,
      computed_metrics: computedMetrics,
    }

    // Insertar en la base de datos
    console.log('Insertando reporte con token:', publicToken)
    const { data: auditReport, error: insertError } = await supabase
      .from('audit_reports')
      .insert({
        public_token: publicToken,
        seller_url,
        business_model: businessModel,
        input_data: inputDataWithMetrics,
        status: 'processing',
      })
      .select('id, public_token, created_at')
      .single()

    if (insertError) {
      console.error('Error insertando reporte:', insertError)
      return NextResponse.json(
        { error: 'Error al guardar el reporte en la base de datos', details: insertError.message },
        { status: 500 }
      )
    }

    if (!auditReport) {
      console.error('No se devolvió el reporte después de insertar')
      return NextResponse.json(
        { error: 'Error al guardar el reporte en la base de datos' },
        { status: 500 }
      )
    }

    console.log('Reporte insertado correctamente:', auditReport.id, auditReport.public_token)

    // Generar análisis IA en background (no bloqueamos la respuesta)
    if (computedMetrics) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 
                     request.headers.get('origin') || 
                     `https://${request.headers.get('host')}`
      
      fetch(`${baseUrl}/api/auditor/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          computed_metrics: computedMetrics,
          business_model: businessModel,
          seller_url,
        }),
      })
        .then(async (res) => {
          if (res.ok) {
            const aiAnalysis = await res.json()
            await supabase
              .from('audit_reports')
              .update({ 
                ai_analysis: aiAnalysis,
                status: 'completed',
              })
              .eq('id', auditReport.id)
          }
        })
        .catch((err) => {
          console.error('Error generando análisis IA:', err)
          // Marcar como completado aunque falle la IA
          supabase
            .from('audit_reports')
            .update({ status: 'completed' })
            .eq('id', auditReport.id)
        })
    } else {
      // Si no hay métricas, marcar como completado
      await supabase
        .from('audit_reports')
        .update({ status: 'completed' })
        .eq('id', auditReport.id)
    }

    return NextResponse.json({
      id: auditReport.id,
      public_token: auditReport.public_token,
      business_model: businessModel,
      created_at: auditReport.created_at,
    })
  } catch (error: any) {
    console.error('Error en upload de auditor:', error)
    return NextResponse.json(
      { error: error.message || 'Error al procesar la solicitud' },
      { status: 500 }
    )
  }
}

