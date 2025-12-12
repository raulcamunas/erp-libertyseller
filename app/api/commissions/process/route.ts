import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { parseCSV, parseNum, getVal } from '@/lib/utils/csv-parser'
import { CommissionCalculationData, CommissionRow } from '@/lib/types/commissions'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File
    const clientId = formData.get('clientId') as string

    if (!file || !clientId) {
      return NextResponse.json(
        { error: 'Archivo y cliente son requeridos' },
        { status: 400 }
      )
    }

    // Leer el contenido del archivo
    const csvContent = await file.text()

    // Parsear CSV
    const rows = parseCSV(csvContent)

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'El archivo CSV está vacío o no es válido' },
        { status: 400 }
      )
    }

    // Obtener cliente y excepciones desde Supabase
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

