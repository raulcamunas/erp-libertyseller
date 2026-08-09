import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/api'
import { createClient } from '@/lib/supabase/server'
import OpenAI from 'openai'
import { nanoid } from 'nanoid'

// Lazy initialization
function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    return null
  }
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  })
}

interface GenerateReportRequest {
  clientId: string
  clientName: string
  changes: Array<{
    'Texto de palabra clave': string
    'Operación': string
    'Puja Original'?: number
    'Puja': number
    'Gasto'?: number
    'ACOS'?: number
    'CPC'?: number
    'ROAS'?: number
    'CTR'?: number
    'Clics'?: number
    'Ventas'?: number
    'Decision Maker'?: 'ALGORITHM' | 'AI'
    'AI Reasoning'?: string
    'Entidad'?: string
  }>
  clientContext: {
    target_acos: number
    total_spend_week: number
    global_acos: number
    total_sales?: number
    total_clicks?: number
    avg_cpc?: number
    avg_ctr?: number
    roas?: number
  }
  bleeders: Array<{
    term: string
    spend: number
    sales: number
    clicks: number
    acos?: number
  }>
  winners: Array<{
    term: string
    acos: number
    sales: number
    conversion_rate?: number
  }>
  harvestOpportunities: Array<{
    term: string
    origin_campaign: string
    orders: number
    acos?: number
  }>
}

const SYSTEM_PROMPT = `Eres LibertyAI, el Director de Estrategia PPC de una agencia de alto rendimiento. Tu tarea es crear un reporte ejecutivo detallado y profesional para compartir con clientes.

El reporte debe explicar:
1. **Resumen Ejecutivo**: Estado general de la cuenta y objetivos alcanzados
2. **Análisis de Cambios**: Por qué se realizó cada tipo de cambio (Bleeders, Winners, Harvesting)
3. **Impacto Esperado**: Qué mejoras se esperan con estos cambios
4. **Recomendaciones Estratégicas**: Próximos pasos y oportunidades

**Formato requerido (Markdown):**
- Usa títulos y subtítulos claros
- Incluye métricas clave en negrita
- Sé profesional pero accesible
- Explica el "por qué" detrás de cada decisión
- Usa emojis estratégicamente para mejorar la legibilidad

**Tono**: Profesional, directo, orientado a resultados.`

