import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const changesJson = formData.get('changes') as string

    if (!changesJson) {
      return NextResponse.json(
        { error: 'No se proporcionaron cambios' },
        { status: 400 }
      )
    }

    const changes = JSON.parse(changesJson)

    // Asegurar que todas las filas tengan las columnas requeridas de Amazon
    const normalizedChanges = changes.map((change: any) => ({
      'Producto': change['Producto'] || '',
      'Entidad': change['Entidad'] || 'Palabra clave',
      'Operación': change['Operación'] || 'UPDATE',
      'ID de la campaña': change['ID de la campaña'] || '',
      'ID del grupo de anuncios': change['ID del grupo de anuncios'] || '',
      'ID de palabra clave': change['ID de palabra clave'] || '',
      'Puja': change['Puja'] || 0,
      'Estado': change['Estado'] || 'habilitado',
      'Texto de palabra clave': change['Texto de palabra clave'] || '',
      'Tipo de coincidencia': change['Tipo de coincidencia'] || 'exacta',
    }))

    // Generar archivo XLSX con formato Amazon
    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.json_to_sheet(normalizedChanges)
    XLSX.utils.book_append_sheet(workbook, sheet, 'Optimización')

    // Generar buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="optimizacion_lista.xlsx"`,
      },
    })
  } catch (error: any) {
    console.error('Error generating Excel:', error)
    return NextResponse.json(
      { error: error.message || 'Error al generar Excel' },
      { status: 500 }
    )
  }
}

