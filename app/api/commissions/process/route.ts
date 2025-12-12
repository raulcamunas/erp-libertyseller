import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { parseCSV, parseNum, getVal } from '@/lib/utils/csv-parser'
import { CommissionCalculationData, CommissionRow } from '@/lib/types/commissions'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const filePreviousYear = formData.get('filePreviousYear') as File | null
    const fileCurrentYear = formData.get('fileCurrentYear') as File | null
    const clientId = formData.get('clientId') as string

    // Obtener cliente primero para saber si es ShoesF
    const supabase = await createClient()
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single()

    if (clientError || !client) {
      return NextResponse.json(
        { error: 'Cliente no encontrado' },
        { status: 404 }
      )
    }

    const isShoesF = client.name === 'ShoesF'

    // Validar archivos según el tipo de cliente
    if (isShoesF) {
      if (!filePreviousYear || !fileCurrentYear || !clientId) {
        return NextResponse.json(
          { error: 'Se requieren ambos archivos CSV (año anterior y año actual)' },
          { status: 400 }
        )
      }
    } else {
      if (!file || !clientId) {
        return NextResponse.json(
          { error: 'Archivo y cliente son requeridos' },
          { status: 400 }
        )
      }
    }

    // Si es ShoesF, procesar comparación entre años
    if (isShoesF) {
      return await processShoesFComparison(
        filePreviousYear!,
        fileCurrentYear!,
        client,
        supabase
      )
    }

    // Procesamiento normal para otros clientes
    const csvContent = await file!.text()
    const rows = parseCSV(csvContent)

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'El archivo CSV está vacío o no es válido' },
        { status: 400 }
      )
    }

    const { data: exceptions } = await supabase
      .from('commission_exceptions')
      .select('*')
      .eq('client_id', clientId)

    // Procesar cada fila
    const processedRows: CommissionRow[] = []
    const errors: string[] = []

    let totalSales = 0
    let totalRefunds = 0

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      
      try {
        // Obtener valores con parsing robusto
        const grossSales = parseNum(
          getVal(row, ['Sales', 'Ventas', /Sales/i, /Ventas/i, 'Gross Sales', /Gross.*Sales/i])
        )

        const refunds = Math.abs(parseNum(
          getVal(row, [
            'Refund Cost',
            'Refund сost', // Con caracteres cirílicos
            'Coste reembolso',
            /Refund.*[Cc]ost/i,
            /Coste.*reembolso/i,
            /Reembolso/i
          ])
        ))

        const productTitle = getVal(row, [
          'Product',
          'Title',
          'Nombre',
          'Product Title',
          /Product.*Title/i,
          /Nombre.*Producto/i
        ]) || 'Sin nombre'

        const asin = getVal(row, [
          'ASIN',
          'asin',
          'Asin'
        ]) || 'N/A'

        const orderId = getVal(row, [
          'Order ID',
          'OrderId',
          'Order',
          'Pedido',
          /Order.*ID/i,
          /Pedido/i
        ]) || undefined

        const date = getVal(row, [
          'Date',
          'Fecha',
          'Sale Date',
          /Date/i,
          /Fecha/i
        ]) || undefined

        const quantity = parseNum(
          getVal(row, [
            'Quantity',
            'Cantidad',
            'Qty',
            /Quantity/i,
            /Cantidad/i
          ])
        ) || undefined

        // CÁLCULOS CORRECTOS:
        // 1. Facturación real = Ventas - Reembolsos
        const realTurnover = grossSales - refunds
        
        // 2. Base neta SIN IVA (descontamos el 21% de IVA)
        // Si realTurnover incluye IVA: netBase = realTurnover / 1.21
        // Esto quita el IVA antes de calcular comisiones
        const netBase = realTurnover / 1.21
        
        // 3. IVA descontado (para mostrar en el informe)
        const iva = realTurnover - netBase

        // Determinar tasa de comisión
        let commissionRate = client.base_commission_rate
        let appliedException: string | undefined

        // Buscar excepciones por keyword (case insensitive)
        // IMPORTANTE: Las excepciones tienen prioridad sobre la tasa base
        if (exceptions && exceptions.length > 0) {
          const productTitleLower = productTitle.toLowerCase()
          // Buscar todas las excepciones que coincidan
          const matchingExceptions = exceptions.filter(exception => 
            productTitleLower.includes(exception.keyword.toLowerCase())
          )
          
          // Si hay múltiples excepciones, usar la primera encontrada
          // (En el futuro se podría usar la más baja o más alta según reglas)
          if (matchingExceptions.length > 0) {
            commissionRate = matchingExceptions[0].special_rate
            appliedException = matchingExceptions[0].keyword
          }
        }

        // 4. Comisión = Base neta (SIN IVA) * Tasa
        // Esto asegura que la comisión se calcula sobre la base sin IVA
        const commission = netBase * commissionRate

        processedRows.push({
          productTitle,
          asin,
          orderId,
          date,
          quantity,
          grossSales,
          refunds,
          realTurnover,
          iva,
          netBase,
          commissionRate,
          commission,
          appliedException,
          rowNumber: i + 2 // Fila en el CSV (empezando desde 2 por el header)
        })

        totalSales += grossSales
        totalRefunds += refunds

      } catch (error: any) {
        errors.push(`Fila ${i + 2}: ${error.message || 'Error al procesar'}`)
      }
    }

    // Calcular totales
    const realTurnover = totalSales - totalRefunds
    const netBase = realTurnover / 1.21
    const totalIva = realTurnover - netBase
    const totalCommission = processedRows.reduce((sum, r) => sum + r.commission, 0)
    
    // Calcular tasa promedio de comisión
    const totalWeightedRate = processedRows.reduce((sum, r) => {
      return sum + (r.commissionRate * r.netBase)
    }, 0)
    const averageCommissionRate = netBase > 0 ? totalWeightedRate / netBase : 0
    
    // Contar pedidos únicos
    const uniqueOrders = new Set(processedRows.map(r => r.orderId).filter(Boolean))
    const totalOrders = uniqueOrders.size || processedRows.length

    const result: CommissionCalculationData = {
      summary: {
        totalSales,
        totalRefunds,
        realTurnover,
        totalIva,
        netBase,
        totalCommission,
        averageCommissionRate,
        totalOrders
      },
      rows: processedRows,
      errors
    }

    return NextResponse.json({
      success: true,
      data: result
    })

  } catch (error: any) {
    console.error('Error processing commission CSV:', error)
    return NextResponse.json(
      { error: 'Error al procesar el archivo', details: error.message },
      { status: 500 }
    )
  }
}

