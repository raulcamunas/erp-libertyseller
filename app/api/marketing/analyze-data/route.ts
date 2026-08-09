import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/api'
import * as XLSX from 'xlsx'
import { comprobarTamañoPeticion, comprobarTamañoFichero } from '@/lib/subidas-limite'

/**
 * Normaliza las claves de un objeto eliminando espacios al inicio y final
 */
function normalizeKeys(obj: Record<string, any>): Record<string, any> {
  const normalized: Record<string, any> = {}
  for (const [key, value] of Object.entries(obj)) {
    normalized[key.trim()] = value
  }
  return normalized
}

/**
 * Busca la pestaña correcta en un libro Excel
 */
function findCorrectSheet(
  workbook: XLSX.WorkBook,
  searchColumn: string | string[],
  preferredSheetName?: string
): { sheetName: string; data: any[] } | null {
  const searchColumns = Array.isArray(searchColumn) ? searchColumn : [searchColumn]

  // Si hay un nombre de pestaña preferido, intentar usarlo primero
  if (preferredSheetName) {
    const preferredSheet = workbook.Sheets[preferredSheetName]
    if (preferredSheet) {
      const jsonData = XLSX.utils.sheet_to_json(preferredSheet, { defval: '' })
      const normalizedData = jsonData.map((row: any) => normalizeKeys(row))
      return { sheetName: preferredSheetName, data: normalizedData }
    }
  }

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][]

    if (rows.length === 0) continue

    const headers = rows[0].map((h: any) => String(h).trim())

    const found = searchColumns.some((col) =>
      headers.some((header: string) =>
        header.toLowerCase().includes(col.toLowerCase())
      )
    )

    if (found) {
      const jsonData = XLSX.utils.sheet_to_json(sheet, { defval: '' })
      const normalizedData = jsonData.map((row: any) => normalizeKeys(row))
      return { sheetName, data: normalizedData }
    }
  }

  return null
}

/**
 * Obtiene un valor de un objeto con múltiples posibles claves
 */
function getValue(row: Record<string, any>, keys: string[]): any {
  for (const key of keys) {
    const normalizedKey = Object.keys(row).find(
      (k) => k.trim().toLowerCase() === key.trim().toLowerCase()
    )
    if (normalizedKey !== undefined && row[normalizedKey] !== undefined && row[normalizedKey] !== '') {
      return row[normalizedKey]
    }
  }
  return null
}

/**
 * Parsea un número de formato Amazon
 */
function parseAmazonNumber(value: any): number {
  if (typeof value === 'number') return value
  if (!value) return 0

  const str = String(value)
    .replace(/[€$£,]/g, '')
    .replace(/\s/g, '')
    .replace('%', '')
    .trim()

  const hasComma = str.includes(',')
  const hasDot = str.includes('.')

  if (hasComma && hasDot) {
    const lastComma = str.lastIndexOf(',')
    const lastDot = str.lastIndexOf('.')
    if (lastComma > lastDot) {
      return parseFloat(str.replace(/\./g, '').replace(',', '.'))
    } else {
      return parseFloat(str.replace(/,/g, ''))
    }
  } else if (hasComma) {
    return parseFloat(str.replace(',', '.'))
  } else {
    return parseFloat(str) || 0
  }
}

interface SearchTermRow {
  'Término de búsqueda de cliente': string
  'Pedidos totales de 7 días (#)': string | number
  'Coste publicitario de las ventas (ACOS) total': string | number
  'Campaña': string
}

interface BulkRow {
  'ID de la campaña': string
  'Entidad': string
  'Texto de palabra clave': string
  'Puja': number
  'ACOS': number
  'Ventas': number
  'Clics': number
  'Impresiones': number
}

