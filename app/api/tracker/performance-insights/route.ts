import { NextRequest, NextResponse } from 'next/server'
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

interface PerformanceInsightsRequest {
  prompt: string
}

const SYSTEM_PROMPT = `Eres un analista de rendimiento laboral especializado en productividad y gestión del tiempo. Tu objetivo es analizar datos de actividad de empleados y proporcionar insights accionables.

TUS REGLAS DE ANÁLISIS:

Análisis de Productividad:
- Identifica patrones de comportamiento productivo vs no productivo
- Detecta tiempos muertos y distracciones
- Evalúa la distribución del tiempo por categorías

Recomendaciones:
- Sé específico y accionable
- Prioriza las mejoras más impactantes
- Considera el contexto del trabajo del empleado

Tono y Formato:
- Sé profesional, directo y constructivo
- Usa Markdown con negritas y listas
- Sé empático pero objetivo
- Responde en español

ESTRUCTURA DE RESPUESTA REQUERIDA:

📊 **Análisis del Rendimiento**
[2-3 frases resumiendo el rendimiento general del día]

✅ **Puntos Fuertes**
- [Punto fuerte 1]
- [Punto fuerte 2]
- [Punto fuerte 3]

⚠️ **Áreas de Mejora**
- [Área de mejora 1 con recomendación específica]
- [Área de mejora 2 con recomendación específica]

💡 **Recomendaciones**
- [Recomendación 1]
- [Recomendación 2]
- [Recomendación 3]`

export async function POST(request: NextRequest) {
  try {
    const body: PerformanceInsightsRequest = await request.json()

    if (!body.prompt) {
      return NextResponse.json(
        { error: 'Se requiere un prompt' },
        { status: 400 }
      )
    }

    // Verificar que OpenAI está disponible
    const openai = getOpenAIClient()
    if (!openai) {
      return NextResponse.json({
        error: true,
        message: 'La IA no está disponible en este momento.',
        fallback: true,
      })
    }

    // Llamar a OpenAI con timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15000) // 15 segundos

    try {
      const completion = await openai.chat.completions.create(
        {
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: body.prompt },
          ],
          temperature: 0.5,
          max_tokens: 1000,
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
          message: 'La IA no está disponible en este momento. Intenta más tarde.',
          fallback: true,
        })
      }

      throw openaiError
    }
  } catch (error: any) {
    console.error('Error in performance insights endpoint:', error)

    // Fallback en caso de cualquier error
    return NextResponse.json({
      error: true,
      message: 'Error al generar insights. Intenta más tarde.',
      fallback: true,
    })
  }
}

