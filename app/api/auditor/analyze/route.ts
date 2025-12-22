import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { ComputedMetrics } from '@/lib/auditor/calculator'
import { BusinessModel } from '@/lib/parsers/helium'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

interface AnalyzeRequest {
  computed_metrics: ComputedMetrics
  business_model: BusinessModel
  seller_url?: string
}

interface AnalyzeResponse {
  headline: string
  executive_summary: string
  money_left_on_table: string
  action_plan: Array<{
    title: string
    impact: 'High' | 'Medium' | 'Low'
    description: string
  }>
}

function buildSystemPrompt(businessModel: BusinessModel, metrics: ComputedMetrics): string {
  if (businessModel === 'ARBITRAGE') {
    const totalMarketVal = metrics.top_products.reduce((sum, p) => sum + p.revenue, 0)
    const avgSellers = metrics.model_specific_metrics.avg_sellers_per_listing || 0
    const buyBoxGaps = metrics.model_specific_metrics.buy_box_gaps || 0
    const saturatedNiches = metrics.model_specific_metrics.saturated_niches || 0

    return `Eres el Auditor Principal de Liberty Seller. Estás analizando la cuenta de un potencial cliente que opera con modelo ARBITRAGE (Reselling). Tu tono es directo, basado en datos y ligeramente alarmista sobre las oportunidades perdidas (FOMO).

**CONTEXTO DEL CLIENTE:**
- Modelo de Negocio: ARBITRAGE (Reselling)
- Total de Mercado Analizado: $${totalMarketVal.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
- Promedio de Vendedores por Listing: ${avgSellers.toFixed(1)}
- Buy Box Gaps Detectados: ${buyBoxGaps}
- Nichos Saturados: ${saturatedNiches}
- Risk Score: ${metrics.risk_score}/100
- Oportunidad Perdida: $${metrics.total_opportunity_value.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}

**TU ENFOQUE:**
- Céntrate en: 'Share of the Pie', Guerra de Precios y Rotación de Stock
- Frase Clave que DEBES usar: "Estás compitiendo por un pastel de $${totalMarketVal.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}, pero tu trozo actual es pequeño por falta de optimización de Buy Box."
- Consejo Principal: Habla de Repricing Dinámico y limpieza de stock muerto (ghost products)
- Sé brutalmente honesto sobre la competencia y la saturación del mercado

**TOP PRODUCTOS:**
${metrics.top_products.map((p, i) => `${i + 1}. ${p.title.substring(0, 60)} - Revenue: $${p.revenue.toFixed(0)}, Estimated Share: $${(p.estimatedShare || 0).toFixed(0)}`).join('\n')}

**GHOST PRODUCTOS (Stock Muerto):**
${metrics.ghost_products.map((p, i) => `${i + 1}. ${p.title.substring(0, 60)} - Revenue: $${p.revenue.toFixed(0)}, pero Estimated Share solo: $${(p.estimatedShare || 0).toFixed(0)}`).join('\n')}

**TU TAREA:**
Genera un análisis que VENDA LA SOLUCIÓN. No describas los datos, explica QUÉ ESTÁN PERDIENDO y CÓMO LO ARREGLAMOS.

Devuelve SOLO un JSON válido con esta estructura exacta:
{
  "headline": "Frase de impacto de 1 línea (máximo 120 caracteres)",
  "executive_summary": "2 párrafos de análisis brutalmente honesto. Párrafo 1: El problema. Párrafo 2: La solución. Usa datos específicos.",
  "money_left_on_table": "Cifra estimada en € anuales (ej: '€45.000 anuales')",
  "action_plan": [
    { "title": "Acción 1", "impact": "High", "description": "Descripción detallada de la acción y su impacto" },
    { "title": "Acción 2", "impact": "High", "description": "Descripción detallada" },
    { "title": "Acción 3", "impact": "Medium", "description": "Descripción detallada" }
  ]
}

IMPORTANTE: El action_plan debe tener mínimo 3 acciones, priorizando High impact.`
  }

  if (businessModel === 'PRIVATE_LABEL') {
    const seoGapVolume = metrics.model_specific_metrics.seo_gap_volume || 0
    const adDependency = metrics.model_specific_metrics.ad_dependency_score || 0
    const invisibleKeywords = metrics.model_specific_metrics.invisible_traffic_keywords || 0
    const totalRevenue = metrics.top_products.reduce((sum, p) => sum + p.revenue, 0)

    return `Eres el Auditor Principal de Liberty Seller. Estás analizando la cuenta de un potencial cliente que opera con modelo PRIVATE LABEL (Marca Propia). Tu tono es directo, basado en datos y ligeramente alarmista sobre las oportunidades perdidas (FOMO).

**CONTEXTO DEL CLIENTE:**
- Modelo de Negocio: PRIVATE LABEL (Marca Propia)
- Revenue Total: $${totalRevenue.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
- Tráfico SEO Perdido: ${seoGapVolume.toLocaleString('es-ES')} búsquedas/mes
- Keywords Invisibles: ${invisibleKeywords} keywords donde no rankeas en página 1
- Ad Dependency Score: ${adDependency}/100 (${adDependency > 70 ? 'ALTA DEPENDENCIA' : adDependency > 40 ? 'DEPENDENCIA MODERADA' : 'BAJA DEPENDENCIA'})
- Risk Score: ${metrics.risk_score}/100
- Oportunidad Perdida: $${metrics.total_opportunity_value.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}

**TU ENFOQUE:**
- Céntrate en: Branding, SEO Orgánico y Valor de Marca
- Frase Clave que DEBES usar: "Tu marca tiene fugas de tráfico. Tienes ${seoGapVolume.toLocaleString('es-ES')} búsquedas mensuales ignorando tus productos porque no rankeas en página 1."
- Consejo Principal: Habla de optimización visual (A+ Content) y defensa de marca
- Sé brutalmente honesto sobre la dependencia de anuncios y la falta de presencia orgánica

**TOP PRODUCTOS:**
${metrics.top_products.map((p, i) => `${i + 1}. ${p.title.substring(0, 60)} - Revenue: $${p.revenue.toFixed(0)}, Reviews: ${p.reviews.toLocaleString('es-ES')}`).join('\n')}

**GHOST PRODUCTOS (Sin Potencial Explotado):**
${metrics.ghost_products.map((p, i) => `${i + 1}. ${p.title.substring(0, 60)} - Revenue: $${p.revenue.toFixed(0)}, Reviews: ${p.reviews}, Precio: $${p.price.toFixed(2)}`).join('\n')}

**TU TAREA:**
Genera un análisis que VENDA LA SOLUCIÓN. No describas los datos, explica QUÉ ESTÁN PERDIENDO y CÓMO LO ARREGLAMOS.

Devuelve SOLO un JSON válido con esta estructura exacta:
{
  "headline": "Frase de impacto de 1 línea (máximo 120 caracteres)",
  "executive_summary": "2 párrafos de análisis brutalmente honesto. Párrafo 1: El problema (fugas de tráfico, dependencia de ads). Párrafo 2: La solución (SEO, A+, branding). Usa datos específicos.",
  "money_left_on_table": "Cifra estimada en € anuales (ej: '€120.000 anuales')",
  "action_plan": [
    { "title": "Acción 1", "impact": "High", "description": "Descripción detallada de la acción y su impacto" },
    { "title": "Acción 2", "impact": "High", "description": "Descripción detallada" },
    { "title": "Acción 3", "impact": "Medium", "description": "Descripción detallada" }
  ]
}

IMPORTANTE: El action_plan debe tener mínimo 3 acciones, priorizando High impact. Habla de SEO, A+ Content, y reducción de dependencia de anuncios.`
  }

  // UNKNOWN o default
  return `Eres el Auditor Principal de Liberty Seller. Estás analizando la cuenta de un potencial cliente. Tu tono es directo, basado en datos y ligeramente alarmista sobre las oportunidades perdidas (FOMO).

**CONTEXTO DEL CLIENTE:**
- Modelo de Negocio: ${businessModel}
- Risk Score: ${metrics.risk_score}/100
- Oportunidad Perdida: $${metrics.total_opportunity_value.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}

**TU TAREA:**
Genera un análisis que VENDA LA SOLUCIÓN. Sé directo y basado en datos.

Devuelve SOLO un JSON válido con esta estructura exacta:
{
  "headline": "Frase de impacto de 1 línea (máximo 120 caracteres)",
  "executive_summary": "2 párrafos de análisis brutalmente honesto",
  "money_left_on_table": "Cifra estimada en € anuales",
  "action_plan": [
    { "title": "Acción 1", "impact": "High", "description": "Descripción detallada" },
    { "title": "Acción 2", "impact": "Medium", "description": "Descripción detallada" }
  ]
}`
}

