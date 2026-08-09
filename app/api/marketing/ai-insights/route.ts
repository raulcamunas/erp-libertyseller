import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/api'
import OpenAI from 'openai'

// Lazy initialization - solo se crea cuando se necesita
function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    return null
  }
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  })
}

interface BleederAnalysis {
  term: string
  spend: number
  sales: number
  clicks: number
  match_type?: string
  acos?: number
}

interface WinnerAnalysis {
  term: string
  acos: number
  sales: number
  conversion_rate?: number
  spend?: number
}

interface HarvestOpportunity {
  term: string
  origin_campaign: string
  orders: number
  acos?: number
}

interface AIInsightsRequest {
  client_context: {
    target_acos: number
    total_spend_week: number
    global_acos: number
    client_name?: string
  }
  bleeders_analysis: BleederAnalysis[]
  winners_analysis: WinnerAnalysis[]
  harvest_opportunities: HarvestOpportunity[]
}

const SYSTEM_PROMPT = `Eres LibertyAI, el Auditor Jefe de una agencia de Amazon PPC de alto rendimiento. Tu objetivo único es la RENTABILIDAD. Estás analizando los datos brutos de una optimización semanal.

TUS REGLAS DE ANÁLISIS:

Detección de Patrones de Sangrado (Bleeders):
- No te limites a decir "gastan mucho". Analiza la INTENCIÓN.
- Si el término es muy genérico (ej: "regalo"), etiqueta como "Tráfico basura / Too Broad".
- Si el término es de la competencia, etiqueta como "Conquista fallida".
- Si el término es relevante pero no convierte, etiqueta como "Posible problema de Precio o Listing".

Validación de Oportunidades (Harvesting):
- Analiza los nuevos términos descubiertos. ¿Tienen sentido semántico con el producto?
- Si ves términos raros o irrelevantes que han vendido por suerte, avisa para vigilarlos.

Tono y Formato:
- Sé directo, quirúrgico y profesional. Sin saludos genéricos.
- Usa Markdown con negritas y listas.
- NO uses frases de relleno como "Basado en los datos proporcionados...". Ve al grano.

ESTRUCTURA DE RESPUESTA REQUERIDA:

🩸 **Diagnóstico de Fugas (Bleeders)**
**Patrón Detectado:** [Explica qué tienen en común las palabras que pierden dinero. Ej: "Estás atacando términos demasiado genéricos sin intención de compra clara"].

**Acción Recomendada:** [Ej: "Negativizar agresivamente y revisar si el precio es competitivo para esas búsquedas"].

🚀 **Motor de Crecimiento (Winners & Harvest)**
**El Ángulo Ganador:** [Analiza los Winners. Ej: "Tu nicho claro son los 'camioneros' y 'viajes largos', no el uso doméstico"].

**Estrategia de Escaldado:** [Consejo sobre cómo pujar en las nuevas keywords cosechadas].

⚖️ **Veredicto Semanal**
**Estado de la Cuenta:** [Define si estamos en fase de "Limpieza", "Estabilidad" o "Escalado" según el ACOS global vs Target].

**Próximo Paso Crítico:** [Una sola acción prioritaria para el humano].`

