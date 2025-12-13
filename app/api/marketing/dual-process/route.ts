import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

interface BulkRow {
  [key: string]: any
  'Entidad'?: string
  'Entity'?: string
  'ID de la campaña'?: string
  'Campaign ID'?: string
  'Texto de palabra clave'?: string
  'Keyword Text'?: string
  'Puja'?: number
  'Bid'?: number
  'ACOS'?: number
  'Acos'?: number
  'Ventas'?: number
  'Sales'?: number
  'Clics'?: number
  'Clicks'?: number
  'Gasto'?: number
  'Spend'?: number
  'Impresiones'?: number
  'Impressions'?: number
}

interface SearchTermRow {
  [key: string]: any
  'Término de búsqueda de cliente'?: string
  'Pedidos totales de 7 días (#)'?: number
  'Pedidos'?: number
  'Coste publicitario de las ventas (ACOS) total'?: number
  'ACOS'?: number
  'Campaña'?: string
  'Campaign'?: string
}

interface OutputRow {
  'Producto': string
  'Entidad': string
  'Operación': string
  'ID de la campaña': string
  'ID del grupo de anuncios': string
  'ID de palabra clave': string
  'Puja': number
  'Estado': string
  'Texto de palabra clave': string
  'Tipo de coincidencia': string
}

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
 * Para Bulk: busca columna "Entidad" o "Entity"
 * Para Search Terms: busca columna "Término de búsqueda de cliente"
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

    // Normalizar la primera fila (headers)
    const headers = rows[0].map((h: any) => String(h).trim())

    // Verificar si alguna de las columnas buscadas existe
    const found = searchColumns.some((col) =>
      headers.some((header: string) =>
        header.toLowerCase().includes(col.toLowerCase())
      )
    )

    if (found) {
      // Convertir a JSON con headers normalizados
      const jsonData = XLSX.utils.sheet_to_json(sheet, { defval: '' })
      // Normalizar todas las claves
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
 * Parsea un número de formato Amazon (puede tener comas, puntos, símbolos de moneda)
 */
function parseAmazonNumber(value: any): number {
  if (typeof value === 'number') return value
  if (!value) return 0

  const str = String(value)
    .replace(/[€$£,]/g, '')
    .replace(/\s/g, '')
    .replace('%', '')
    .trim()

  // Manejar formato europeo (1.234,56) o americano (1,234.56)
  const hasComma = str.includes(',')
  const hasDot = str.includes('.')

  if (hasComma && hasDot) {
    // Determinar cuál es el separador de miles
    const lastComma = str.lastIndexOf(',')
    const lastDot = str.lastIndexOf('.')
    if (lastComma > lastDot) {
      // Formato europeo: 1.234,56
      return parseFloat(str.replace(/\./g, '').replace(',', '.'))
    } else {
      // Formato americano: 1,234.56
      return parseFloat(str.replace(/,/g, ''))
    }
  } else if (hasComma) {
    // Probablemente formato europeo
    return parseFloat(str.replace(',', '.'))
  } else {
    return parseFloat(str) || 0
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const bulkFile = formData.get('bulkFile') as File
    const searchFile = formData.get('searchFile') as File
    const targetACOS = formData.get('targetACOS')
      ? parseFloat(formData.get('targetACOS') as string) / 100
      : 0.20

    if (!bulkFile || !searchFile) {
      return NextResponse.json(
        { error: 'Se requieren ambos archivos (bulkFile y searchFile)' },
        { status: 400 }
      )
    }

    // 1. PARSEAR BULK FILE
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

    // 2. PARSEAR SEARCH TERM REPORT
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

    // 3. MAPEO DE CAMPAÑAS (Indexación)
    // Crear mapa: CampaignName -> CampaignID
    const campaignMap = new Map<string, string>()

    for (const row of bulkData) {
      const entity = getValue(row, ['Entidad', 'Entity'])
      const campaignId = getValue(row, ['ID de la campaña', 'Campaign ID'])
      const campaignName = getValue(row, ['Campaña', 'Campaign', 'Nombre de campaña', 'Campaign Name'])

      if (entity && (entity === 'Campaña' || entity === 'Campaign')) {
        if (campaignId && campaignName) {
          campaignMap.set(String(campaignName).trim(), String(campaignId).trim())
        }
      }
    }

    // 4. LÓGICA DE FUSIÓN
    const outputRows: OutputRow[] = []

    // 4.1. COSECHA (Harvesting) - Search Term Report
    for (const searchRow of searchData) {
      const searchTerm = getValue(searchRow, [
        'Término de búsqueda de cliente',
        'Término de búsqueda',
        'Search Term',
      ])
      const pedidos = parseAmazonNumber(
        getValue(searchRow, [
          'Pedidos totales de 7 días (#)',
          'Pedidos',
          'Orders',
          'Total Orders',
        ])
      )
      const acos = parseAmazonNumber(
        getValue(searchRow, [
          'Coste publicitario de las ventas (ACOS) total',
          'ACOS',
          'ACOS total',
          'Total ACOS',
        ])
      ) / 100 // Convertir porcentaje a decimal

      const campaignName = getValue(searchRow, ['Campaña', 'Campaign', 'Nombre de campaña'])

      // Condición: Pedidos >= 1 y ACOS < 0.30
      if (pedidos >= 1 && acos < 0.30 && searchTerm && campaignName) {
        // Buscar la campaña Manual equivalente
        const campaignId = campaignMap.get(String(campaignName).trim())

        if (campaignId) {
          // Buscar una palabra clave existente en esa campaña para obtener datos base
          const baseKeyword = bulkData.find(
            (r) =>
              getValue(r, ['ID de la campaña', 'Campaign ID']) === campaignId &&
              getValue(r, ['Entidad', 'Entity']) === 'Palabra clave'
          )

          const baseBid = baseKeyword
            ? parseAmazonNumber(getValue(baseKeyword, ['Puja', 'Bid']))
            : 0.5

          outputRows.push({
            'Producto': baseKeyword ? (getValue(baseKeyword, ['Producto', 'Product', 'SKU']) || '') : '',
            'Entidad': 'Palabra clave',
            'Operación': 'CREATE',
            'ID de la campaña': String(campaignId),
            'ID del grupo de anuncios': baseKeyword ? (getValue(baseKeyword, [
              'ID del grupo de anuncios',
              'Ad Group ID',
            ]) || '') : '',
            'ID de palabra clave': '',
            'Puja': Math.round(baseBid * 100) / 100,
            'Estado': 'habilitado',
            'Texto de palabra clave': String(searchTerm).trim(),
            'Tipo de coincidencia': 'exacta',
          })
        }
      }
    }

    // 4.2. OPTIMIZACIÓN (Bidding) - Bulk File
    for (const bulkRow of bulkData) {
      const entity = getValue(bulkRow, ['Entidad', 'Entity'])

      // Solo procesar filas de "Palabra clave"
      if (entity !== 'Palabra clave' && entity !== 'Keyword') continue

      const campaignId = getValue(bulkRow, ['ID de la campaña', 'Campaign ID'])
      const keywordText = getValue(bulkRow, ['Texto de palabra clave', 'Keyword Text'])
      const currentBid = parseAmazonNumber(getValue(bulkRow, ['Puja', 'Bid']))
      const acos = parseAmazonNumber(getValue(bulkRow, ['ACOS', 'Acos', 'ACOS total'])) / 100
      const ventas = parseAmazonNumber(getValue(bulkRow, ['Ventas', 'Sales', 'Revenue']))
      const gasto = parseAmazonNumber(
        getValue(bulkRow, ['Gasto', 'Spend', 'Cost', 'Coste'])
      ) || (currentBid * parseAmazonNumber(getValue(bulkRow, ['Clics', 'Clicks'])) || 0)

      let newBid = currentBid
      let operation = 'UPDATE'

      // BLEEDERS: Ventas == 0 & Gasto > 5 -> Puja = 0.05
      if (ventas === 0 && gasto > 5) {
        newBid = 0.05
        operation = 'UPDATE'
      }
      // WINNERS: ACOS < 0.10 -> Puja * 1.2
      else if (acos > 0 && acos < 0.10) {
        newBid = currentBid * 1.2
        operation = 'UPDATE'
      }
      // CORRECTION: ACOS > 0.35 -> Puja * 0.8
      else if (acos > 0.35) {
        newBid = currentBid * 0.8
        operation = 'UPDATE'
      }

      // Solo agregar si hay cambio significativo (más del 5% o cambio de bleeders)
      const changePercent =
        currentBid > 0 ? Math.abs(newBid - currentBid) / currentBid : 1

      if (changePercent > 0.05 || (ventas === 0 && gasto > 5)) {
        outputRows.push({
          'Producto': getValue(bulkRow, ['Producto', 'Product', 'SKU']) || '',
          'Entidad': 'Palabra clave',
          'Operación': operation,
          'ID de la campaña': String(campaignId || ''),
          'ID del grupo de anuncios':
            getValue(bulkRow, ['ID del grupo de anuncios', 'Ad Group ID']) || '',
          'ID de palabra clave':
            getValue(bulkRow, ['ID de palabra clave', 'Keyword ID']) || '',
          'Puja': Math.round(newBid * 100) / 100,
          'Estado': 'habilitado',
          'Texto de palabra clave': String(keywordText || '').trim(),
          'Tipo de coincidencia':
            getValue(bulkRow, ['Tipo de coincidencia', 'Match Type']) || 'exacta',
        })
      }
    }

    // 5. GENERAR ARCHIVO XLSX DE SALIDA
    const outputWorkbook = XLSX.utils.book_new()
    const outputSheet = XLSX.utils.json_to_sheet(outputRows)
    XLSX.utils.book_append_sheet(outputWorkbook, outputSheet, 'Optimización')

    // Generar buffer del archivo
    const outputBuffer = XLSX.write(outputWorkbook, { type: 'buffer', bookType: 'xlsx' })

    // Devolver JSON con los cambios para revisión
    return NextResponse.json({
      success: true,
      changes: outputRows,
      summary: {
        total_changes: outputRows.length,
        updates: outputRows.filter((r) => r['Operación'] === 'UPDATE').length,
        new_keywords: outputRows.filter((r) => r['Operación'] === 'CREATE').length,
      },
    })
  } catch (error: any) {
    console.error('Error processing files:', error)
    return NextResponse.json(
      { error: error.message || 'Error al procesar los archivos' },
      { status: 500 }
    )
  }
}
