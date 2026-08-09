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

interface PerformanceInsightsRequest {
  prompt: string
}

const SYSTEM_PROMPT = `Eres un analista de rendimiento laboral especializado en productividad y gestión del tiempo. Tu objetivo es analizar datos de actividad de empleados y proporcionar insights accionables.

TUS REGLAS DE ANÁLISIS:

Análisis de Productividad:
- Identifica patrones de comportamiento productivo vs no productivo
- Detecta tiempos muertos y distracciones
- Evalúa la distribución del tiempo por categorías
- Calcula un "focusScore" (0-100) basado en concentración y productividad
- Determina la tendencia de productividad: "improving", "stable", o "declining"

Recomendaciones:
- Sé específico y accionable
- Prioriza las mejoras más impactantes
- Considera el contexto del trabajo del empleado

IMPORTANTE:
- Si el prompt solicita JSON, responde SOLO con JSON válido, sin texto adicional
- Si el prompt solicita texto, responde en formato Markdown
- Sé profesional, directo y constructivo
- Responde siempre en español`

export async function POST(request: NextRequest) {
  try {
    // QUÉ IMPIDE: que esta ruta le conteste a cualquiera de internet. No
    // comprobaba nada, y middleware.ts (línea 41) declara pública toda /api/,
    // así que bastaba un curl SIN cookie para dispararla. Ver lib/auth/api.ts,
    // donde está reproducido con el curl exacto.
    //
    // Manda a OpenAI, con la clave de la empresa, un prompt que trae dentro el
    // rendimiento de las personas del equipo. La llama
    // components/tracker/PerformanceDashboard.tsx, con sesión.
    //
    // Se pide SESIÓN y nada más —ni rol ni permiso de módulo— a propósito: hoy
    // esta pantalla la abre cualquiera con sesión, y exigir un permiso que hoy
    // no se exige dejaría fuera a alguien que trabaja.
    const sesion = await requireSession()
    if (sesion instanceof NextResponse) return sesion

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
      // Detectar si el prompt solicita JSON
      const isJSONRequest = body.prompt.includes('JSON') || body.prompt.includes('json')
      
      const completion = await openai.chat.completions.create(
        {
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: body.prompt },
          ],
          temperature: 0.5,
          max_tokens: 1000,
          ...(isJSONRequest && {
            response_format: { type: 'json_object' }
          }),
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

