import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/api'
import * as XLSX from 'xlsx'
import { comprobarTamañoPeticion } from '@/lib/subidas-limite'

export async function POST(request: NextRequest) {
  try {
    // QUÉ IMPIDE: que esta ruta le conteste a cualquiera de internet. No
    // comprobaba nada, y middleware.ts (línea 41) declara pública toda /api/,
    // así que bastaba un curl SIN cookie para dispararla. Ver lib/auth/api.ts,
    // donde está reproducido con el curl exacto.
    //
    // La llaman components/ppc/ChangesReview.tsx y OptimizerTool.tsx, con sesión.
    //
    // Se pide SESIÓN y nada más —ni rol ni permiso de módulo— a propósito: hoy
    // esta pantalla la abre cualquiera con sesión, y exigir un permiso que hoy
    // no se exige dejaría fuera a alguien que trabaja.
    const sesion = await requireSession()
    if (sesion instanceof NextResponse) return sesion

    // Tope de bytes ANTES de formData(): formData() bufferiza el cuerpo entero.
    // Esta ruta no recibe ficheros, solo el JSON de cambios, pero sin tope
    // aceptaba igual un cuerpo de 60 MB sin sesión. Ver lib/subidas-limite.ts.
    const demasiado = comprobarTamañoPeticion(request)
    if (demasiado) return demasiado

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

