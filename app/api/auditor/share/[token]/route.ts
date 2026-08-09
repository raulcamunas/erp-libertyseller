import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { urlBaseApp } from '@/lib/url-app'

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

    /**
     * LA LECTURA VA CON LA CLAVE DE SERVICIO, DESDE EL SERVIDOR.
     *
     * QUÉ IMPIDE: que la tabla `audit_reports` ENTERA se pueda pedir con la
     * clave anónima, que viaja en el bundle de JavaScript de cualquier
     * visitante. La política de supabase/migrations/052 es
     *
     *     FOR SELECT TO anon, authenticated USING (true)
     *
     * o sea `true` para todo el mundo, y RLS no puede ver el `.eq('public_token',
     * …)` de aquí abajo: filtrar en el cliente no acota nada. Con esa política,
     * un `GET /rest/v1/audit_reports?select=*` sin sesión se llevaba los
     * informes de auditoría de todos los clientes potenciales —seller_url y
     * métricas— sin necesidad de adivinar ni un token. Por eso generar el token
     * con crypto en vez de Math.random() no protegía nada por sí solo: no hacía
     * falta adivinarlo.
     *
     * La migración 136 quita esa política. Este cambio va DELANTE de ella a
     * propósito: la clave de servicio se salta RLS, así que los enlaces de
     * auditoría ya repartidos siguen abriendo igual antes y después de aplicar
     * la migración. El filtro por token sigue siendo el mismo y lo hace el
     * servidor, que es donde no se puede quitar desde fuera.
     *
     * Si SUPABASE_SERVICE_ROLE_KEY no estuviera puesta se cae a la clave
     * anónima, que es exactamente lo que había hasta hoy: sin la migración
     * aplicada funciona igual, y así un despliegue sin la variable no deja los
     * enlaces muertos.
     */
    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
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
        // URL base fijada por el servidor. NO se deriva de las cabeceras
        // `Origin`/`Host` de la petición: eso era un SSRF de lectura sin sesión
        // (el atacante elegía el destino y recibía el cuerpo). Ver lib/url-app.ts.
        const baseUrl = urlBaseApp()

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

          /**
           * ESTE GUARDADO SIGUE HACIÉNDOSE CON LA CLAVE ANÓNIMA A PROPÓSITO, Y
           * POR TANTO SIGUE SIN GUARDAR NADA.
           *
           * La política de UPDATE de `audit_reports` (migración 050) pide
           * `auth.role() = 'authenticated'`, así que con la clave anónima
           * afecta a cero filas y no da error: hoy `ai_analysis` NUNCA se
           * persiste desde aquí y el análisis se vuelve a generar en cada
           * visita del enlace.
           *
           * Pasarlo a la clave de servicio —que es la que ya usa la lectura de
           * arriba— haría que empezara a guardarse, y eso SÍ se nota usando la
           * aplicación: el texto del informe dejaría de regenerarse y quedaría
           * congelado el de la primera visita. Puede que sea lo que se quería,
           * pero es un cambio de comportamiento y lo decide el humano, no esta
           * pasada de endurecimiento. Se deja como estaba.
           */
          const supabaseEscritura = createSupabaseClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
          )
          await supabaseEscritura
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

