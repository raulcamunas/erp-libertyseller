import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/api'
import OpenAI from 'openai'
import { parseCSV, parseNum, getVal } from '@/lib/utils/csv-parser'
import { comprobarTamañoPeticion, comprobarTamañoFichero } from '@/lib/subidas-limite'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

interface XrayRow {
  [key: string]: any
}

interface CerebroRow {
  [key: string]: any
}

interface CalculationResult {
  product_name: string
  target_price: number
  unit_cost: number
  shipping_cost: number
  min_roi: number
  
  // Datos de mercado (Helium 10)
  avg_market_price: number
  est_fba_fee: number
  market_velocity: number
  avg_reviews: number
  top_keyword: string
  search_volume: number
  
  // Cálculos financieros
  referral_fee: number
  total_product_cost: number
  total_amazon_fees: number
  total_cost: number
  net_profit_unit: number
  margin_percent: number
  roi_percent: number
  monthly_profit_potential: number
  
  // Análisis IA
  ai_analysis: {
    score: number
    verdict: 'GO' | 'NO GO' | 'CAUTION'
    pros: string[]
    cons: string[]
    financial_summary: string
  }
  
  // Top 5 competidores
  top_competitors: Array<{
    asin: string
    price: number
    sales: number
    reviews: number
    title: string
  }>
}