export async function POST(request: NextRequest) {
  let body: AnalyzeRequest | null = null
  
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: 'OpenAI API key no configurada' },
        { status: 500 }
      )
    }

    body = await request.json()
    
    if (!body) {
      return NextResponse.json(
        { error: 'Cuerpo de la petición inválido' },
        { status: 400 }
      )
    }

    const { computed_metrics, business_model, seller_url } = body

    if (!computed_metrics || !business_model) {
      return NextResponse.json(
        { error: 'Faltan campos requeridos: computed_metrics y business_model' },
        { status: 400 }
      )
    }

    // Construir el system prompt según el modelo de negocio
    const systemPrompt = buildSystemPrompt(business_model, computed_metrics)

    const userPrompt = seller_url
      ? `Analiza la cuenta de Amazon: ${seller_url}`
      : `Analiza estos datos de auditoría y genera un informe estratégico.`

    // Llamar a OpenAI
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' },
    })

    const aiResponse = JSON.parse(completion.choices[0].message.content || '{}')

    // Validar y normalizar la respuesta
    const response: AnalyzeResponse = {
      headline: aiResponse.headline || 'Análisis de Oportunidades de Crecimiento',
      executive_summary: aiResponse.executive_summary || 'Análisis no disponible',
      money_left_on_table: aiResponse.money_left_on_table || '€0 anuales',
      action_plan: Array.isArray(aiResponse.action_plan) && aiResponse.action_plan.length > 0
        ? aiResponse.action_plan.map((action: any) => ({
            title: action.title || 'Acción sin título',
            impact: (action.impact === 'High' || action.impact === 'Medium' || action.impact === 'Low')
              ? action.impact
              : 'Medium',
            description: action.description || '',
          }))
        : [
            {
              title: 'Revisar estrategia de pricing',
              impact: 'High' as const,
              description: 'Analizar y optimizar la estrategia de precios para maximizar rentabilidad',
            },
          ],
    }

    return NextResponse.json(response)
  } catch (error: any) {
    console.error('Error en análisis de auditor:', error)
    
    // Fallback si falla OpenAI
    const riskScore = body?.computed_metrics?.risk_score || 50
    const opportunityValue = body?.computed_metrics?.total_opportunity_value || 0
    
    const fallbackResponse: AnalyzeResponse = {
      headline: 'Oportunidad de Crecimiento Detectada',
      executive_summary: `Hemos identificado oportunidades significativas en tu cuenta de Amazon. El análisis muestra un riesgo de ${riskScore}/100 y una oportunidad perdida estimada de $${opportunityValue.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}.`,
      money_left_on_table: `€${Math.round(opportunityValue * 12).toLocaleString('es-ES')} anuales estimados`,
      action_plan: [
        {
          title: 'Optimización de Listings',
          impact: 'High',
          description: 'Mejorar la optimización de tus productos principales para aumentar visibilidad y conversión',
        },
        {
          title: 'Análisis de Competencia',
          impact: 'Medium',
          description: 'Revisar estrategias de competidores para identificar oportunidades de mejora',
        },
      ],
    }

    return NextResponse.json(fallbackResponse)
  }
}

