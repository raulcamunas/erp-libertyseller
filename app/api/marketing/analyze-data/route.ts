import { NextRequest, NextResponse } from 'next/server'
import XLSX from 'xlsx'
import Papa from 'papaparse'

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

    // Parsear Search Term Report (CSV)
    const searchText = await searchFile.text()
    const searchData: SearchTermRow[] = []
    
    const parseResult = Papa.parse<SearchTermRow>(searchText, {
      header: true,
      skipEmptyLines: true,
      encoding: 'UTF-8',
    })

    parseResult.data.forEach((row: any) => {
      searchData.push({
        'Término de búsqueda de cliente': row['Término de búsqueda de cliente'] || '',
        'Pedidos totales de 7 días (#)': parseFloat(String(row['Pedidos totales de 7 días (#)'] || '0').replace(',', '.')) || 0,
        'Coste publicitario de las ventas (ACOS) total': parseFloat(String(row['Coste publicitario de las ventas (ACOS) total'] || '0').replace(',', '.').replace('%', '')) || 0,
        'Campaña': row['Campaña'] || '',
      })
    })

    // Parsear Bulk File (XLSX)
    const bulkBuffer = await bulkFile.arrayBuffer()
    const bulkWorkbook = XLSX.read(bulkBuffer, { type: 'array' })
    const bulkSheetName = bulkWorkbook.SheetNames[0]
    const bulkSheet = bulkWorkbook.Sheets[bulkSheetName]
    const bulkData: BulkRow[] = XLSX.utils.sheet_to_json(bulkSheet, { raw: false })

    // Normalizar datos del Bulk File
    const normalizedBulkData: BulkRow[] = bulkData.map((row: any) => ({
      'ID de la campaña': String(row['ID de la campaña'] || row['Campaign ID'] || ''),
      'Entidad': String(row['Entidad'] || row['Entity'] || ''),
      'Texto de palabra clave': String(row['Texto de palabra clave'] || row['Keyword Text'] || ''),
      'Puja': parseFloat(String(row['Puja'] || row['Bid'] || '0').replace(',', '.').replace('€', '').trim()) || 0,
      'ACOS': parseFloat(String(row['ACOS'] || row['Acos'] || '0').replace(',', '.').replace('%', '').trim()) || 0,
      'Ventas': parseFloat(String(row['Ventas'] || row['Sales'] || '0').replace(',', '.').replace('€', '').trim()) || 0,
      'Clics': parseFloat(String(row['Clics'] || row['Clicks'] || '0').replace(',', '.')) || 0,
      'Impresiones': parseFloat(String(row['Impresiones'] || row['Impressions'] || '0').replace(',', '.')) || 0,
    }))

    // Calcular totales
    const totalSpend = normalizedBulkData.reduce((sum, row) => {
      const spend = row['Puja'] * row['Clics'] || 0
      return sum + spend
    }, 0)

    const totalSales = normalizedBulkData.reduce((sum, row) => sum + row['Ventas'], 0)
    const globalACOS = totalSpend > 0 ? (totalSpend / totalSales) * 100 : 0

    // Identificar Bleeders (Top 5 peores)
    const bleeders = normalizedBulkData
      .filter(row => row['Clics'] > 15 && row['Ventas'] === 0)
      .map(row => ({
        term: row['Texto de palabra clave'],
        spend: row['Puja'] * row['Clics'],
        sales: row['Ventas'],
        clicks: row['Clics'],
        acos: row['ACOS'] / 100,
      }))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 5)

    // Identificar Winners (Top 5 mejores)
    const winners = normalizedBulkData
      .filter(row => row['ACOS'] > 0 && row['ACOS'] < 10 && row['Ventas'] > 0)
      .map(row => ({
        term: row['Texto de palabra clave'],
        acos: row['ACOS'] / 100,
        sales: row['Ventas'],
        conversion_rate: row['Clics'] > 0 ? row['Ventas'] / row['Clics'] : 0,
        spend: row['Puja'] * row['Clics'],
      }))
      .sort((a, b) => a.acos - b.acos)
      .slice(0, 5)

    // Identificar Harvest Opportunities
    const harvestOpportunities = searchData
      .filter(row => {
        const pedidos = typeof row['Pedidos totales de 7 días (#)'] === 'number' 
          ? row['Pedidos totales de 7 días (#)'] 
          : parseFloat(String(row['Pedidos totales de 7 días (#)']).replace(',', '.')) || 0
        
        const acos = typeof row['Coste publicitario de las ventas (ACOS) total'] === 'number'
          ? row['Coste publicitario de las ventas (ACOS) total']
          : parseFloat(String(row['Coste publicitario de las ventas (ACOS) total']).replace(',', '.').replace('%', '')) || 0

        return pedidos >= 1 && acos < 30
      })
      .map(row => {
        const pedidos = typeof row['Pedidos totales de 7 días (#)'] === 'number' 
          ? row['Pedidos totales de 7 días (#)'] 
          : parseFloat(String(row['Pedidos totales de 7 días (#)']).replace(',', '.')) || 0
        
        const acos = typeof row['Coste publicitario de las ventas (ACOS) total'] === 'number'
          ? row['Coste publicitario de las ventas (ACOS) total']
          : parseFloat(String(row['Coste publicitario de las ventas (ACOS) total']).replace(',', '.').replace('%', '')) || 0

        return {
          term: String(row['Término de búsqueda de cliente']).trim(),
          origin_campaign: String(row['Campaña']).trim(),
          orders: pedidos,
          acos: acos / 100,
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