export async function POST(request: NextRequest) {
  try {
    // QUÉ IMPIDE: que esta ruta le conteste a cualquiera de internet. No
    // comprobaba nada, y middleware.ts (línea 41) declara pública toda /api/,
    // así que bastaba un curl SIN cookie para dispararla. Ver lib/auth/api.ts,
    // donde está reproducido con el curl exacto.
    //
    // Manda a OpenAI el contexto del cliente de PPC con la clave de la empresa.
    // Sin sesión, cualquiera de internet tenía una pasarela gratis contra
    // OPENAI_API_KEY, a cargo de la agencia. La llama
    // components/ppc/AIInsightsPanel.tsx, con sesión.
    //
    // Se pide SESIÓN y nada más —ni rol ni permiso de módulo— a propósito: hoy
    // esta pantalla la abre cualquiera con sesión, y exigir un permiso que hoy
    // no se exige dejaría fuera a alguien que trabaja.
    const sesion = await requireSession()
    if (sesion instanceof NextResponse) return sesion

    const body: AIInsightsRequest = await request.json()

    // Validar que tenemos los datos necesarios
    if (!body.client_context || !body.bleeders_analysis || !body.winners_analysis || !body.harvest_opportunities) {
      return NextResponse.json(
        { error: 'Datos incompletos. Se requieren client_context, bleeders_analysis, winners_analysis y harvest_opportunities' },
        { status: 400 }
      )
    }

    // Preparar el contexto para GPT
    const userPrompt = `Analiza estos datos de optimización PPC:

**Contexto del Cliente:**
- ACOS Objetivo: ${(body.client_context.target_acos * 100).toFixed(1)}%
- Gasto Semanal Total: ${body.client_context.total_spend_week.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}
- ACOS Global: ${(body.client_context.global_acos * 100).toFixed(1)}%
${body.client_context.client_name ? `- Cliente: ${body.client_context.client_name}` : ''}

**Top 5 Bleeders (Peores Performers):**
${body.bleeders_analysis.slice(0, 5).map((b, i) => 
  `${i + 1}. "${b.term}" - Gasto: ${b.spend.toFixed(2)}€, Ventas: ${b.sales.toFixed(2)}€, Clics: ${b.clicks}, ACOS: ${b.acos ? (b.acos * 100).toFixed(1) + '%' : 'N/A'}`
).join('\n')}

**Top 5 Winners (Mejores Performers):**
${body.winners_analysis.slice(0, 5).map((w, i) => 
  `${i + 1}. "${w.term}" - ACOS: ${(w.acos * 100).toFixed(1)}%, Ventas: ${w.sales.toFixed(2)}€${w.conversion_rate ? `, CVR: ${(w.conversion_rate * 100).toFixed(1)}%` : ''}`
).join('\n')}

**Top 5 Oportunidades de Harvesting:**
${body.harvest_opportunities.slice(0, 5).map((h, i) => 
  `${i + 1}. "${h.term}" - Campaña: ${h.origin_campaign}, Pedidos: ${h.orders}${h.acos ? `, ACOS: ${(h.acos * 100).toFixed(1)}%` : ''}`
).join('\n')}

Analiza estos datos y proporciona tu diagnóstico siguiendo la estructura requerida.`

    // Verificar que OpenAI está disponible
    const openai = getOpenAIClient()
    if (!openai) {
      return NextResponse.json({
        error: true,
        message: 'La IA está descansando, pero los datos matemáticos son correctos.',
        fallback: true,
      })
    }

    // Llamar a OpenAI con timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 segundos

    try {
      const completion = await openai.chat.completions.create(
        {
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.4,
          max_tokens: 1500,
        },
        { signal: controller.signal }
      )

      clearTimeout(timeoutId)

      const aiResponse = completion.choices[0]?.message?.content || ''

      return NextResponse.json({
        success: true,
        insights: aiResponse,
        timestamp: new Date().toISOString(),
      })
    } catch (openaiError: any) {
      clearTimeout(timeoutId)

      // Si es timeout o error de API, devolver fallback
      if (openaiError.name === 'AbortError' || openaiError.status === 429 || openaiError.status >= 500) {
        return NextResponse.json({
          error: true,
          message: 'La IA está descansando, pero los datos matemáticos son correctos.',
          fallback: true,
        })
      }

      throw openaiError
    }
  } catch (error: any) {
    console.error('Error in AI insights endpoint:', error)

    // Fallback en caso de cualquier error
    return NextResponse.json({
      error: true,
      message: 'La IA está descansando, pero los datos matemáticos son correctos.',
      fallback: true,
    })
  }
}

