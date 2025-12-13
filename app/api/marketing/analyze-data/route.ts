import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

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
  searchColumn: string | string[]
): { sheetName: string; data: any[] } | null {
  const searchColumns = Array.isArray(searchColumn) ? searchColumn : [searchColumn]

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
    const formData = await request.formData()
    const bulkFile = formData.get('bulkFile') as File
    const searchFile = formData.get('searchFile') as File
    const targetACOS = formData.get('targetACOS') ? parseFloat(formData.get('targetACOS') as string) : 20

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

    const bulkSheetResult = findCorrectSheet(bulkWorkbook, ['Entidad', 'Entity'])
    if (!bulkSheetResult) {
      return NextResponse.json(
        { error: 'No se encontró la pestaña con columna "Entidad" o "Entity" en el Bulk File' },
        { status: 400 }
      )
    }

    const bulkData: BulkRow[] = bulkSheetResult.data as BulkRow[]
    const normalizedBulkData: BulkRow[] = bulkData

    // Calcular totales
    const totalSpend = normalizedBulkData.reduce((sum, row) => {
      const puja = parseAmazonNumber(getValue(row, ['Puja', 'Bid']))
      const clics = parseAmazonNumber(getValue(row, ['Clics', 'Clicks']))
      const gasto = parseAmazonNumber(getValue(row, ['Gasto', 'Spend', 'Cost', 'Coste']))
      return sum + (gasto || puja * clics || 0)
    }, 0)

    const totalSales = normalizedBulkData.reduce((sum, row) => {
      return sum + parseAmazonNumber(getValue(row, ['Ventas', 'Sales', 'Revenue']))
    }, 0)
    const globalACOS = totalSpend > 0 ? (totalSpend / totalSales) * 100 : 0

    // Identificar Bleeders (Top 5 peores)
    const bleeders = normalizedBulkData
      .filter((row) => {
        const entity = getValue(row, ['Entidad', 'Entity'])
        if (entity !== 'Palabra clave' && entity !== 'Keyword') return false
        const ventas = parseAmazonNumber(getValue(row, ['Ventas', 'Sales']))
        const gasto = parseAmazonNumber(getValue(row, ['Gasto', 'Spend', 'Cost']))
        return ventas === 0 && gasto > 5
      })
      .map((row) => {
        const puja = parseAmazonNumber(getValue(row, ['Puja', 'Bid']))
        const clics = parseAmazonNumber(getValue(row, ['Clics', 'Clicks']))
        const gasto = parseAmazonNumber(getValue(row, ['Gasto', 'Spend', 'Cost'])) || puja * clics
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
        const acos = parseAmazonNumber(getValue(row, ['ACOS', 'Acos', 'ACOS total'])) / 100
        const ventas = parseAmazonNumber(getValue(row, ['Ventas', 'Sales']))
        return acos > 0 && acos < 0.10 && ventas > 0
      })
      .map((row) => {
        const puja = parseAmazonNumber(getValue(row, ['Puja', 'Bid']))
        const clics = parseAmazonNumber(getValue(row, ['Clics', 'Clicks']))
        const acos = parseAmazonNumber(getValue(row, ['ACOS', 'Acos', 'ACOS total'])) / 100
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
        const acos = parseAmazonNumber(
          getValue(row, [
            'Coste publicitario de las ventas (ACOS) total',
            'ACOS',
            'ACOS total',
            'Total ACOS',
          ])
        ) / 100
        return pedidos >= 1 && acos < 0.30
      })
      .map((row) => {
        const pedidos = parseAmazonNumber(
          getValue(row, ['Pedidos totales de 7 días (#)', 'Pedidos', 'Orders'])
        )
        const acos = parseAmazonNumber(
          getValue(row, [
            'Coste publicitario de las ventas (ACOS) total',
            'ACOS',
            'ACOS total',
          ])
        ) / 100
        return {
          term: String(
            getValue(row, ['Término de búsqueda de cliente', 'Término de búsqueda', 'Search Term']) || ''
          ).trim(),
          origin_campaign: String(getValue(row, ['Campaña', 'Campaign', 'Nombre de campaña']) || '').trim(),
          orders: pedidos,
          acos: acos,
        }
      })
      .sort((a, b) => b.orders - a.orders)
      .slice(0, 5)

    return NextResponse.json({
      success: true,
      data: {
        client_context: {
          target_acos: targetACOS / 100,
          total_spend_week: totalSpend,
          global_acos: globalACOS / 100,
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

