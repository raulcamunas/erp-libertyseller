import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/auth/api'
import { parseCSV, parseNum, getVal } from '@/lib/utils/csv-parser'
import { CommissionCalculationData, CommissionRow } from '@/lib/types/commissions'
import * as XLSX from 'xlsx'
import { comprobarTamañoPeticion, comprobarTamañoFichero } from '@/lib/subidas-limite'

export async function POST(request: NextRequest) {
  try {
    // QUÉ IMPIDE: que esta ruta le conteste a cualquiera de internet. No
    // comprobaba nada, y middleware.ts (línea 41) declara pública toda /api/,
    // así que bastaba un curl SIN cookie para dispararla. Ver lib/auth/api.ts,
    // donde está reproducido con el curl exacto.
    //
    // Lee la tabla `clients` y `commission_exceptions` de la agencia y devuelve
    // el cálculo de comisiones de un cliente. La llaman
    // components/commissions/CommissionsCalculator.tsx y su gemela de Shoes F,
    // las dos con sesión.
    //
    // Se pide SESIÓN y nada más —ni rol ni permiso de módulo— a propósito: hoy
    // esta pantalla la abre cualquiera con sesión, y exigir un permiso que hoy
    // no se exige dejaría fuera a alguien que trabaja.
    const sesion = await requireSession()
    if (sesion instanceof NextResponse) return sesion

    // Tope de bytes ANTES de formData(): formData() bufferiza el cuerpo entero.
    // Sin esto, una subida sin sesión de 60 MB entraba tal cual y 4 a la vez
    // dejaban el proceso en 874 MB de RSS. Ver lib/subidas-limite.ts.
    const demasiado = comprobarTamañoPeticion(request)
    if (demasiado) return demasiado

    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const filePreviousYear = formData.get('filePreviousYear') as File | null
    const fileCurrentYear = formData.get('fileCurrentYear') as File | null

    // Segundo filtro, por si el cuerpo vino sin Content-Length (chunked).
    for (const [fichero, etiqueta] of [
      [file, 'El fichero de comisiones'],
      [filePreviousYear, 'El fichero del año anterior'],
      [fileCurrentYear, 'El fichero del año actual'],
    ] as const) {
      const grande = comprobarTamañoFichero(fichero, etiqueta)
      if (grande) return grande
    }
    const clientId = formData.get('clientId') as string
    const manualCommissionRateRaw = formData.get('manualCommissionRate') as string | null

    // Obtener cliente para determinar tipo de cálculo
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

    const isShoesF = client.name === 'ShoesF' || client.name === 'Farmacia Garrachon'
    /**
     * Keslem compara dos años como ShoesF, pero PARTIENDO POR MARCA: 4 % sobre el
     * excedente de su marca propia y 2 % sobre el de arbitraje. Lo que decide de
     * qué marca es cada ASIN sale del catálogo del cliente —migración 173—,
     * porque el informe de impuestos no trae ni título ni marca.
     */
    const isPorMarca = Boolean(client.marca_propia && client.tasa_marca_propia != null)
    const isShoplamp = client.name === 'SHOPLAMP'
    const isDIRU = client.name === 'DIRU'
    const isSAUSI = client.name === 'SAUSI'
    const isCreativeToys = client.name === 'Creative Toys'
    const isLenobotics = client.name === 'Lenobotics'
    const isHamMasterSecondary = client.name === 'HamMaster Cuenta secundaria'
    // Sistema anterior: Sales + Refund Cost, base neta = facturación real / 1.21
    const useOldCalculation = isCreativeToys || isLenobotics
    /**
     * COBRAR SOBRE EL BENEFICIO EN VEZ DE SOBRE LA FACTURACIÓN.
     *
     * DIRU y SAUSI se siguen decidiendo por su nombre porque así estaba escrito
     * y funciona. Lo nuevo es `modo_calculo` (migración 177), que es un dato de
     * la fila: con él, dar de alta a otro cliente con este trato ya no obliga a
     * tocar el código.
     *
     * Creative Toys entra por aquí: 7,5 % del beneficio neto.
     */
    const modoBeneficio = client.modo_calculo === 'beneficio'
    const isBenefitsClient = isDIRU || isSAUSI || modoBeneficio // Clientes que usan Net profit

    const hamMasterSecondaryAsins = new Set<string>([
      'B0GTQMWRB9',
      'B0GTQG2K71',
      'B0FXBQZMGR',
      'B0G3X5J6YS',
      'B0GTQBLRXV',
      'B0GTQSM693',
      'B0GT9PYT21',
      'B0FN4XNGFB',
      'B0FNN9GYN8',
      'B0FMKMFM2Z',
      'B0FN4MT7VP',
      'B0FMYT6Y9H',
      'B0FMYXBBDD',
      'B0FMS4L1QR',
      'B0FN12R76R',
      'B0FN4RG69J',
      'B0FN4TDYWF',
      'B0FMYWHRNY',
      'B0FMT1WLGG',
      'B0FMZWMBQN',
      'B0FN4QGFWQ',
      'B0FN4XV6VX',
      'B0FMZRS9JS',
      'B0FMS6N5L8',
      'B0FMZWK26K',
      'B0FN4T7B8N',
      'B0FN56TGD5',
      'B0FY7L1P8Y',
      'B0FY7H6L8P',
      'B0FMYM6J6R',
      'B0FY7KHGP9'
    ])

    // Validar archivos según el tipo de cliente.
    // `isPorMarca` va con `isShoesF` porque también compara dos años: sin esto
    // caía en el «else» de un solo fichero y contestaba «Archivo y cliente son
    // requeridos» teniendo los dos delante.
    if (isShoesF || isPorMarca) {
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
      // Sellerboard deja bajar el mismo informe en CSV y en XLSX, y se usan
      // los dos. Rechazar el XLSX obligaba a abrirlo y volver a guardarlo.
      const nombre = file.name.toLowerCase()
      const aceptado = ['.csv', '.xlsx', '.xls'].some((ext) => nombre.endsWith(ext))
      if (!aceptado) {
        return NextResponse.json(
          { error: `${client.name} necesita el informe de Sellerboard en CSV o XLSX` },
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

    // Keslem y cualquier otro con dos tasas por marca
    if (isPorMarca) {
      if (!filePreviousYear || !fileCurrentYear) {
        return NextResponse.json(
          { error: 'Hacen falta los dos informes: el del año anterior y el del actual.' },
          { status: 400 }
        )
      }
      return await processPorMarca(filePreviousYear, fileCurrentYear, client, supabase)
    }

    // Si es ShoesF, procesar comparación entre años (dos CSV)
    if (isShoesF) {
      const defaultCommissionRate = client.base_commission_rate

      const parsedManual = manualCommissionRateRaw ? parseFloat(manualCommissionRateRaw) : NaN
      // manualCommissionRate llega como porcentaje (ej: "3" -> 0.03)
      const manualCommissionRate = Number.isFinite(parsedManual) ? parsedManual / 100 : undefined
      const commissionRate =
        manualCommissionRate !== undefined && manualCommissionRate >= 0
          ? manualCommissionRate
          : defaultCommissionRate

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

        if (isHamMasterSecondary) {
          const asinKey = String(asin).trim().toUpperCase()
          if (!hamMasterSecondaryAsins.has(asinKey)) {
            continue
          }
        }

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

        if (isHamMasterSecondary) {
          commissionRate = 0.05
        }

        // Buscar excepciones por keyword (case insensitive)
        // IMPORTANTE: Las excepciones tienen prioridad sobre la tasa base
        if (!isHamMasterSecondary && exceptions && exceptions.length > 0) {
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
    /**
     * LA BASE NO ES LA MISMA EN LAS DOS LÓGICAS, Y EL RESUMEN LO DABA IGUAL.
     *
     * En la lógica de Amazon los importes ya vienen sin IVA, así que la base es
     * la facturación tal cual. En la antigua (Sellerboard) vienen CON IVA y hay
     * que quitarlo, que es lo que ya hace cada fila al dividir entre 1,21.
     *
     * El resumen no lo hacía: ponía `netBase = realTurnover` para todos. La
     * COMISIÓN salía bien —se suma fila a fila— pero las tres cifras que ve el
     * cliente en el desglose no. Con el informe de noviembre de 2025 de Creative
     * Toys enseñaba «Base Neta (SIN IVA) 19.766,30 €» llevando el IVA dentro,
     * «IVA 0,00» y una tasa media del 4,13 % sobre un trato del 5 %. Y los
     * números no cuadraban entre sí: 19.766,30 x 5 % son 988,32, no los 816,79
     * que ponía debajo.
     */
    const netBase = useOldCalculation ? realTurnover / 1.21 : realTurnover
    const totalIva = useOldCalculation ? (realTurnover - netBase) : totalIvaAmazon
    let totalCommission = processedRows.reduce((sum, r) => sum + r.commission, 0)

    // SHOPLAMP: comisión sobre excedente respecto al baseline mensual de €3.500
    const shoplampBaseline = 3500
    let shoplampExcess: number | undefined
    if (isShoplamp) {
      shoplampExcess = Math.max(0, netBase - shoplampBaseline)
      totalCommission = shoplampExcess * client.base_commission_rate
      // Parchear byCurrency para que la comisión refleje el total real, no la suma por fila
      if (byCurrencyAgg.size > 0) {
        const entries = Array.from(byCurrencyAgg.entries())
        // Asignar toda la comisión a la única moneda (EUR normalmente)
        for (const [key, val] of entries) {
          val.commission = totalCommission
          byCurrencyAgg.set(key, val)
        }
      }
    }

    if (!useOldCalculation && processedRows.length === 0) {
      return NextResponse.json(
        {
          error: isHamMasterSecondary
            ? 'El CSV no contiene transacciones para los ASIN configurados en HamMaster Cuenta secundaria.'
            : 'No se han detectado transacciones procesables en el CSV. Revisa que el archivo sea de Amazon Tax Document Library y contenga las columnas: Transaction Type, Currency, OUR_PRICE Tax Exclusive Selling Price, SHIPPING Tax Exclusive Selling Price, OUR_PRICE Tax Exclusive Promo Amount y OUR_PRICE Tax Amount.'
        },
        { status: 400 }
      )
    }
    
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
        byCurrency,
        ...(isShoplamp && {
          baselineAmount: shoplampBaseline,
          excessAmount: shoplampExcess,
        }),
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

/**
 * COMISIÓN PARTIDA POR MARCA, SOBRE EL EXCEDENTE DE DOS AÑOS.
 *
 * El trato de Keslem: 2 % sobre el excedente de facturación en marcas de
 * terceros (arbitraje) y 4 % sobre el de su marca propia. Se comparan dos
 * informes de impuestos —el mismo periodo de dos años— y se calcula sobre la
 * diferencia.
 *
 *
 * ============ CADA MARCA CON SU PROPIO EXCEDENTE ============
 *
 * NO se calcula el excedente total y luego se reparte: se calcula el excedente
 * de marca propia y el de terceros por separado, y cada uno lleva su tasa. Es lo
 * que dice el trato y no da el mismo número: si la marca propia baja y la de
 * terceros sube, repartir el total mezclaría una pérdida con una ganancia y
 * saldría una comisión que nadie ha pactado.
 *
 * Un excedente negativo no resta: comisión cero para esa marca. Un año peor no
 * genera deuda del cliente hacia la agencia.
 *
 *
 * ============ LO QUE NO SE PUEDE UBICAR SE DICE, NO SE REPARTE ============
 *
 * Un ASIN que no está en el catálogo no se sabe de qué marca es —suele ser un
 * producto retirado que ya no sale en el informe de listados—. Repartirlo «a
 * ojo» o meterlo en terceros porque son mayoría cambia el importe sin que nadie
 * lo sepa. Se deja fuera del cálculo y se devuelve aparte, con su importe, para
 * que quien factura decida.
 */
async function processPorMarca(
  filePreviousYear: File,
  fileCurrentYear: File,
  client: any,
  supabase: any
) {
  try {
    const rowsPrevious = parseCSV(await filePreviousYear.text())
    const rowsCurrent = parseCSV(await fileCurrentYear.text())

    if (rowsPrevious.length === 0 || rowsCurrent.length === 0) {
      return NextResponse.json(
        { error: 'Uno de los dos informes está vacío o no se ha podido leer' },
        { status: 400 }
      )
    }

    // ---------- El catálogo del cliente ----------
    const catalogo = new Map<string, { propia: boolean; nombre: string | null }>()
    for (let desde = 0; ; desde += 1000) {
      const { data, error } = await supabase
        .from('commission_catalog')
        .select('asin, item_name, es_marca_propia')
        .eq('client_id', client.id)
        .order('asin')
        .range(desde, desde + 999)
      if (error) break
      const trozo = (data ?? []) as { asin: string; item_name: string | null; es_marca_propia: boolean }[]
      for (const c of trozo) catalogo.set(c.asin, { propia: c.es_marca_propia, nombre: c.item_name })
      if (trozo.length < 1000) break
    }

    if (catalogo.size === 0) {
      return NextResponse.json(
        {
          error:
            `Todavía no hay catálogo de ${client.name}. Sube primero su «Informe de todos los ` +
            'listados» de Seller Central: sin él no se puede saber qué ventas son de marca propia ' +
            'y cuáles de arbitraje, que es lo que decide si la comisión es del ' +
            `${(client.tasa_marca_propia * 100).toFixed(0)} % o del ` +
            `${(client.base_commission_rate * 100).toFixed(0)} %.`,
        },
        { status: 400 }
      )
    }

    // ---------- Sumar, separando por marca ----------
    const cubo = () => ({ propia: 0, terceros: 0, sinUbicar: 0 })
    const anterior = cubo()
    const actual = cubo()
    const asinSinUbicar = new Map<string, number>()

    const sumar = (rows: Record<string, any>[], acc: ReturnType<typeof cubo>) => {
      for (const row of rows) {
        const tipo = String(
          getVal(row, ['Transaction Type', 'transaction_type', /Transaction.*Type/i]) || ''
        ).toUpperCase()

        const ourPrice = parseNum(
          getVal(row, ['OUR_PRICE Tax Exclusive Selling Price', /OUR_PRICE.*Tax Exclusive Selling Price/i])
        )
        const shipping = parseNum(
          getVal(row, ['SHIPPING Tax Exclusive Selling Price', /SHIPPING.*Tax Exclusive Selling Price/i])
        )
        const importe = Math.abs(ourPrice + shipping)

        // Solo ventas y devoluciones. El resto de tipos —donaciones, ajustes— no
        // son facturación del cliente y no entran en el excedente.
        let neto = 0
        if (tipo === 'SHIPMENT') neto = importe
        else if (tipo === 'RETURN' || tipo === 'REFUND') neto = -importe
        else continue

        const asin = String(getVal(row, ['ASIN', 'asin', /^asin$/i]) || '').trim()
        const ficha = asin ? catalogo.get(asin) : undefined

        if (!ficha) {
          acc.sinUbicar += neto
          if (asin) asinSinUbicar.set(asin, (asinSinUbicar.get(asin) ?? 0) + neto)
        } else if (ficha.propia) {
          acc.propia += neto
        } else {
          acc.terceros += neto
        }
      }
    }

    sumar(rowsPrevious, anterior)
    sumar(rowsCurrent, actual)

    const tasaPropia = Number(client.tasa_marca_propia)
    const tasaTerceros = Number(client.base_commission_rate)

    const excedentePropia = actual.propia - anterior.propia
    const excedenteTerceros = actual.terceros - anterior.terceros
    const comisionPropia = Math.max(0, excedentePropia) * tasaPropia
    const comisionTerceros = Math.max(0, excedenteTerceros) * tasaTerceros

    const sinUbicar = [...asinSinUbicar.entries()]
      .map(([asin, importe]) => ({ asin, importe: Math.round(importe * 100) / 100 }))
      .sort((a, b) => Math.abs(b.importe) - Math.abs(a.importe))

    /**
     * ENVUELTO EN `data`, COMO EL RESTO.
     *
     * La pantalla hace `setResult(data.data)`. Devolviendo los campos al primer
     * nivel, `result` quedaba en undefined: el botón no daba error, no pintaba
     * nada, y desde fuera parecía que no hacía nada al pulsarlo. La forma de la
     * respuesta la manda quien la consume.
     */
    return NextResponse.json({
      success: true,
      data: {
      modo: 'por_marca',
      cliente: client.name,
      marca: client.marca_propia,
      catalogoReferencias: catalogo.size,
      bloques: [
        {
          etiqueta: `Marca propia (${client.marca_propia})`,
          anterior: Math.round(anterior.propia * 100) / 100,
          actual: Math.round(actual.propia * 100) / 100,
          excedente: Math.round(excedentePropia * 100) / 100,
          tasa: tasaPropia,
          comision: Math.round(comisionPropia * 100) / 100,
        },
        {
          etiqueta: 'Terceros (arbitraje)',
          anterior: Math.round(anterior.terceros * 100) / 100,
          actual: Math.round(actual.terceros * 100) / 100,
          excedente: Math.round(excedenteTerceros * 100) / 100,
          tasa: tasaTerceros,
          comision: Math.round(comisionTerceros * 100) / 100,
        },
      ],
      sinUbicar: {
        anterior: Math.round(anterior.sinUbicar * 100) / 100,
        actual: Math.round(actual.sinUbicar * 100) / 100,
        referencias: sinUbicar.slice(0, 25),
        total: sinUbicar.length,
      },
      totalComision: Math.round((comisionPropia + comisionTerceros) * 100) / 100,
      },
    })
  } catch (error: any) {
    console.error('Error en el cálculo por marca:', error)
    return NextResponse.json(
      { error: error?.message || 'No se ha podido calcular' },
      { status: 500 }
    )
  }
}

// Función para procesar comparación por excedente entre dos años (ShoesF)
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

      const ourPrice = parseNum(getVal(row, ['OUR_PRICE Tax Exclusive Selling Price', /OUR_PRICE.*Tax Exclusive Selling Price/i]))
      const shippingPrice = parseNum(getVal(row, ['SHIPPING Tax Exclusive Selling Price', /SHIPPING.*Tax Exclusive Selling Price/i]))

      const lineAmount = ourPrice + shippingPrice
      const lineAmountAbs = Math.abs(lineAmount)
      const ourAbs = Math.abs(ourPrice)
      const shippingAbs = Math.abs(shippingPrice)

      if (transactionType === 'SHIPMENT') {
        return {
          grossSales: lineAmountAbs,
          refunds: 0,
          netBase: lineAmountAbs,
          grossProduct: ourAbs,
          grossShipping: shippingAbs,
          refundsProduct: 0,
          refundsShipping: 0,
          baseProductNet: ourAbs,
          baseShippingNet: shippingAbs,
        }
      }
      if (transactionType === 'RETURN' || transactionType === 'REFUND') {
        return {
          grossSales: 0,
          refunds: lineAmountAbs,
          netBase: -lineAmountAbs,
          grossProduct: 0,
          grossShipping: 0,
          refundsProduct: ourAbs,
          refundsShipping: shippingAbs,
          baseProductNet: -ourAbs,
          baseShippingNet: -shippingAbs,
        }
      }
      return null // otros tipos se ignoran
    }

    const getJurisdiction = (row: Record<string, any>) => {
      const v = getVal(row, ['Jurisdiction Name', 'jurisdiction name', /jurisdiction\s*name/i])
      const s = String(v || '').trim()
      return s || 'N/A'
    }

    const includedTransactionTypes: Record<string, number> = {}
    const excludedTransactionTypes: Record<string, number> = {}
    const byJurisdictionAgg = new Map<string, { jurisdiction: string; previousYearNetBase: number; currentYearNetBase: number }>()

    const previousYearBreakdown = {
      grossProduct: 0,
      grossShipping: 0,
      refundsProduct: 0,
      refundsShipping: 0,
      baseProductNet: 0,
      baseShippingNet: 0,
    }

    const currentYearBreakdown = {
      grossProduct: 0,
      grossShipping: 0,
      refundsProduct: 0,
      refundsShipping: 0,
      baseProductNet: 0,
      baseShippingNet: 0,
    }

    // Procesar año anterior: mismo formato Amazon (Transaction Type, OUR_PRICE/SHIPPING Tax Exclusive)
    const previousYearData = new Map<string, { netBase: number, grossSales: number, refunds: number }>()
    let previousYearNetBase = 0
    const errors: string[] = []

    for (let i = 0; i < rowsPrevious.length; i++) {
      const row = rowsPrevious[i]
      try {
        const transactionType = String(
          getVal(row, ['Transaction Type', 'transaction_type', /Transaction.*Type/i]) || ''
        ).toUpperCase()
        const line = getAmazonLineNetBase(row)
        if (line === null) {
          excludedTransactionTypes[transactionType || 'UNKNOWN'] = (excludedTransactionTypes[transactionType || 'UNKNOWN'] || 0) + 1
          continue
        }
        includedTransactionTypes[transactionType || 'UNKNOWN'] = (includedTransactionTypes[transactionType || 'UNKNOWN'] || 0) + 1

        const asin = String(getVal(row, ['ASIN', 'asin', 'Asin', /^\s*ASIN\s*$/i]) || 'N/A').trim() || 'N/A'
        const netBase = line.netBase
        const jurisdiction = getJurisdiction(row)

        const existing = previousYearData.get(asin) || { netBase: 0, grossSales: 0, refunds: 0 }
        previousYearData.set(asin, {
          netBase: existing.netBase + netBase,
          grossSales: existing.grossSales + line.grossSales,
          refunds: existing.refunds + line.refunds
        })

        previousYearNetBase += netBase

        previousYearBreakdown.grossProduct += line.grossProduct || 0
        previousYearBreakdown.grossShipping += line.grossShipping || 0
        previousYearBreakdown.refundsProduct += line.refundsProduct || 0
        previousYearBreakdown.refundsShipping += line.refundsShipping || 0
        previousYearBreakdown.baseProductNet += line.baseProductNet || 0
        previousYearBreakdown.baseShippingNet += line.baseShippingNet || 0

        const j = byJurisdictionAgg.get(jurisdiction) || {
          jurisdiction,
          previousYearNetBase: 0,
          currentYearNetBase: 0,
        }
        j.previousYearNetBase += netBase
        byJurisdictionAgg.set(jurisdiction, j)
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
        const transactionType = String(
          getVal(row, ['Transaction Type', 'transaction_type', /Transaction.*Type/i]) || ''
        ).toUpperCase()
        const line = getAmazonLineNetBase(row)
        if (line === null) {
          excludedTransactionTypes[transactionType || 'UNKNOWN'] = (excludedTransactionTypes[transactionType || 'UNKNOWN'] || 0) + 1
          continue
        }
        includedTransactionTypes[transactionType || 'UNKNOWN'] = (includedTransactionTypes[transactionType || 'UNKNOWN'] || 0) + 1

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
        const jurisdiction = getJurisdiction(row)

        currentYearNetBase += netBase

        currentYearBreakdown.grossProduct += line.grossProduct || 0
        currentYearBreakdown.grossShipping += line.grossShipping || 0
        currentYearBreakdown.refundsProduct += line.refundsProduct || 0
        currentYearBreakdown.refundsShipping += line.refundsShipping || 0
        currentYearBreakdown.baseProductNet += line.baseProductNet || 0
        currentYearBreakdown.baseShippingNet += line.baseShippingNet || 0

        const previousYearInfo = previousYearData.get(asinForGrouping) || { netBase: 0, grossSales: 0, refunds: 0 }

        const j = byJurisdictionAgg.get(jurisdiction) || {
          jurisdiction,
          previousYearNetBase: 0,
          currentYearNetBase: 0,
        }
        j.currentYearNetBase += netBase
        byJurisdictionAgg.set(jurisdiction, j)

        processedRows.push({
          productTitle,
          asin: skuForDisplay, // En ShoesF la tabla muestra SKU en la columna correspondiente
          orderId,
          date,
          quantity,
          jurisdiction,
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

    const byJurisdiction: Record<string, { jurisdiction: string; previousYearNetBase: number; currentYearNetBase: number; excessAmount: number }> = {}
    for (const [key, v] of byJurisdictionAgg.entries()) {
      const prev = v.previousYearNetBase
      const cur = v.currentYearNetBase
      byJurisdiction[key] = {
        jurisdiction: v.jurisdiction,
        previousYearNetBase: prev,
        currentYearNetBase: cur,
        excessAmount: Math.max(0, cur - prev),
      }
    }

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
        excessAmount,
        commissionRateUsed: commissionRate,
        byJurisdiction,
        calculationBreakdown: {
          includedTransactionTypes,
          excludedTransactionTypes,
          previousYear: {
            grossSales: Array.from(previousYearData.values()).reduce((s, x) => s + x.grossSales, 0),
            refunds: Array.from(previousYearData.values()).reduce((s, x) => s + x.refunds, 0),
            netBase: previousYearNetBase,
            grossProduct: previousYearBreakdown.grossProduct,
            grossShipping: previousYearBreakdown.grossShipping,
            refundsProduct: previousYearBreakdown.refundsProduct,
            refundsShipping: previousYearBreakdown.refundsShipping,
            baseProductNet: previousYearBreakdown.baseProductNet,
            baseShippingNet: previousYearBreakdown.baseShippingNet,
          },
          currentYear: {
            grossSales: totalSales,
            refunds: totalRefunds,
            netBase: currentYearNetBase,
            grossProduct: currentYearBreakdown.grossProduct,
            grossShipping: currentYearBreakdown.grossShipping,
            refundsProduct: currentYearBreakdown.refundsProduct,
            refundsShipping: currentYearBreakdown.refundsShipping,
            baseProductNet: currentYearBreakdown.baseProductNet,
            baseShippingNet: currentYearBreakdown.baseShippingNet,
          },
          formula: {
            excessAmount,
            commissionRate,
            totalCommission,
          },
        },
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

/**
 * COMISIÓN SOBRE EL BENEFICIO, NO SOBRE LA FACTURACIÓN.
 *
 * Lee el «Tablero de Productos» de Sellerboard y calcula la comisión sobre la
 * suma de su columna «Net profit». Lo usan DIRU, SAUSI y —desde la migración
 * 177— Creative Toys, con un 7,5 %.
 *
 *
 * ============ POR QUÉ EL INFORME DE PRODUCTOS Y NO EL PANEL ============
 *
 * La cuenta se venía haciendo a mano copiando dos cifras del panel de
 * Sellerboard: las ganancias del mes y el gasto de Vine, que se restaba. Con
 * julio de 2026: (3.959,12 - 969,52) x 7,5 % = 224,22 €.
 *
 * Este fichero llega al mismo sitio solo: su «Net profit» suma 2.975,64, que da
 * 223,17 € — un 0,47 % de diferencia. Y no es casualidad: el gasto de Vine es
 * de CUENTA y no de producto, así que el informe de productos YA VIENE SIN ÉL.
 * La resta que se hacía a mano la hace el propio fichero.
 *
 * Lo que se gana es que el número deja de depender de que alguien mire la
 * pantalla correcta y reste la casilla correcta. En julio no se restó: se
 * facturaron 296,93 € en vez de 224,22 €.
 *
 *
 * ============ LOS COSTES VIENEN EN NEGATIVO ============
 *
 * Sellerboard da «Amazon fees» y «Cost of Goods» con el signo puesto (-7.075,00).
 * Se guardan en positivo porque en el desglose se leen como lo que son —lo que
 * se va—, y el beneficio no se recalcula a partir de ellos: se coge «Net profit»
 * tal cual. Rehacer la resta aquí daría un número distinto del que ve el cliente
 * en su propio Sellerboard, que es la referencia que él tiene.
 */
async function processDIRUBenefits(
  file: File,
  client: any,
  supabase: any,
  benefitRateOverride?: number
) {
  try {
    const rows = await leerInforme(file)

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'El informe está vacío o no se ha podido leer' },
        { status: 400 }
      )
    }

    // ---------- Encontrar la columna del beneficio ----------
    // Se busca sobre las CLAVES, no sobre el valor de la primera fila: si el
    // primer producto tuviera el beneficio a 0 o en blanco, buscar por valor no
    // encontraba la columna y el informe entero se rechazaba.
    const claves = Object.keys(rows[0])
    const normaliza = (k: string) => k.toLowerCase().trim().replace(/\s+/g, ' ')

    let benefitKey: string | null =
      claves.find((k) => ['net profit', 'netprofit'].includes(normaliza(k))) ?? null

    if (!benefitKey) {
      benefitKey =
        claves.find((k) =>
          ['net profit', 'netprofit', 'beneficios netos', 'net benefits', 'beneficio neto'].some(
            (c) => normaliza(k).includes(c)
          )
        ) ?? null
    }

    if (!benefitKey) {
      return NextResponse.json(
        {
          error:
            'No se encuentra la columna «Net profit» en el informe. Tiene que ser el Tablero de ' +
            'Productos de Sellerboard, que la trae. Columnas encontradas: ' +
            claves.slice(0, 12).join(', '),
        },
        { status: 400 }
      )
    }

    const commissionRate = benefitRateOverride ?? client.base_commission_rate

    const processedRows: CommissionRow[] = []
    const errors: string[] = []
    let totalBenefits = 0

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]

      const productTitle =
        getVal(row, ['Product', 'Producto', 'Title', 'Nombre', /Product.*Title/i]) || `Fila ${i + 2}`
      const asin = getVal(row, ['ASIN', 'asin', 'Asin']) || 'N/A'
      const sku = getVal(row, ['SKU', 'sku', 'Sku']) || undefined

      // Una fila sin ASIN ni producto no es un producto: Sellerboard mete al
      // final filas de totales y separadores, y sumarlas duplicaría el mes.
      const esProducto = String(asin).trim() !== 'N/A' || String(productTitle).trim() !== ''
      if (!esProducto) continue

      const netProfit = parseNum(getVal(row, [benefitKey]))
      totalBenefits += netProfit

      const grossSales = parseNum(
        getVal(row, ['Sales', 'Ventas', /^Sales$/i, /Ventas/i, 'Gross Sales'])
      )
      /**
       * «Refunds» SON UNIDADES, NO EUROS.
       *
       * En el informe de Sellerboard `Refunds` es cuántas unidades se
       * devolvieron (46 en agosto) y el dinero está en `Refund cost`
       * (-719,32 €). Leyendo la primera, la pantalla enseñaba «Reembolsos
       * -46,00 €» y restaba ese 46 de las ventas para sacar la facturación
       * real: un número de unidades restado de un importe.
       *
       * Ojo con el nombre: Sellerboard escribe «Refund сost» con una С
       * CIRÍLICA (U+0441), no con la c latina. Por eso van las dos escrituras
       * y una expresión regular detrás — buscando solo 'Refund cost' no se
       * encuentra la columna y el importe se queda en cero sin avisar.
       */
      const refunds = Math.abs(
        parseNum(
          getVal(row, [
            'Refund cost',
            'Refund \u0441ost',
            'Coste reembolso',
            /Refund.*[Cc\u0441]ost/i,
            /Coste.*reembolso/i,
          ])
        )
      )
      /** Las unidades devueltas, que es lo que trae la columna «Refunds» */
      const unidadesDevueltas = parseNum(getVal(row, ['Refunds', /^Refunds$/i]))
      const costOfGoods = Math.abs(
        parseNum(getVal(row, ['Cost of Goods', 'COGS', /Cost.*Goods/i, /Coste.*producto/i]))
      )
      const amazonFees = Math.abs(
        parseNum(getVal(row, ['Amazon fees', /Amazon.*fees/i, /Tarifas.*Amazon/i]))
      )
      const adsSpend = Math.abs(
        parseNum(getVal(row, ['Ads', /^Ads$/i, 'Sponsored products (PPC)', /Sponsored products/i]))
      )
      const units =
        parseNum(getVal(row, ['Units', 'Unidades', 'Cantidad', 'Quantity', /^Units$/i])) || undefined

      const realTurnover = grossSales - refunds

      processedRows.push({
        productTitle,
        asin,
        orderId: sku,
        quantity: units,
        unitsRefunded: unidadesDevueltas || undefined,
        grossSales,
        refunds,
        realTurnover,
        // En este modo no se descuenta IVA: «Net profit» ya lo trae descontado.
        iva: 0,
        // `netBase` es la base sobre la que se cobra, y aquí esa base ES el
        // beneficio. Se rellena igual para que todo lo que ya suma netBase
        // —medias, agregados, la hoja de Excel que se descarga— siga cuadrando.
        netBase: netProfit,
        netProfit,
        costOfGoods,
        amazonFees,
        adsSpend,
        margin: grossSales > 0 ? netProfit / grossSales : undefined,
        commissionRate,
        commission: netProfit * commissionRate,
        rowNumber: i + 2,
      })
    }

    if (processedRows.length === 0) {
      return NextResponse.json(
        { error: 'El informe no trae ninguna fila de producto' },
        { status: 400 }
      )
    }

    /**
     * LA COMISIÓN SE CALCULA SOBRE EL TOTAL, NO SUMANDO LAS DE CADA FILA.
     *
     * No da lo mismo. Un producto con beneficio NEGATIVO —devoluciones, o
     * publicidad que se comió el margen— resta del total, y así es como se ha
     * facturado siempre. Sumar comisiones fila a fila daría el mismo número
     * aquí, pero deja la puerta abierta a que mañana alguien decida ignorar las
     * filas negativas y el cliente pague comisión por un mes en el que perdió
     * dinero en esos productos.
     */
    const totalCommission = totalBenefits * commissionRate

    const totalSales = processedRows.reduce((s, r) => s + r.grossSales, 0)
    const totalRefunds = processedRows.reduce((s, r) => s + r.refunds, 0)
    const totalCostOfGoods = processedRows.reduce((s, r) => s + (r.costOfGoods ?? 0), 0)
    const totalAmazonFees = processedRows.reduce((s, r) => s + (r.amazonFees ?? 0), 0)
    const totalAds = processedRows.reduce((s, r) => s + (r.adsSpend ?? 0), 0)

    const result: CommissionCalculationData = {
      summary: {
        totalSales,
        totalRefunds,
        realTurnover: totalSales - totalRefunds,
        totalIva: 0,
        netBase: totalBenefits,
        totalCommission,
        averageCommissionRate: commissionRate,
        commissionRateUsed: commissionRate,
        totalOrders: processedRows.length,
        totalBenefits,
        totalCostOfGoods,
        totalAmazonFees,
        totalAds,
        modoCalculo: 'beneficio',
      },
      rows: processedRows,
      errors,
    }

    return NextResponse.json({ success: true, data: result })
  } catch (error: any) {
    console.error('Error calculando la comisión sobre beneficio:', error)
    return NextResponse.json(
      { error: 'No se ha podido procesar el informe', details: error.message },
      { status: 500 }
    )
  }
}

/**
 * LEER EL INFORME VENGA EN CSV O EN XLSX.
 *
 * Sellerboard deja bajar el mismo Tablero de Productos en los dos formatos y se
 * usan los dos indistintamente. Antes solo se aceptaba CSV, así que con el XLSX
 * delante había que abrirlo y volver a guardarlo para poder subirlo.
 *
 * El CSV viene con BOM y separado por punto y coma, y los miles con espacio
 * duro («4 619,85»). parseCSV detecta el separador y parseNum se come el
 * espacio duro; el BOM se quita aquí, porque si no la PRIMERA columna se llama
 * «﻿Product» y no la encuentra nadie.
 */
async function leerInforme(file: File): Promise<Record<string, any>[]> {
  const nombre = file.name.toLowerCase()

  if (nombre.endsWith('.xlsx') || nombre.endsWith('.xls')) {
    const buffer = await file.arrayBuffer()
    const libro = XLSX.read(buffer, { type: 'array' })
    const hoja = libro.Sheets[libro.SheetNames[0]]
    return XLSX.utils.sheet_to_json(hoja, { defval: null }) as Record<string, any>[]
  }

  const texto = (await file.text()).replace(/^﻿/, '')
  return parseCSV(texto)
}
