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

interface OutputRow {
  'Acción': 'UPDATE' | 'CREATE Keyword Exact' | 'CREATE Negative'
  'ID de la campaña': string
  'Entidad': string
  'Texto de palabra clave': string
  'Puja': number
  'ACOS': number
  'Ventas': number
  'Origen': string
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
    
    // Parsear CSV de forma síncrona
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

    const outputRows: OutputRow[] = []

    // 1. LÓGICA HARVESTING (Search Term Report)
    // Si Pedidos >= 1 y ACOS < 30%, buscar campaña Manual equivalente y crear Keyword Exact
    for (const searchRow of searchData) {
      const pedidos = typeof searchRow['Pedidos totales de 7 días (#)'] === 'number' 
        ? searchRow['Pedidos totales de 7 días (#)'] 
        : parseFloat(String(searchRow['Pedidos totales de 7 días (#)']).replace(',', '.')) || 0
      
      const acos = typeof searchRow['Coste publicitario de las ventas (ACOS) total'] === 'number'
        ? searchRow['Coste publicitario de las ventas (ACOS) total']
        : parseFloat(String(searchRow['Coste publicitario de las ventas (ACOS) total']).replace(',', '.').replace('%', '')) || 0

      if (pedidos >= 1 && acos < 30) {
        const searchTerm = String(searchRow['Término de búsqueda de cliente']).trim()
        const campaignName = String(searchRow['Campaña']).trim()

        if (!searchTerm || !campaignName) continue

        // Buscar campaña Manual equivalente en Bulk File
        const matchingCampaign = normalizedBulkData.find((bulkRow) => {
          const campaignId = bulkRow['ID de la campaña'].toLowerCase()
          const campaignNameLower = campaignName.toLowerCase()
          // Buscar por nombre de campaña o ID (case-insensitive)
          return campaignId.includes(campaignNameLower) || 
                 campaignNameLower.includes(campaignId) ||
                 campaignId === campaignNameLower
        })

        if (matchingCampaign) {
          outputRows.push({
            'Acción': 'CREATE Keyword Exact',
            'ID de la campaña': matchingCampaign['ID de la campaña'],
            'Entidad': matchingCampaign['Entidad'],
            'Texto de palabra clave': searchTerm,
            'Puja': matchingCampaign['Puja'] > 0 ? matchingCampaign['Puja'] : 0.5, // Puja inicial basada en la campaña
            'ACOS': acos,
            'Ventas': pedidos,
            'Origen': `Harvested from Search Term Report (Pedidos: ${pedidos}, ACOS: ${acos}%)`,
          })
        }
      }
    }

    // 2. LÓGICA OPTIMIZACIÓN (Bulk File)
    for (const bulkRow of normalizedBulkData) {
      let newBid = bulkRow['Puja']
      let action: 'UPDATE' | 'CREATE Negative' = 'UPDATE'
      let origen = 'Optimización automática'

      // BLEEDERS: Clics > 15 & Ventas == 0 -> Puja = 0.05
      if (bulkRow['Clics'] > 15 && bulkRow['Ventas'] === 0) {
        newBid = 0.05
        origen = 'Bleeder (Clics > 15, Ventas = 0)'
      }
      // WINNERS: ACOS < 10% -> Puja * 1.2
      else if (bulkRow['ACOS'] > 0 && bulkRow['ACOS'] < 10) {
        newBid = bulkRow['Puja'] * 1.2
        origen = 'Winner (ACOS < 10%)'
      }
      // AJUSTE: Puja * (TargetACOS / CurrentACOS)
      else if (bulkRow['ACOS'] > 0 && bulkRow['ACOS'] !== targetACOS) {
        newBid = bulkRow['Puja'] * (targetACOS / bulkRow['ACOS'])
        origen = `Ajuste a ACOS objetivo (${targetACOS}%)`
      }

      // Solo agregar si hay cambio significativo (más del 5%)
      if (Math.abs(newBid - bulkRow['Puja']) / bulkRow['Puja'] > 0.05) {
        outputRows.push({
          'Acción': action,
          'ID de la campaña': bulkRow['ID de la campaña'],
          'Entidad': bulkRow['Entidad'],
          'Texto de palabra clave': bulkRow['Texto de palabra clave'],
          'Puja': Math.round(newBid * 100) / 100, // Redondear a 2 decimales
          'ACOS': bulkRow['ACOS'],
          'Ventas': bulkRow['Ventas'],
          'Origen': origen,
        })
      }
    }

    // 3. GENERAR ARCHIVO XLSX DE SALIDA
    const outputWorkbook = XLSX.utils.book_new()
    const outputSheet = XLSX.utils.json_to_sheet(outputRows)
    XLSX.utils.book_append_sheet(outputWorkbook, outputSheet, 'Optimización')

    // Generar buffer del archivo
    const outputBuffer = XLSX.write(outputWorkbook, { type: 'buffer', bookType: 'xlsx' })

    // Devolver archivo como respuesta
    return new NextResponse(outputBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="optimizacion_ppc_${Date.now()}.xlsx"`,
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