export async function POST(request: NextRequest) {
  try {
    // QUÉ IMPIDE: que esta ruta le conteste a cualquiera de internet. No
    // comprobaba nada, y middleware.ts (línea 41) declara pública toda /api/,
    // así que bastaba un curl SIN cookie para dispararla. Ver lib/auth/api.ts,
    // donde está reproducido con el curl exacto.
    //
    // Llama a OpenAI con la clave de la empresa y ESCRIBE en
    // ppc_optimization_reports. La llaman components/ppc/AIInsightsPanel.tsx y
    // OptimizerTool.tsx, con sesión.
    //
    // Se pide SESIÓN y nada más —ni rol ni permiso de módulo— a propósito: hoy
    // esta pantalla la abre cualquiera con sesión, y exigir un permiso que hoy
    // no se exige dejaría fuera a alguien que trabaja.
    const sesion = await requireSession()
    if (sesion instanceof NextResponse) return sesion

    const body: GenerateReportRequest = await request.json()

    if (!body.clientId || !body.changes || body.changes.length === 0) {
      return NextResponse.json(
        { error: 'Datos incompletos' },
        { status: 400 }
      )
    }

    console.log('📊 [GENERATE-REPORT] Datos recibidos:', {
      clientId: body.clientId,
      changesCount: body.changes.length,
      clientContext: body.clientContext,
    })

    const supabase = await createClient()

    // Calcular métricas agregadas
    const totalChanges = body.changes.length
    const updates = body.changes.filter(c => c['Operación'] === 'UPDATE').length
    const creates = body.changes.filter(c => c['Operación'] === 'CREATE' && c['Entidad'] !== 'Palabra clave negativa').length
    const negatives = body.changes.filter(c => c['Entidad'] === 'Palabra clave negativa').length
    const aiDecisions = body.changes.filter(c => c['Decision Maker'] === 'AI').length

    // Usar datos REALES del clientContext, no de los cambios individuales
    // Asegurarse de que clientContext existe y tiene los datos correctos
    if (!body.clientContext) {
      console.error('❌ [GENERATE-REPORT] clientContext no existe')
      return NextResponse.json(
        { error: 'clientContext es requerido' },
        { status: 400 }
      )
    }
    
    const totalSpend = Number(body.clientContext.total_spend_week) || 0
    const totalSales = Number(body.clientContext.total_sales) || 0
    const totalClicks = Number(body.clientContext.total_clicks) || 0
    const globalACOS = (Number(body.clientContext.global_acos) || 0) * 100 // Convertir a porcentaje
    const avgCPC = Number(body.clientContext.avg_cpc) || 0
    const avgCTR = Number(body.clientContext.avg_ctr) || 0
    const roas = Number(body.clientContext.roas) || (totalSpend > 0 ? (totalSales / totalSpend) : 0)
    
    console.log('📊 [GENERATE-REPORT] Métricas calculadas:', {
      totalSpend,
      totalSales,
      totalClicks,
      globalACOS,
      avgCPC,
      roas,
      clientContext: body.clientContext,
    })
    
    // Calcular ACOS promedio solo de las keywords que tienen datos
    const keywordsWithACOS = body.changes.filter(c => c['ACOS'] && c['ACOS'] > 0)
    const avgACOS = keywordsWithACOS.length > 0
      ? keywordsWithACOS.reduce((sum, c) => sum + (c['ACOS'] || 0), 0) / keywordsWithACOS.length
      : 0

    // Preparar prompt para IA
    const userPrompt = `Genera un reporte ejecutivo detallado para el cliente ${body.clientName}.

**Contexto:**
- ACOS Objetivo: ${(body.clientContext.target_acos * 100).toFixed(1)}%
- ACOS Actual: ${(body.clientContext.global_acos * 100).toFixed(1)}%
- Gasto Semanal: ${body.clientContext.total_spend_week.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}

**Cambios Realizados:**
- Total: ${totalChanges} cambios
- Actualizaciones de puja: ${updates}
- Nuevas keywords: ${creates}
- Negativas añadidas: ${negatives}
- Decisiones con IA: ${aiDecisions}

**Top 3 Bleeders:**
${body.bleeders.slice(0, 3).map((b, i) => 
  `${i + 1}. "${b.term}" - ${b.spend.toFixed(2)}€ gasto, 0€ ventas, ${b.clicks} clics`
).join('\n')}

**Top 3 Winners:**
${body.winners.slice(0, 3).map((w, i) => 
  `${i + 1}. "${w.term}" - ACOS ${(w.acos * 100).toFixed(1)}%, ${w.sales.toFixed(2)}€ ventas`
).join('\n')}

**Oportunidades de Harvesting:**
${body.harvestOpportunities.slice(0, 3).map((h, i) => 
  `${i + 1}. "${h.term}" - ${h.orders} pedidos desde ${h.origin_campaign}`
).join('\n')}

Genera un reporte completo y profesional siguiendo el formato requerido.`

    // Generar insights con IA
    let aiReport = ''
    const openai = getOpenAIClient()
    
    if (openai) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 15000)

        const completion = await openai.chat.completions.create(
          {
            model: 'gpt-4o',
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.4,
            max_tokens: 2000,
          },
          { signal: controller.signal }
        )

        clearTimeout(timeoutId)
        aiReport = completion.choices[0]?.message?.content || ''
      } catch (aiError: any) {
        console.error('Error generating AI report:', aiError)
        // Continuar sin IA si falla
      }
    }

    // Si no hay reporte de IA, crear uno básico
    if (!aiReport) {
      aiReport = `# Reporte de Optimización PPC - ${body.clientName}

## Resumen Ejecutivo

Se han realizado **${totalChanges} cambios** en la cuenta para optimizar el rendimiento y acercar el ACOS al objetivo del ${(body.clientContext.target_acos * 100).toFixed(1)}%.

**Métricas Clave:**
- ACOS Actual: ${(body.clientContext.global_acos * 100).toFixed(1)}%
- Gasto Total Analizado: ${totalSpend.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}
- Ventas Totales: ${totalSales.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}

## Análisis de Cambios

### Actualizaciones de Puja (${updates})
Se han ajustado las pujas de keywords existentes para mejorar el rendimiento.

### Nuevas Keywords (${creates})
Se han añadido nuevas keywords prometedoras descubiertas en campañas automáticas.

### Negativas Añadidas (${negatives})
Se han bloqueado términos que no generan conversiones.

## Impacto Esperado

Con estos cambios, esperamos:
- Reducción del ACOS hacia el objetivo del ${(body.clientContext.target_acos * 100).toFixed(1)}%
- Mejora en la eficiencia del gasto publicitario
- Incremento en la rentabilidad de las campañas`
    }

    // Generar slug único
    const slug = `ppc-${nanoid(12)}`
    
    // Calcular semana de inicio (lunes de esta semana)
    const weekStart = new Date()
    weekStart.setDate(weekStart.getDate() - weekStart.getDay()) // Lunes de esta semana
    const weekStartStr = weekStart.toISOString().split('T')[0]
    
    console.log('📊 [GENERATE-REPORT] Generando reporte para semana:', weekStartStr)

    // Guardar reporte en la base de datos
    const { data: report, error: insertError } = await supabase
      .from('ppc_optimization_reports')
      .insert({
        client_id: body.clientId,
        slug,
        week_start_date: weekStartStr,
        report_data: {
          changes: body.changes,
          client_context: body.clientContext,
          bleeders: body.bleeders,
          winners: body.winners,
          harvest_opportunities: body.harvestOpportunities,
        },
        ai_insights: aiReport,
        changes_summary: {
          total: totalChanges,
          updates,
          creates,
          negatives,
          ai_decisions: aiDecisions,
        },
        metrics: {
          total_spend: totalSpend,
          total_sales: totalSales,
          total_clicks: totalClicks,
          avg_acos: avgACOS * 100, // Convertir a porcentaje
          global_acos: globalACOS, // Ya está en porcentaje
          target_acos: (body.clientContext.target_acos || 0) * 100, // Convertir a porcentaje
          avg_cpc: avgCPC,
          avg_ctr: avgCTR,
          roas: roas,
        },
      })
      .select()
      .single()

    if (insertError) {
      console.error('Error inserting report:', insertError)
      return NextResponse.json(
        { error: 'Error al guardar el reporte' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      reportId: report.id,
      slug: report.slug,
      publicUrl: `/report/ppc/${report.slug}`,
    })
  } catch (error: any) {
    console.error('Error generating report:', error)
    return NextResponse.json(
      { error: error.message || 'Error al generar el reporte' },
      { status: 500 }
    )
  }
}

