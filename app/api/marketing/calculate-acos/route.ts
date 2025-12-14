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

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const bulkFile = formData.get('bulkFile') as File

    if (!bulkFile) {
      return NextResponse.json(
        { error: 'Se requiere el archivo Bulk File' },
        { status: 400 }
      )
    }

    // Parsear Bulk File
    const bulkBuffer = await bulkFile.arrayBuffer()
    const bulkWorkbook = XLSX.read(bulkBuffer, { type: 'array' })

    const bulkSheetResult = findCorrectSheet(
      bulkWorkbook,
      ['Entidad', 'Entity'],
      'Camp. de Sponsored Products'
    )
    if (!bulkSheetResult) {
      return NextResponse.json(
        { error: 'No se encontró la pestaña con columna "Entidad" en el Bulk File' },
        { status: 400 }
      )
    }

    const bulkData = bulkSheetResult.data

    // Calcular ACOS global - SOLO filas donde Entidad = "Campaña" para evitar duplicados
    // El archivo Bulk repite datos: Campaña + Grupo + Keyword = mismo dato 3 veces
    let totalSpend = 0
    let totalSales = 0
    let totalClics = 0

    for (const row of bulkData) {
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

    // Calcular CPC medio
    const avgCPC = totalClics > 0 ? (totalSpend / totalClics) : 0
    // Calcular ROAS
    const roas = totalSpend > 0 ? (totalSales / totalSpend) : 0

    return NextResponse.json({
      success: true,
      acos: globalACOS,
      totalSpend,
      totalSales,
      totalClics,
      avgCPC,
      roas,
    })
  } catch (error: any) {
    console.error('Error calculating ACOS:', error)
    return NextResponse.json(
      { error: error.message || 'Error al calcular el ACOS' },
      { status: 500 }
    )
  }
}

