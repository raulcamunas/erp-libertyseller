import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getTransactions } from '@/lib/wise'
import { format, subDays } from 'date-fns'

/**
 * Endpoint para sincronizar transacciones de Wise con la base de datos
 * POST /api/finance/sync
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient()

    // Verificar que la variable de entorno esté configurada
    if (!process.env.WISE_API_KEY) {
      return NextResponse.json(
        { 
          error: 'Wise API no configurada',
          message: 'Por favor, configura WISE_API_KEY como variable de entorno en Easypanel'
        },
        { status: 500 }
      )
    }

    // Obtener parámetros del body (año y mes seleccionados)
    let body: { year?: number; month?: number } = {}
    try {
      body = await request.json()
    } catch {
      // Si no hay body, usar mes actual
    }

    const selectedYear = body.year || new Date().getFullYear()
    const selectedMonth = body.month || (new Date().getMonth() + 1)

    // Calcular el rango de fechas del mes seleccionado
    const startDate = new Date(selectedYear, selectedMonth - 1, 1) // Primer día del mes
    const endDate = new Date(selectedYear, selectedMonth, 0, 23, 59, 59) // Último día del mes

    console.log(`Sincronizando transacciones de Wise para ${selectedYear}-${selectedMonth}`)
    console.log(`Rango de fechas: ${startDate.toISOString()} hasta ${endDate.toISOString()}`)

    let transactions: any[] = []
    try {
      transactions = await getTransactions(startDate, endDate)
      console.log(`Se encontraron ${transactions.length} transacciones de Wise`)
      if (transactions.length > 0) {
        console.log('Primera transacción de ejemplo:', JSON.stringify(transactions[0], null, 2))
      } else {
        console.warn('⚠️ No se encontraron transacciones en Wise para este período. Esto puede ser normal si:')
        console.warn('   - No hay transacciones en los últimos 30 días')
        console.warn('   - La cuenta de Wise no tiene actividad')
        console.warn('   - El endpoint de Wise requiere permisos adicionales')
      }
    } catch (error: any) {
      console.error('Error obteniendo transacciones de Wise:', error.message)
      // Continuar con el proceso aunque no haya transacciones
      transactions = []
    }

    let created = 0
    let updated = 0
    let skipped = 0
    const errors: string[] = []

    // Procesar cada transacción
    for (const tx of transactions) {
      try {
        // Preparar datos del pago primero
        const clientName = tx.details.recipient?.name || 
                          tx.details.paymentReference || 
                          'Wise Transaction'
        
        const description = tx.details.description || 
                           `Transacción Wise: ${tx.type}` ||
                           ''
        
        // Determinar si es ingreso, gasto o conversión
        // Las conversiones son movimientos internos entre cuentas de Wise
        const amount = tx.amount.value
        const isConversion = (tx as any)._isConversion || false
        
        // Verificar por client_name y descripción si es conversión
        const clientNameLower = clientName.toLowerCase()
        const descriptionLower = description.toLowerCase()
        const isConversionByClientName = 
          clientNameLower.startsWith('to ') ||
          clientNameLower.includes('to eur') ||
          clientNameLower.includes('to usd') ||
          clientNameLower.includes('to gbp') ||
          descriptionLower.includes('moved by you')
        
        let type: 'income' | 'expense' | 'conversion'
        if (isConversion || isConversionByClientName) {
          type = 'conversion'
          console.log(`🔄 Detectada conversión: "${clientName}" - "${description}"`)
        } else {
          const isIncome = amount > 0
          type = isIncome ? 'income' : 'expense'
        }
        const absoluteAmount = Math.abs(amount)
        
        console.log(`Procesando transacción ${tx.id}: ${type} de ${absoluteAmount} ${tx.amount.currency}`)

        // Obtener o crear el periodo correspondiente a la fecha de la transacción
        const txDate = new Date(tx.date)
        const year = txDate.getFullYear()
        const month = txDate.getMonth() + 1

        // Buscar o crear el periodo
        let { data: period, error: periodError } = await supabase
          .from('finance_periods')
          .select('id')
          .eq('year', year)
          .eq('month', month)
          .single()

        if (periodError || !period) {
          // Crear el periodo si no existe
          const { data: newPeriod, error: createError } = await supabase
            .from('finance_periods')
            .insert([{ year, month }])
            .select()
            .single()

          if (createError || !newPeriod) {
            errors.push(`Error creando periodo ${year}-${month}: ${createError?.message}`)
            continue
          }
          period = newPeriod
        }

        // Verificar que period existe antes de continuar
        if (!period || !period.id) {
          errors.push(`Error: periodo no disponible para transacción ${tx.id}`)
          continue
        }

        // Verificar si ya existe esta transacción (por external_id)
        const { data: existing } = await supabase
          .from('finance_payments')
          .select('id')
          .eq('external_id', tx.id)
          .single()

        if (existing) {
          // Verificar si la transacción existente debería ser conversión (por si el client_name cambió)
          let finalType = type
          const existingClientNameLower = clientName.toLowerCase()
          
          // Si el client_name indica conversión, forzar el tipo
          if (existingClientNameLower.startsWith('to ') ||
              existingClientNameLower.includes('to eur') ||
              existingClientNameLower.includes('to usd') ||
              existingClientNameLower.includes('to gbp')) {
            finalType = 'conversion'
            console.log(`🔄 Actualizando transacción existente a conversión: "${clientName}"`)
          }
          
          // Actualizar transacción existente
          const { error: updateError } = await supabase
            .from('finance_payments')
            .update({
              amount: absoluteAmount,
              type: finalType,
              client_name: clientName,
              description,
              payment_date: txDate.toISOString().split('T')[0],
              updated_at: new Date().toISOString()
            })
            .eq('external_id', tx.id)

          if (updateError) {
            errors.push(`Error actualizando transacción ${tx.id}: ${updateError.message}`)
          } else {
            updated++
          }
        } else {
          // Crear nueva transacción
          const { error: insertError } = await supabase
            .from('finance_payments')
            .insert([{
              period_id: period.id,
              external_id: tx.id,
              client_name: clientName,
              amount: absoluteAmount,
              type,
              description,
              payment_date: txDate.toISOString().split('T')[0]
            }])

          if (insertError) {
            errors.push(`Error insertando transacción ${tx.id}: ${insertError.message}`)
          } else {
            created++
          }
        }
      } catch (error: any) {
        errors.push(`Error procesando transacción ${tx.id}: ${error.message}`)
        skipped++
      }
    }

    // Calcular resumen del mes actual
    const now = new Date()
    const currentYear = now.getFullYear()
    const currentMonth = now.getMonth() + 1

    const { data: currentPeriod } = await supabase
      .from('finance_periods')
      .select('id')
      .eq('year', currentYear)
      .eq('month', currentMonth)
      .single()

    let totalIncome = 0
    let totalExpenses = 0

    if (currentPeriod) {
      const { data: payments } = await supabase
        .from('finance_payments')
        .select('amount, type')
        .eq('period_id', currentPeriod.id)

      if (payments) {
        // Excluir conversiones de los cálculos
        totalIncome = payments
          .filter(p => p.type === 'income')
          .reduce((sum, p) => sum + Number(p.amount), 0)
        
        totalExpenses = payments
          .filter(p => p.type === 'expense')
          .reduce((sum, p) => sum + Number(p.amount), 0)
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        transactionsFound: transactions.length,
        created,
        updated,
        skipped,
        errors: errors.length
      },
      currentMonth: {
        totalIncome,
        totalExpenses,
        profit: totalIncome - totalExpenses
      },
      errors: errors.length > 0 ? errors : undefined
    })
  } catch (error: any) {
    console.error('Error syncing Wise transactions:', error)
    return NextResponse.json(
      { 
        error: 'Error al sincronizar transacciones',
        message: error.message 
      },
      { status: 500 }
    )
  }
}

