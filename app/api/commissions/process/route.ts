import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { parseCSV, parseNum, getVal } from '@/lib/utils/csv-parser'
import { CommissionCalculationData, CommissionRow } from '@/lib/types/commissions'
import * as XLSX from 'xlsx'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const filePreviousYear = formData.get('filePreviousYear') as File | null
    const fileCurrentYear = formData.get('fileCurrentYear') as File | null
    const clientId = formData.get('clientId') as string

    // Obtener cliente primero para saber si es ShoesF / SHOPLAMP u otros tipos especiales
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

    const isShoesF = client.name === 'ShoesF' || client.name === 'SHOPLAMP'
    const isDIRU = client.name === 'DIRU'
    const isSAUSI = client.name === 'SAUSI'
    const isCreativeToys = client.name === 'Creative Toys'
    const isLenobotics = client.name === 'Lenobotics'
    // Sistema anterior: Sales + Refund Cost, base neta = facturación real / 1.21
    const useOldCalculation = isCreativeToys || isLenobotics
    const isBenefitsClient = isDIRU || isSAUSI // Clientes que usan Net profit

    // Validar archivos según el tipo de cliente
    if (isShoesF) {
      if (!filePreviousYear || !fileCurrentYear || !clientId) {
        return NextResponse.json(
          { error: 'Se requieren ambos archivos CSV (año anterior y año actual)' },
          { status: 400 }
        )
      }
    } else if (isBenefitsClient) {
      if (!file || !clientId) {
        return NextResponse.json(
          { error: 'Archivo CSV y cliente son requeridos' },
          { status: 400 }
        )
      }
      // Verificar que sea un archivo CSV
      if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
        return NextResponse.json(
          { error: `${client.name} requiere un archivo CSV` },
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

    // Si es ShoesF / SHOPLAMP, procesar comparación entre años (dos CSV)
    if (isShoesF) {
      // ShoesF: 3% sobre excedente; SHOPLAMP: 5% sobre excedente
      const commissionRate =
        client.name === 'SHOPLAMP' ? 0.05 : 0.03

      return await processShoesFComparison(
        filePreviousYear!,
        fileCurrentYear!,
        client,
        supabase,
        commissionRate
      )
    }

    // Si es DIRU o SAUSI, procesar CSV con columna Net profit
    if (isBenefitsClient) {
      // Para SAUSI podemos recibir una tasa específica (15% o 35%)
      const benefitRateRaw = formData.get('benefitRate') as string | null
      const benefitRate = benefitRateRaw ? parseFloat(benefitRateRaw) : undefined

      return await processDIRUBenefits(
        file!,
        client,
        supabase,
        isSAUSI && benefitRate ? benefitRate : undefined
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
    let totalIvaAmazon = 0

    const byCurrencyAgg = new Map<string, {
      currency: string
      unitsGross: number
      unitsNet: number
      netBase: number
      iva: number
      totalInclusive: number
      commission: number
    }>()

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      
      try {
        // Datos comunes (producto, ASIN, pedido, etc.)
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

        let grossSales = 0
        let refunds = 0
        let realTurnover = 0
        let netBase = 0
        let iva = 0

        if (useOldCalculation) {
          // LÓGICA ANTIGUA (Creative Toys y Lenobotics: Sales, Refund Cost, base = facturación real / 1.21)
          grossSales = parseNum(
            getVal(row, ['Sales', 'Ventas', /Sales/i, /Ventas/i, 'Gross Sales', /Gross.*Sales/i])
          )

          refunds = Math.abs(parseNum(
            getVal(row, [
              'Refund Cost',
              'Refund сost', // Con caracteres cirílicos
              'Coste reembolso',
              /Refund.*[Cc]ost/i,
              /Coste.*reembolso/i,
              /Reembolso/i
            ])
          ))

          // 1. Facturación real = Ventas - Reembolsos
          realTurnover = grossSales - refunds
          
          // 2. Base neta SIN IVA (descontamos el 21% de IVA)
          netBase = realTurnover / 1.21
          
          // 3. IVA descontado (para mostrar en el informe)
          iva = realTurnover - netBase
        } else {
          // NUEVA LÓGICA AMAZON (todas las cuentas excepto Creative Toys)
          const transactionType = String(
            getVal(row, [
              'Transaction Type',
              'transaction_type',
              /Transaction.*Type/i
            ]) || ''
          ).toUpperCase()

          const currency = String(
            getVal(row, [
              'Currency',
              'currency',
              /Currency/i
            ]) || ''
          ).trim() || undefined

          const ourPrice = parseNum(
            getVal(row, [
              'OUR_PRICE Tax Exclusive Selling Price',
              /OUR_PRICE.*Tax Exclusive Selling Price/i
            ])
          )

          const shippingPrice = parseNum(
            getVal(row, [
              'SHIPPING Tax Exclusive Selling Price',
              /SHIPPING.*Tax Exclusive Selling Price/i
            ])
          )

          const promoNet = parseNum(
            getVal(row, [
              'OUR_PRICE Tax Exclusive Promo Amount',
              /OUR_PRICE.*Tax Exclusive Promo Amount/i
            ])
          )

          const taxAmount = parseNum(
            getVal(row, [
              'OUR_PRICE Tax Amount',
              /OUR_PRICE.*Tax Amount/i
            ])
          )

          // Neto final por línea (Base imponible real): producto + envío - promo
          const netLine = ourPrice + shippingPrice - promoNet
          const netLineAbs = Math.abs(netLine)
          const taxAmountAbs = Math.abs(taxAmount)

          if (transactionType === 'SHIPMENT') {
            // Ventas: sumamos la base imponible neta de la agencia (sin IVA)
            grossSales = netLineAbs
            refunds = 0
            realTurnover = netLineAbs
            netBase = netLineAbs // Ya viene sin IVA
            iva = taxAmountAbs

            totalSales += grossSales
            totalIvaAmazon += iva
          } else if (transactionType === 'RETURN' || transactionType === 'REFUND') {
            // Devoluciones/abonos: restamos la base imponible (en positivo)
            grossSales = 0
            refunds = netLineAbs
            realTurnover = -netLineAbs
            netBase = -netLineAbs
            iva = -taxAmountAbs

            totalRefunds += refunds
            totalIvaAmazon += iva
          } else {
            // Otros tipos de transacción se ignoran
            continue
          }

          // Agregar al agregado por moneda (para transparencia en reportes)
          const curKey = currency || 'N/A'
          const existing = byCurrencyAgg.get(curKey) || {
            currency: curKey,
            unitsGross: 0,
            unitsNet: 0,
            netBase: 0,
            iva: 0,
            totalInclusive: 0,
            commission: 0
          }
          const qty = quantity ?? 0
          const unitsGrossAdd = transactionType === 'SHIPMENT' ? qty : 0
          const unitsNetAdd = transactionType === 'SHIPMENT' ? qty : (transactionType === 'RETURN' || transactionType === 'REFUND') ? -qty : 0
          existing.unitsGross += unitsGrossAdd
          existing.unitsNet += unitsNetAdd
          existing.netBase += netBase
          existing.iva += iva
          existing.totalInclusive += (netBase + iva)
          byCurrencyAgg.set(curKey, existing)
        }

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

        // Comisión = Base neta (SIN IVA) * Tasa
        const commission = netBase * commissionRate

        const rowPayload: CommissionRow = {
          productTitle,
          asin,
          orderId,
          date,
          quantity,
          currency: !useOldCalculation ? (String(getVal(row, ['Currency', 'currency', /Currency/i]) || '').trim() || undefined) : undefined,
          grossSales,
          refunds,
          realTurnover,
          iva,
          netBase,
          commissionRate,
          commission,
          appliedException,
          rowNumber: i + 2 // Fila en el CSV (empezando desde 2 por el header)
        }

        // Para formato Amazon (Ham Master): detalle por línea con Order ID, tipo, base producto/envío
        if (!useOldCalculation) {
          const txnType = String(
            getVal(row, [
              'Transaction Type',
              'transaction_type',
              /Transaction.*Type/i
            ]) || ''
          ).toUpperCase()
          rowPayload.transactionTypeLabel = txnType === 'SHIPMENT' ? 'Venta' : 'Devolución'
          rowPayload.baseProductNet = parseNum(
            getVal(row, [
              'OUR_PRICE Tax Exclusive Selling Price',
              /OUR_PRICE.*Tax Exclusive Selling Price/i
            ])
          )
          rowPayload.baseShippingNet = parseNum(
            getVal(row, [
              'SHIPPING Tax Exclusive Selling Price',
              /SHIPPING.*Tax Exclusive Selling Price/i
            ])
          )
          rowPayload.promoNet = parseNum(
            getVal(row, [
              'OUR_PRICE Tax Exclusive Promo Amount',
              /OUR_PRICE.*Tax Exclusive Promo Amount/i
            ])
          )
          rowPayload.taxAmount = parseNum(
            getVal(row, [
              'OUR_PRICE Tax Amount',
              /OUR_PRICE.*Tax Amount/i
            ])
          )
          rowPayload.netLine = (rowPayload.baseProductNet ?? 0) + (rowPayload.baseShippingNet ?? 0) - (rowPayload.promoNet ?? 0)

          const rowCur = rowPayload.currency || 'N/A'
          const existing = byCurrencyAgg.get(rowCur) || {
            currency: rowCur,
            unitsGross: 0,
            unitsNet: 0,
            netBase: 0,
            iva: 0,
            totalInclusive: 0,
            commission: 0
          }
          existing.commission += commission
          byCurrencyAgg.set(rowCur, existing)
        }

        processedRows.push(rowPayload)

        // Si estamos en la lógica antigua (Creative Toys / Lenobotics), acumulamos aquí
        if (useOldCalculation) {
          totalSales += grossSales
          totalRefunds += refunds
        }

      } catch (error: any) {
        errors.push(`Fila ${i + 2}: ${error.message || 'Error al procesar'}`)
      }
    }

    // Calcular totales
    const realTurnover = totalSales - totalRefunds
    // En la nueva lógica Amazon, los importes ya vienen sin IVA, así que la base es igual
    const netBase = realTurnover
    const totalIva = useOldCalculation ? (realTurnover - netBase) : totalIvaAmazon
    const totalCommission = processedRows.reduce((sum, r) => sum + r.commission, 0)
    
    // Calcular tasa promedio de comisión
    const totalWeightedRate = processedRows.reduce((sum, r) => {
      return sum + (r.commissionRate * r.netBase)
    }, 0)
    const averageCommissionRate = netBase > 0 ? totalWeightedRate / netBase : 0
    
    // Contar pedidos únicos
    const uniqueOrders = new Set(processedRows.map(r => r.orderId).filter(Boolean))
    const totalOrders = uniqueOrders.size || processedRows.length

    const byCurrency = byCurrencyAgg.size
      ? Object.fromEntries(Array.from(byCurrencyAgg.entries()).map(([k, v]) => [k, v]))
      : undefined

    const result: CommissionCalculationData = {
      summary: {
        totalSales,
        totalRefunds,
        realTurnover,
        totalIva,
        netBase,
        totalCommission,
        averageCommissionRate,
        totalOrders,
        byCurrency
      },
      // Guardamos el CSV original para poder descargarlo tal cual en el reporte
      originalCsv: csvContent,
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

// Función para procesar comparación por excedente (ShoesF, SHOPLAMP, etc.)
async function processShoesFComparison(
  filePreviousYear: File,
  fileCurrentYear: File,
  client: any,
  supabase: any,
  commissionRateOverride = 0.03
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

    // Helper: calcular base neta de una fila con formato Amazon (Transaction Type + OUR_PRICE/SHIPPING Tax Exclusive)
    const getAmazonLineNetBase = (row: Record<string, any>) => {
      const transactionType = String(
        getVal(row, ['Transaction Type', 'transaction_type', /Transaction.*Type/i]) || ''
      ).toUpperCase()
      const ourPrice = parseNum(
        getVal(row, ['OUR_PRICE Tax Exclusive Selling Price', /OUR_PRICE.*Tax Exclusive Selling Price/i])
      )
      const shippingPrice = parseNum(
        getVal(row, ['SHIPPING Tax Exclusive Selling Price', /SHIPPING.*Tax Exclusive Selling Price/i])
      )
      const lineAmount = ourPrice + shippingPrice
      const lineAmountAbs = Math.abs(lineAmount)
      if (transactionType === 'SHIPMENT') {
        return { grossSales: lineAmountAbs, refunds: 0, netBase: lineAmountAbs }
      }
      if (transactionType === 'RETURN' || transactionType === 'REFUND') {
        return { grossSales: 0, refunds: lineAmountAbs, netBase: -lineAmountAbs }
      }
      return null // otros tipos se ignoran
    }

    // Procesar año anterior: mismo formato Amazon (Transaction Type, OUR_PRICE/SHIPPING Tax Exclusive)
    const previousYearData = new Map<string, { netBase: number, grossSales: number, refunds: number }>()
    let previousYearNetBase = 0
    const errors: string[] = []

    for (let i = 0; i < rowsPrevious.length; i++) {
      const row = rowsPrevious[i]
      try {
        const line = getAmazonLineNetBase(row)
        if (line === null) continue

        const asin = String(getVal(row, ['ASIN', 'asin', 'Asin', /^\s*ASIN\s*$/i]) || 'N/A').trim() || 'N/A'
        const netBase = line.netBase

        const existing = previousYearData.get(asin) || { netBase: 0, grossSales: 0, refunds: 0 }
        previousYearData.set(asin, {
          netBase: existing.netBase + netBase,
          grossSales: existing.grossSales + line.grossSales,
          refunds: existing.refunds + line.refunds
        })

        previousYearNetBase += netBase
      } catch (error: any) {
        errors.push(`Fila ${i + 2} (Año Anterior): ${error.message || 'Error al procesar'}`)
      }
    }

    // Año actual: mismo formato Amazon
    let currentYearNetBase = 0
    const processedRows: CommissionRow[] = []

    for (let i = 0; i < rowsCurrent.length; i++) {
      const row = rowsCurrent[i]
      try {
        const line = getAmazonLineNetBase(row)
        if (line === null) continue

        const productTitle = getVal(row, [
          'Product',
          'Title',
          'Nombre',
          'Product Title',
          /Product.*Title/i,
          /Nombre.*Producto/i
        ]) || 'Sin nombre'
        // Para ShoesF mostramos SKU (identificador de producto en su CSV); ASIN se usa solo para agrupar año anterior
        const asinForGrouping = String(getVal(row, ['ASIN', 'asin', 'Asin', /^\s*ASIN\s*$/i]) || 'N/A').trim() || 'N/A'
        const skuForDisplay = String(getVal(row, ['SKU', 'sku', 'Sku', /^\s*SKU\s*$/i]) || '').trim() || asinForGrouping
        const orderId = getVal(row, ['Order ID', 'OrderId', 'Order', 'Pedido', /Order.*ID/i, /Pedido/i]) || undefined
        const date = getVal(row, ['Date', 'Fecha', 'Sale Date', 'Shipment Date', /Date/i, /Fecha/i]) || undefined
        const quantity = parseNum(getVal(row, ['Quantity', 'Cantidad', 'Qty', /Quantity/i, /Cantidad/i]))

        const netBase = line.netBase
        const grossSales = line.grossSales
        const refunds = line.refunds
        const realTurnover = grossSales - refunds

        currentYearNetBase += netBase

        const previousYearInfo = previousYearData.get(asinForGrouping) || { netBase: 0, grossSales: 0, refunds: 0 }

        processedRows.push({
          productTitle,
          asin: skuForDisplay, // En ShoesF la tabla muestra SKU en la columna correspondiente
          orderId,
          date,
          quantity,
          grossSales,
          refunds,
          realTurnover,
          iva: 0, // ya es tax exclusive
          netBase,
          commissionRate: 0,
          commission: 0,
          rowNumber: i + 2,
          previousYearNetBase: previousYearInfo.netBase,
          currentYearNetBase: netBase
        })
      } catch (error: any) {
        errors.push(`Fila ${i + 2} (Año Actual): ${error.message || 'Error al procesar'}`)
      }
    }

    // Calcular excedente (año actual - año anterior)
    const excessAmount = Math.max(0, currentYearNetBase - previousYearNetBase)

    // Calcular comisión: porcentaje sobre el excedente
    const commissionRate = commissionRateOverride
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

// Función para procesar DIRU/SAUSI con CSV y columna Net profit
async function processDIRUBenefits(
  file: File,
  client: any,
  supabase: any,
  benefitRateOverride?: number
) {
  try {
    // Leer el archivo CSV
    const csvContent = await file.text()
    const rows = parseCSV(csvContent)

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'El archivo CSV está vacío o no es válido' },
        { status: 400 }
      )
    }

    // Buscar la columna "Net profit" en el CSV
    const benefitColumnKeys = [
      'net profit',      // Prioridad 1: Nombre exacto
      'netprofit',       // Sin espacio
      'beneficios netos',
      'net benefits'
    ]

    let totalBenefits = 0
    const errors: string[] = []
    const processedRows: CommissionRow[] = []

    // Buscar la columna "Net profit" usando getVal (que ya maneja case insensitive y variaciones)
    let benefitKey: string | null = null
    
    // Buscar en la primera fila (headers)
    if (rows.length > 0) {
      const firstRow = rows[0]
      // Intentar encontrar la columna usando getVal
      const netProfitValue = getVal(firstRow, [
        'Net profit',
        'Net Profit',
        'NET PROFIT',
        'net profit',
        'netprofit',
        'NetProfit'
      ])
      
      // Si encontramos un valor, buscar la clave original
      if (netProfitValue !== undefined && netProfitValue !== null && netProfitValue !== '') {
        // Buscar la clave que contiene "net profit"
        for (const key of Object.keys(firstRow)) {
          const normalizedKey = key.toLowerCase().trim()
          if (normalizedKey === 'net profit' || normalizedKey === 'netprofit') {
            benefitKey = key
            break
          }
        }
      }
      
      // Si no se encontró, buscar cualquier columna que contenga "net profit"
      if (!benefitKey) {
        for (const key of Object.keys(firstRow)) {
          const normalizedKey = key.toLowerCase().trim()
          if (benefitColumnKeys.some(bc => normalizedKey.includes(bc))) {
            benefitKey = key
            break
          }
        }
      }
    }

    if (!benefitKey) {
      return NextResponse.json(
        { error: 'No se encontró la columna "Net profit" en el archivo CSV. Por favor, asegúrate de que existe una columna con ese nombre.' },
        { status: 400 }
      )
    }

    // Sumar los valores de la columna "Net profit" (incluyendo negativos)
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const benefitValue = parseNum(getVal(row, [benefitKey]))
      
      if (!isNaN(benefitValue)) {
        // Sumar el valor (si es negativo, se restará automáticamente)
        totalBenefits += benefitValue

        // Extraer datos adicionales del CSV
        const productTitle = getVal(row, [
          'Product',
          'Producto',
          'Title',
          'Nombre',
          'Product Title',
          /Product.*Title/i,
          /Nombre.*Producto/i
        ]) || `Fila ${i + 2}`

        const asin = getVal(row, [
          'ASIN',
          'asin',
          'Asin'
        ]) || 'N/A'

        const sku = getVal(row, [
          'SKU',
          'sku',
          'Sku'
        ]) || undefined

        const units = parseNum(getVal(row, [
          'Units',
          'units',
          'Unidades',
          'Cantidad',
          'Quantity',
          /Units/i,
          /Unidades/i,
          /Cantidad/i
        ])) || undefined

        const refunds = Math.abs(parseNum(getVal(row, [
          'Refunds',
          'refunds',
          'Reembolsos',
          'Refund',
          /Refunds/i,
          /Reembolsos/i
        ]))) || 0

        // Intentar obtener ventas del CSV si existe la columna
        const grossSales = parseNum(
          getVal(row, ['Sales', 'Ventas', /Sales/i, /Ventas/i, 'Gross Sales', /Gross.*Sales/i])
        ) || 0

        // Calcular realTurnover y iva si tenemos ventas
        const realTurnover = grossSales > 0 ? grossSales - refunds : 0
        const iva = realTurnover > 0 ? realTurnover - (realTurnover / 1.21) : 0

        // Crear una fila para el reporte
        processedRows.push({
          productTitle,
          asin,
          orderId: sku, // Usamos SKU como orderId para mostrarlo en la tabla
          date: undefined,
          quantity: units,
          grossSales,
          refunds,
          realTurnover,
          iva,
          netBase: benefitValue, // Valor individual de Net profit
          commissionRate: benefitRateOverride ?? client.base_commission_rate,
          commission: benefitValue * (benefitRateOverride ?? client.base_commission_rate),
          rowNumber: i + 2
        })
      } else {
        const rawValue = getVal(row, [benefitKey])
        if (rawValue !== undefined && rawValue !== null && rawValue !== '') {
          errors.push(`Fila ${i + 2}: Valor no numérico en Net profit: ${rawValue}`)
        }
      }
    }

    // Calcular comisión usando la tasa base del cliente sobre la suma total de "Net profit"
    // Nota: totalBenefits ya incluye la suma de todos los valores (positivos y negativos)
    // Los negativos se restan automáticamente al sumar
    const commissionRate = benefitRateOverride ?? client.base_commission_rate
    const totalCommission = totalBenefits * commissionRate

    // Calcular totales de ventas, reembolsos, etc. si están disponibles
    const totalSales = processedRows.reduce((sum, r) => sum + r.grossSales, 0)
    const totalRefunds = processedRows.reduce((sum, r) => sum + r.refunds, 0)
    const realTurnover = totalSales - totalRefunds
    const totalIva = processedRows.reduce((sum, r) => sum + r.iva, 0)

    // Crear resultado
    const result: CommissionCalculationData = {
      summary: {
        totalSales,
        totalRefunds,
        realTurnover,
        totalIva,
        netBase: totalBenefits, // Total de beneficios
        totalCommission,
        averageCommissionRate: commissionRate,
        totalOrders: processedRows.length,
        // Datos específicos de DIRU/SAUSI
        totalBenefits
      },
      rows: processedRows,
      errors
    }

    return NextResponse.json({
      success: true,
      data: result
    })
  } catch (error: any) {
    console.error('Error processing DIRU benefits:', error)
    return NextResponse.json(
      { error: 'Error al procesar el archivo CSV de beneficios', details: error.message },
      { status: 500 }
    )
  }
}