export async function POST(request: NextRequest) {
  try {
    // QUÉ IMPIDE: que esta ruta le conteste a cualquiera de internet. No
    // comprobaba nada, y middleware.ts (línea 41) declara pública toda /api/,
    // así que bastaba un curl SIN cookie para dispararla. Ver lib/auth/api.ts,
    // donde está reproducido con el curl exacto.
    //
    // Sube ficheros Y llama a OpenAI con la clave de la empresa. La llama
    // app/dashboard/validator/new/page.tsx, con sesión.
    //
    // Se pide SESIÓN y nada más —ni rol ni permiso de módulo— a propósito: hoy
    // esta pantalla la abre cualquiera con sesión, y exigir un permiso que hoy
    // no se exige dejaría fuera a alguien que trabaja.
    const sesion = await requireSession()
    if (sesion instanceof NextResponse) return sesion

    // Tope de bytes ANTES de formData(): formData() bufferiza el cuerpo entero.
    // Sin esto, 4 subidas simultáneas de 60 MB sin sesión dejaban el proceso en
    // 874 MB de RSS. Ver lib/subidas-limite.ts.
    const demasiado = comprobarTamañoPeticion(request)
    if (demasiado) return demasiado

    const formData = await request.formData()

    // Datos del proveedor
    const product_name = formData.get('product_name') as string
    const target_price = parseFloat(formData.get('target_price') as string)
    const unit_cost = parseFloat(formData.get('unit_cost') as string)
    const shipping_cost = parseFloat(formData.get('shipping_cost') as string)
    const min_roi = parseFloat(formData.get('min_roi') as string) || 100

    // Archivos CSV
    const xrayFile = formData.get('xray_file') as File
    const cerebroFile = formData.get('cerebro_file') as File

    if (!xrayFile || !cerebroFile) {
      return NextResponse.json(
        { error: 'Faltan archivos CSV requeridos' },
        { status: 400 }
      )
    }

    // Segundo filtro, por si el cuerpo vino sin Content-Length (chunked).
    const xrayGrande = comprobarTamañoFichero(xrayFile, 'El CSV de Xray')
    if (xrayGrande) return xrayGrande
    const cerebroGrande = comprobarTamañoFichero(cerebroFile, 'El CSV de Cerebro')
    if (cerebroGrande) return cerebroGrande

    // Parsear CSVs
    const xrayContent = await xrayFile.text()
    const cerebroContent = await cerebroFile.text()
    
    const xrayData: XrayRow[] = parseCSV(xrayContent)
    const cerebroData: CerebroRow[] = parseCSV(cerebroContent)

    if (xrayData.length === 0 || cerebroData.length === 0) {
      return NextResponse.json(
        { error: 'Los archivos CSV están vacíos o tienen formato incorrecto' },
        { status: 400 }
      )
    }

    // ===== FASE 2: EXTRACCIÓN DE DATOS DE XRAY =====
    
    // Ordenar por ASIN Sales (descendente) y tomar TOP 10
    const top10Products = xrayData
      .map(row => ({
        ...row,
        asinSales: parseNum(getVal(row, ['ASIN Sales', 'Sales', 'Monthly Sales', /sales/i])),
        price: parseNum(getVal(row, ['Price US$', 'Price', 'Price USD', /price/i])),
        fees: parseNum(getVal(row, ['Fees US$', 'FBA Fees', 'Fees', /fee/i])),
        reviews: parseNum(getVal(row, ['Reviews', 'Review Count', /review/i])),
        asin: getVal(row, ['ASIN', 'asin', /asin/i]) || '',
        title: getVal(row, ['Title', 'Product Title', 'Name', /title|name/i]) || '',
      }))
      .filter(p => p.asinSales > 0)
      .sort((a, b) => b.asinSales - a.asinSales)
      .slice(0, 10)

    if (top10Products.length === 0) {
      return NextResponse.json(
        { error: 'No se encontraron productos con ventas en el archivo Xray' },
        { status: 400 }
      )
    }

    // Calcular promedios del TOP 10
    const avg_market_price = top10Products.reduce((sum, p) => sum + p.price, 0) / top10Products.length
    const est_fba_fee = top10Products.reduce((sum, p) => sum + p.fees, 0) / top10Products.length || avg_market_price * 0.15 // Fallback: 15% del precio
    const market_velocity = top10Products.reduce((sum, p) => sum + p.asinSales, 0) / top10Products.length
    const avg_reviews = top10Products.reduce((sum, p) => sum + p.reviews, 0) / top10Products.length

    // Top 5 competidores para mostrar
    const top_competitors = top10Products.slice(0, 5).map(p => ({
      asin: p.asin,
      price: p.price,
      sales: p.asinSales,
      reviews: p.reviews,
      title: p.title.substring(0, 60) + (p.title.length > 60 ? '...' : ''),
    }))

    // Extraer datos de Cerebro (keywords)
    const top_keyword = getVal(cerebroData[0] || {}, ['Keyword', 'Search Term', 'Term', /keyword|term/i]) || 'N/A'
    const search_volume = parseNum(getVal(cerebroData[0] || {}, ['Search Volume', 'Volume', 'Searches', /volume|search/i]))

    // ===== FASE 2: CÁLCULOS FINANCIEROS =====
    
    const referral_fee = target_price * 0.15 // 15% de comisión de Amazon
    const total_product_cost = unit_cost + shipping_cost
    const total_amazon_fees = est_fba_fee + referral_fee
    const total_cost = total_product_cost + total_amazon_fees
    const net_profit_unit = target_price - total_cost
    const margin_percent = (net_profit_unit / target_price) * 100
    const roi_percent = (net_profit_unit / total_product_cost) * 100
    const monthly_profit_potential = net_profit_unit * market_velocity

    // ===== FASE 3: ANÁLISIS IA =====
    
    const systemPrompt = `Eres un Auditor Senior de Amazon FBA. Evalúa este producto basándote en Rentabilidad y Demanda.

**DATOS FINANCIEROS:**
- Precio Venta: $${target_price.toFixed(2)}
- Coste Total Producto (Fab+Envio): $${total_product_cost.toFixed(2)}
- Fees Amazon: $${total_amazon_fees.toFixed(2)}
- **Beneficio Neto:** $${net_profit_unit.toFixed(2)} (${margin_percent.toFixed(1)}%)
- **ROI:** ${roi_percent.toFixed(1)}%

**DATOS DE MERCADO (Helium 10):**
- Ventas Promedio Competencia: ${market_velocity.toFixed(0)} uds/mes
- Competencia Media (Reviews): ${avg_reviews.toFixed(0)}
- Keyword Principal: ${top_keyword} con ${search_volume.toLocaleString()} búsquedas

**TU TAREA:**
1. **Validación Financiera:** ¿Cumple el ROI mínimo del usuario (${min_roi}%)? ¿Es el margen saludable (>25%)?
2. **Validación de Mercado:** ¿Hay demasiada competencia (Reviews > 500)? ¿Hay suficiente demanda?
3. **Veredicto:** GO (Lanzar) / NO GO (Descartar) / CAUTION (Precaución)
4. **Consejo Estratégico:** Si el margen es bajo, sugiere subir precio o negociar COGS.

Devuelve SOLO un JSON válido con esta estructura exacta:
{
  "score": 85,
  "verdict": "GO",
  "pros": ["Pro 1", "Pro 2", "Pro 3"],
  "cons": ["Con 1", "Con 2"],
  "financial_summary": "Resumen financiero en 2-3 líneas"
}`

    const userPrompt = `Analiza este producto: ${product_name}`

    let ai_analysis
    try {
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
      
      // Validar y normalizar el verdict
      const rawVerdict = aiResponse.verdict || 'CAUTION'
      const normalizedVerdict: 'GO' | 'NO GO' | 'CAUTION' = 
        rawVerdict === 'GO' || rawVerdict === 'NO GO' || rawVerdict === 'CAUTION'
          ? rawVerdict
          : 'CAUTION'
      
      ai_analysis = {
        score: aiResponse.score || 50,
        verdict: normalizedVerdict,
        pros: Array.isArray(aiResponse.pros) ? aiResponse.pros : [],
        cons: Array.isArray(aiResponse.cons) ? aiResponse.cons : [],
        financial_summary: aiResponse.financial_summary || 'Análisis no disponible',
      }
    } catch (error) {
      console.error('Error en análisis IA:', error)
      // Fallback si falla OpenAI
      const fallbackVerdict: 'GO' | 'NO GO' | 'CAUTION' = 
        roi_percent >= min_roi && margin_percent >= 25 ? 'GO' : 
        roi_percent >= min_roi * 0.8 ? 'CAUTION' : 'NO GO'
      
      ai_analysis = {
        score: roi_percent >= min_roi && margin_percent >= 25 ? 75 : 40,
        verdict: fallbackVerdict,
        pros: roi_percent >= min_roi ? ['ROI cumple objetivo'] : [],
        cons: roi_percent < min_roi ? ['ROI por debajo del objetivo'] : [],
        financial_summary: `ROI: ${roi_percent.toFixed(1)}%, Margen: ${margin_percent.toFixed(1)}%`,
      }
    }

    // ===== RESULTADO FINAL =====
    
    const result: CalculationResult = {
      product_name,
      target_price,
      unit_cost,
      shipping_cost,
      min_roi,
      avg_market_price,
      est_fba_fee,
      market_velocity,
      avg_reviews,
      top_keyword,
      search_volume,
      referral_fee,
      total_product_cost,
      total_amazon_fees,
      total_cost,
      net_profit_unit,
      margin_percent,
      roi_percent,
      monthly_profit_potential,
      ai_analysis,
      top_competitors,
    }

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('Error en cálculo de validación:', error)
    return NextResponse.json(
      { error: error.message || 'Error al procesar la validación' },
      { status: 500 }
    )
  }
}