// Función para procesar comparación de ShoesF
async function processShoesFComparison(
  filePreviousYear: File,
  fileCurrentYear: File,
  client: any,
  supabase: any
) {
  try {
    // Leer ambos archivos
    const csvContentPrevious = await filePreviousYear.text()
    const csvContentCurrent = await fileCurrentYear.text()

    // Parsear ambos CSVs
    const rowsPrevious = parseCSV(csvContentPrevious)
    const rowsCurrent = parseCSV(csvContentCurrent)

    if (rowsPrevious.length === 0 || rowsCurrent.length === 0) {
      return NextResponse.json(
        { error: 'Uno o ambos archivos CSV están vacíos o no son válidos' },
        { status: 400 }
      )
    }

    // Procesar año anterior: crear un mapa por ASIN para hacer match
    const previousYearData = new Map<string, { netBase: number, grossSales: number, refunds: number }>()
    let previousYearNetBase = 0
    const errors: string[] = []

    for (let i = 0; i < rowsPrevious.length; i++) {
      const row = rowsPrevious[i]
      try {
        const grossSales = parseNum(
          getVal(row, ['Sales', 'Ventas', /Sales/i, /Ventas/i, 'Gross Sales', /Gross.*Sales/i])
        )
        const refunds = Math.abs(parseNum(
          getVal(row, [
            'Refund Cost',
            'Refund сost',
            'Coste reembolso',
            /Refund.*[Cc]ost/i,
            /Coste.*reembolso/i,
            /Reembolso/i
          ])
        ))
        const asin = getVal(row, ['ASIN', 'asin', 'Asin']) || 'N/A'
        const realTurnover = grossSales - refunds
        const netBase = realTurnover / 1.21 // Quitar IVA
        
        // Agrupar por ASIN (sumar si hay múltiples filas del mismo producto)
        const existing = previousYearData.get(asin) || { netBase: 0, grossSales: 0, refunds: 0 }
        previousYearData.set(asin, {
          netBase: existing.netBase + netBase,
          grossSales: existing.grossSales + grossSales,
          refunds: existing.refunds + refunds
        })
        
        previousYearNetBase += netBase
      } catch (error: any) {
        errors.push(`Fila ${i + 2} (Año Anterior): ${error.message || 'Error al procesar'}`)
      }
    }

    // Calcular base neta (sin IVA) para año actual y hacer match con año anterior
    let currentYearNetBase = 0
    const processedRows: CommissionRow[] = []

    for (let i = 0; i < rowsCurrent.length; i++) {
      const row = rowsCurrent[i]
      try {
        const grossSales = parseNum(
          getVal(row, ['Sales', 'Ventas', /Sales/i, /Ventas/i, 'Gross Sales', /Gross.*Sales/i])
        )
        const refunds = Math.abs(parseNum(
          getVal(row, [
            'Refund Cost',
            'Refund сost',
            'Coste reembolso',
            /Refund.*[Cc]ost/i,
            /Coste.*reembolso/i,
            /Reembolso/i
          ])
        ))
        const productTitle = getVal(row, [
          'Product',
          'Title',
          'Nombre',
          'Product Title',
          /Product.*Title/i,
          /Nombre.*Producto/i
        ]) || 'Sin nombre'
        const asin = getVal(row, ['ASIN', 'asin', 'Asin']) || 'N/A'
        const orderId = getVal(row, ['Order ID', 'OrderId', 'Order', 'Pedido', /Order.*ID/i, /Pedido/i]) || undefined
        const date = getVal(row, ['Date', 'Fecha', 'Sale Date', /Date/i, /Fecha/i]) || undefined
        const quantity = parseNum(getVal(row, ['Quantity', 'Cantidad', 'Qty', /Quantity/i, /Cantidad/i]))

        const realTurnover = grossSales - refunds
        const netBase = realTurnover / 1.21 // Quitar IVA
        const iva = realTurnover - netBase

        currentYearNetBase += netBase

        // Buscar datos del año anterior para este ASIN
        const previousYearInfo = previousYearData.get(asin) || { netBase: 0, grossSales: 0, refunds: 0 }

        // Guardar fila para el reporte detallado
        processedRows.push({
          productTitle,
          asin,
          orderId,
          date,
          quantity,
          grossSales,
          refunds,
          realTurnover,
          iva,
          netBase,
          commissionRate: 0, // No aplicamos tasa por producto en ShoesF
          commission: 0, // La comisión se calcula sobre el excedente total
          rowNumber: i + 2,
          // Datos de comparación para ShoesF
          previousYearNetBase: previousYearInfo.netBase,
          currentYearNetBase: netBase
        })
      } catch (error: any) {
        errors.push(`Fila ${i + 2} (Año Actual): ${error.message || 'Error al procesar'}`)
      }
    }

    // Calcular excedente (año actual - año anterior)
    const excessAmount = Math.max(0, currentYearNetBase - previousYearNetBase)

    // Calcular comisión: 5% sobre el excedente
    const commissionRate = client.base_commission_rate // 0.05 (5%)
    const totalCommission = excessAmount * commissionRate

    // Calcular totales para el resumen
    const totalSales = processedRows.reduce((sum, r) => sum + r.grossSales, 0)
    const totalRefunds = processedRows.reduce((sum, r) => sum + r.refunds, 0)
    const realTurnover = totalSales - totalRefunds
    const totalIva = realTurnover - currentYearNetBase
    const uniqueOrders = new Set(processedRows.map(r => r.orderId).filter(Boolean))
    const totalOrders = uniqueOrders.size || processedRows.length

    const result: CommissionCalculationData = {
      summary: {
        totalSales,
        totalRefunds,
        realTurnover,
        totalIva,
        netBase: currentYearNetBase,
        totalCommission,
        averageCommissionRate: commissionRate,
        totalOrders,
        // Datos específicos de ShoesF
        previousYearNetBase,
        currentYearNetBase,
        excessAmount
      },
      rows: processedRows,
      errors
    }

    return NextResponse.json({
      success: true,
      data: result
    })
  } catch (error: any) {
    console.error('Error processing ShoesF comparison:', error)
    return NextResponse.json(
      { error: 'Error al procesar la comparación', details: error.message },
      { status: 500 }
    )
  }
}