export async function POST(request: NextRequest) {
  try {
    // QUÉ IMPIDE: que esta ruta le conteste a cualquiera de internet. No
    // comprobaba nada, y middleware.ts (línea 41) declara pública toda /api/,
    // así que bastaba un curl SIN cookie para dispararla. Ver lib/auth/api.ts,
    // donde está reproducido con el curl exacto.
    //
    // La llama components/ppc/OptimizerTool.tsx, con sesión.
    //
    // Se pide SESIÓN y nada más —ni rol ni permiso de módulo— a propósito: hoy
    // esta pantalla la abre cualquiera con sesión, y exigir un permiso que hoy
    // no se exige dejaría fuera a alguien que trabaja.
    const sesion = await requireSession()
    if (sesion instanceof NextResponse) return sesion

    // Tope de bytes ANTES de formData(): formData() bufferiza el cuerpo entero.
    // Sin esto, una subida sin sesión de 60 MB entraba tal cual y 4 a la vez
    // dejaban el proceso en 874 MB de RSS. Ver lib/subidas-limite.ts.
    const demasiado = comprobarTamañoPeticion(request)
    if (demasiado) return demasiado

    const formData = await request.formData()
    const bulkFile = formData.get('bulkFile') as File
    const searchFile = formData.get('searchFile') as File
    const targetACOS = formData.get('targetACOS') ? parseFloat(formData.get('targetACOS') as string) : 20

    // Segundo filtro, por si el cuerpo vino sin Content-Length (chunked).
    const bulkGrande = comprobarTamañoFichero(bulkFile, 'El Bulk File')
    if (bulkGrande) return bulkGrande
    const searchGrande = comprobarTamañoFichero(searchFile, 'El informe de términos de búsqueda')
    if (searchGrande) return searchGrande

    if (!bulkFile || !searchFile) {
      return NextResponse.json(
        { error: 'Se requieren ambos archivos (bulkFile y searchFile)' },
        { status: 400 }
      )
    }

    // Parsear Search Term Report (Excel)
    const searchBuffer = await searchFile.arrayBuffer()
    const searchWorkbook = XLSX.read(searchBuffer, { type: 'array' })

    const searchSheetResult = findCorrectSheet(searchWorkbook, [
      'Término de búsqueda de cliente',
      'Término de búsqueda',
    ])
    if (!searchSheetResult) {
      return NextResponse.json(
        {
          error:
            'No se encontró la pestaña con columna "Término de búsqueda de cliente" en el Search Term Report',
        },
        { status: 400 }
      )
    }

    const searchData: SearchTermRow[] = searchSheetResult.data as SearchTermRow[]

    // Parsear Bulk File (XLSX)
    const bulkBuffer = await bulkFile.arrayBuffer()
    const bulkWorkbook = XLSX.read(bulkBuffer, { type: 'array' })

    const bulkSheetResult = findCorrectSheet(
      bulkWorkbook,
      ['Entidad', 'Entity'],
      'Camp. de Sponsored Products'
    )
    if (!bulkSheetResult) {
      return NextResponse.json(
        { error: 'No se encontró la pestaña con columna "Entidad" o "Entity" en el Bulk File' },
        { status: 400 }
      )
    }

    const bulkData: BulkRow[] = bulkSheetResult.data as BulkRow[]
    const normalizedBulkData: BulkRow[] = bulkData

    // Calcular totales - SOLO filas donde Entidad = "Campaña" para evitar duplicados
    // El archivo Bulk repite datos: Campaña + Grupo + Keyword = mismo dato 3 veces
    let totalSpend = 0
    let totalSales = 0
    let totalClics = 0

    for (const row of normalizedBulkData) {
      const entity = getValue(row, ['Entidad', 'Entity'])
      
      // SOLO procesar filas de Campaña (datos "padre" sin duplicados)
      if (entity === 'Campaña' || entity === 'Campaign') {
        const ventas = parseAmazonNumber(getValue(row, ['Ventas', 'Sales', 'Revenue']))
        const gasto = parseAmazonNumber(
          getValue(row, ['Inversión', 'Gasto', 'Spend', 'Cost', 'Coste'])
        )
        const clics = parseAmazonNumber(getValue(row, ['Clics', 'Clicks']))
        const puja = parseAmazonNumber(getValue(row, ['Puja', 'Bid']))
        
        // Calcular gasto si no está disponible
        const rowSpend = gasto || (puja * clics) || 0
        
        totalSpend += rowSpend
        totalSales += ventas
        totalClics += clics
      }
    }

    const globalACOS = totalSpend > 0 && totalSales > 0 
      ? (totalSpend / totalSales) * 100 
      : 0

    // Identificar Bleeders (Top 5 peores)
    const bleeders = normalizedBulkData
      .filter((row) => {
        const entity = getValue(row, ['Entidad', 'Entity'])
        if (entity !== 'Palabra clave' && entity !== 'Keyword') return false
        const ventas = parseAmazonNumber(getValue(row, ['Ventas', 'Sales']))
        const gasto = parseAmazonNumber(getValue(row, ['Inversión', 'Gasto', 'Spend', 'Cost']))
        return ventas === 0 && gasto > 5
      })
      .map((row) => {
        const puja = parseAmazonNumber(getValue(row, ['Puja', 'Bid']))
        const clics = parseAmazonNumber(getValue(row, ['Clics', 'Clicks']))
        const gasto = parseAmazonNumber(getValue(row, ['Inversión', 'Gasto', 'Spend', 'Cost'])) || puja * clics
        return {
          term: String(getValue(row, ['Texto de palabra clave', 'Keyword Text']) || '').trim(),
          spend: gasto,
          sales: parseAmazonNumber(getValue(row, ['Ventas', 'Sales'])),
          clicks: clics,
          acos: 0,
        }
      })
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 5)

    // Identificar Winners (Top 5 mejores)
    const winners = normalizedBulkData
      .filter((row) => {
        const entity = getValue(row, ['Entidad', 'Entity'])
        if (entity !== 'Palabra clave' && entity !== 'Keyword') return false
        const acosRaw = parseAmazonNumber(getValue(row, ['ACOS', 'Acos', 'ACOS total']))
        const acos = acosRaw > 1 ? acosRaw / 100 : acosRaw
        const ventas = parseAmazonNumber(getValue(row, ['Ventas', 'Sales']))
        return acos > 0 && acos < 0.10 && ventas > 0
      })
      .map((row) => {
        const puja = parseAmazonNumber(getValue(row, ['Puja', 'Bid']))
        const clics = parseAmazonNumber(getValue(row, ['Clics', 'Clicks']))
        const acosRaw = parseAmazonNumber(getValue(row, ['ACOS', 'Acos', 'ACOS total']))
        const acos = acosRaw > 1 ? acosRaw / 100 : acosRaw
        const ventas = parseAmazonNumber(getValue(row, ['Ventas', 'Sales']))
        return {
          term: String(getValue(row, ['Texto de palabra clave', 'Keyword Text']) || '').trim(),
          acos: acos,
          sales: ventas,
          conversion_rate: clics > 0 ? ventas / clics : 0,
          spend: puja * clics,
        }
      })
      .sort((a, b) => a.acos - b.acos)
      .slice(0, 5)

    // Identificar Harvest Opportunities
    const harvestOpportunities = searchData
      .filter((row) => {
        const pedidos = parseAmazonNumber(
          getValue(row, ['Pedidos totales de 7 días (#)', 'Pedidos', 'Orders', 'Total Orders'])
        )
        const acosRaw = parseAmazonNumber(
          getValue(row, [
            'Coste publicitario de las ventas (ACOS) total ',
            'Coste publicitario de las ventas (ACOS) total',
            'ACOS',
            'ACOS total',
            'Total ACOS',
          ])
        )
        const acos = acosRaw > 1 ? acosRaw / 100 : acosRaw
        return pedidos >= 1 && acos < 0.30
      })
      .map((row) => {
        const pedidos = parseAmazonNumber(
          getValue(row, ['Pedidos totales de 7 días (#)', 'Pedidos', 'Orders'])
        )
        const acosRaw = parseAmazonNumber(
          getValue(row, [
            'Coste publicitario de las ventas (ACOS) total ',
            'Coste publicitario de las ventas (ACOS) total',
            'ACOS',
            'ACOS total',
          ])
        )
        const acos = acosRaw > 1 ? acosRaw / 100 : acosRaw
        return {
          term: String(
            getValue(row, ['Término de búsqueda de cliente', 'Término de búsqueda', 'Search Term']) || ''
          ).trim(),
          origin_campaign: String(getValue(row, ['Nombre de campaña', 'Campaña', 'Campaign', 'Campaign Name']) || '').trim(),
          orders: pedidos,
          acos: acos,
        }
      })
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 5)

    // Calcular CPC medio
    const avgCPC = totalClics > 0 ? (totalSpend / totalClics) : 0

    return NextResponse.json({
      success: true,
      data: {
        client_context: {
          target_acos: targetACOS / 100,
          total_spend_week: totalSpend,
          global_acos: globalACOS / 100,
          total_sales: totalSales,
          total_clicks: totalClics,
          avg_cpc: avgCPC,
        },
        bleeders_analysis: bleeders,
        winners_analysis: winners,
        harvest_opportunities: harvestOpportunities,
      },
    })
  } catch (error: any) {
    console.error('Error analyzing data:', error)
    return NextResponse.json(
      { error: error.message || 'Error al analizar los archivos' },
      { status: 500 }
    )
  }
}

