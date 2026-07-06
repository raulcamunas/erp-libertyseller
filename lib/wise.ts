/**
 * Cliente de Wise API
 * Documentación: https://api-docs.transferwise.com/
 */

interface WiseBalance {
  id: number
  currency: string
  amount: {
    value: number
    currency: string
  }
  cashAmount: {
    value: number
    currency: string
  }
  reservedAmount?: {
    value: number
    currency: string
  }
  totalWorth?: {
    value: number
    currency: string
  }
  type: string
}

interface WiseTransaction {
  id: string
  type: string
  amount: {
    value: number
    currency: string
  }
  details: {
    description?: string
    paymentReference?: string
    recipient?: {
      name?: string
    }
  }
  exchangeDetails?: {
    fromCurrency?: string
    toCurrency?: string
  }
  date: string
}

interface WiseProfile {
  id: number
  type: string
  businessName?: string
  personalFirstName?: string
  personalLastName?: string
}

/**
 * Obtiene el Profile ID de Wise
 * Prioriza WISE_PROFILE_ID del .env.local si está configurado
 * Si no, detecta automáticamente el perfil BUSINESS
 */
export async function getBusinessProfileId(): Promise<number> {
  const apiKey = process.env.WISE_API_KEY

  if (!apiKey) {
    throw new Error('WISE_API_KEY debe estar configurado en .env.local')
  }

  // Prioridad 1: Usar WISE_PROFILE_ID si está configurado
  const envProfileId = process.env.WISE_PROFILE_ID
  if (envProfileId && envProfileId.trim() !== '' && envProfileId !== 'tu_profile_id_aqui') {
    const profileId = parseInt(envProfileId.trim(), 10)
    if (!isNaN(profileId)) {
      console.log(`Usando WISE_PROFILE_ID del .env.local: ${profileId}`)
      return profileId
    } else {
      console.warn(`WISE_PROFILE_ID tiene un valor inválido: "${envProfileId}". Detectando automáticamente...`)
    }
  }

  // Prioridad 2: Detectar automáticamente el perfil BUSINESS
  try {
    const response = await fetch('https://api.transferwise.com/v1/profiles', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Wise API error: ${response.status} - ${errorText}`)
    }

    const profiles: WiseProfile[] = await response.json()

    if (!profiles || profiles.length === 0) {
      throw new Error('No se encontraron perfiles en la cuenta de Wise')
    }

    // Buscar perfil de tipo BUSINESS (case insensitive)
    const businessProfile = profiles.find(p => 
      p.type === 'BUSINESS' || p.type === 'business' || p.type.toLowerCase() === 'business'
    )

    if (businessProfile) {
      console.log(`Perfil BUSINESS detectado automáticamente: ${businessProfile.id} - ${businessProfile.businessName || 'Sin nombre'}`)
      return businessProfile.id
    }

    // Si no hay BUSINESS, usar el primero disponible (normalmente PERSONAL)
    const firstProfile = profiles[0]
    console.log(`No se encontró perfil BUSINESS, usando: ${firstProfile.id} (${firstProfile.type})`)
    return firstProfile.id
  } catch (error: any) {
    console.error('Error fetching Wise profiles:', error)
    throw new Error(`Error al obtener perfil de Wise: ${error.message}`)
  }
}

/**
 * Obtiene todos los balances de la cuenta Wise en diferentes monedas
 */
export async function getBalances(): Promise<Array<{ currency: string; amount: number }>> {
  const apiKey = process.env.WISE_API_KEY

  if (!apiKey) {
    throw new Error('WISE_API_KEY debe estar configurado en .env.local')
  }

  try {
    // Obtener el Profile ID automáticamente
    const profileId = await getBusinessProfileId()

    // Obtener balances de todos los balances del perfil
    // Nota: El endpoint requiere el parámetro types=STANDARD
    const response = await fetch(`https://api.transferwise.com/v4/profiles/${profileId}/balances?types=STANDARD`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Wise API error: ${response.status} - ${errorText}`)
    }

    const balances: WiseBalance[] = await response.json()

    console.log(`=== DEBUG BALANCES WISE ===`)
    console.log(`Total balances recibidos de API: ${balances.length}`)
    console.log(`Balances raw:`, JSON.stringify(balances, null, 2))

    // Devolver todos los balances con su moneda y monto
    // Incluir todos los balances con saldo > 0 para mostrar solo cuentas con dinero
    const result = balances
      .map(b => {
        const cashAmount = b.cashAmount?.value || 0
        const totalAmount = b.amount?.value || 0
        const amount = cashAmount > 0 ? cashAmount : totalAmount
        
        console.log(`Balance ${b.currency}: cashAmount=${cashAmount}, amount=${totalAmount}, final=${amount}`)
        
        return {
          currency: b.currency,
          amount: amount
        }
      })
      .filter(b => {
        // Incluir solo balances con valor definido y mayor a 0
        const include = b.amount !== undefined && b.amount !== null && b.amount > 0
        if (!include) {
          console.log(`Excluyendo balance ${b.currency}: amount=${b.amount}`)
        }
        return include
      })
      .sort((a, b) => {
        // Ordenar: EUR primero, USD segundo, luego alfabéticamente
        if (a.currency === 'EUR') return -1
        if (b.currency === 'EUR') return 1
        if (a.currency === 'USD') return -1
        if (b.currency === 'USD') return 1
        return a.currency.localeCompare(b.currency)
      })
    
    console.log(`Balances encontrados en Wise API: ${balances.length}`)
    console.log(`Balances con saldo > 0: ${result.length}`, result)
    console.log(`=== FIN DEBUG BALANCES ===`)
    return result
  } catch (error: any) {
    console.error('Error fetching Wise balances:', error)
    throw new Error(`Error al obtener saldos de Wise: ${error.message}`)
  }
}

/**
 * Obtiene el saldo actual de la cuenta Wise en EUR (mantener compatibilidad)
 */
export async function getBalance(): Promise<number> {
  const balances = await getBalances()
  const eurBalance = balances.find(b => b.currency === 'EUR')
  return eurBalance?.amount || 0
}

/**
 * Obtiene las transacciones de Wise en un rango de fechas
 */
export async function getTransactions(
  startDate: Date,
  endDate: Date
): Promise<WiseTransaction[]> {
  const apiKey = process.env.WISE_API_KEY

  if (!apiKey) {
    throw new Error('WISE_API_KEY debe estar configurado en .env.local')
  }

  try {
    // Obtener el Profile ID automáticamente
    const profileId = await getBusinessProfileId()

    // Formatear fechas en formato ISO (YYYY-MM-DD)
    const startDateStr = startDate.toISOString().split('T')[0]
    const endDateStr = endDate.toISOString().split('T')[0]
    const startDateISO = startDate.toISOString()
    const endDateISO = endDate.toISOString()

    console.log(`Buscando transacciones desde ${startDateStr} hasta ${endDateStr}`)
    console.log(`Usando Profile ID: ${profileId}`)

    // Método 1: Usar el endpoint de activities (este es el que tiene TODAS las transacciones)
    // Priorizar este método porque incluye ingresos, gastos, transferencias, pagos con tarjeta, etc.
    console.log('Método 1: Probando endpoint /v1/profiles/{profileId}/activities (MÉTODO PRINCIPAL)')
    let activitiesData: any = null
    let transactions: any[] = [] // Inicializar aquí para evitar problemas
    
    try {
      // El endpoint de activities no acepta parámetros de fecha directamente, 
      // así que obtenemos todas y filtramos después
      const response = await fetch(
        `https://api.transferwise.com/v1/profiles/${profileId}/activities?limit=500`,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      )

      if (response.ok) {
        activitiesData = await response.json()
        const activities = activitiesData.activities || activitiesData.data || (Array.isArray(activitiesData) ? activitiesData : [])
        console.log(`Activities: ${activities.length} actividades encontradas (total)`)
        
        if (activities.length > 0) {
          console.log('Primera actividad:', JSON.stringify(activities[0], null, 2))
          
          // Filtrar por fecha manualmente
          const filteredActivities = activities.filter((activity: any) => {
            const activityDate = activity.createdOn || activity.date || activity.createdAt || activity.timestamp
            if (!activityDate) return false
            
            const date = new Date(activityDate)
            if (isNaN(date.getTime())) return false
            
            // Comparar fechas (solo la fecha, sin hora)
            const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate())
            const startDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate())
            const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate())
            
            return dateOnly >= startDateOnly && dateOnly <= endDateOnly
          })
          
          console.log(`Después de filtrar por fecha: ${filteredActivities.length} actividades`)
          
          // Convertir activities a transacciones
          transactions = filteredActivities
            .filter((activity: any) => {
              // Solo incluir actividades completadas y relevantes
              if (activity.status !== 'COMPLETED') return false
              
              // Excluir: CARD_CHECK (solo verificaciones, no transacciones reales)
              if (activity.type === 'CARD_CHECK') return false
              
              return true
            })
            .map((activity: any) => {
              // Detectar si es una conversión interna (movimiento entre cuentas de la misma cuenta Wise)
              const title = (activity.title || '').toLowerCase()
              const description = (activity.description || '').toLowerCase()
              
              // Detectar conversiones: cualquier transacción que empiece con "To " seguido de una moneda
              // Ejemplos: "To USD", "To EUR", "To GBP", etc.
              const isInternalTransfer = 
                activity.type === 'INTERBALANCE' ||
                title.startsWith('to ') ||
                title.startsWith('to eur') ||
                title.startsWith('to usd') ||
                title.startsWith('to gbp') ||
                title.includes('to eur') ||
                title.includes('to usd') ||
                title.includes('to gbp') ||
                title.includes('moved by you') ||
                description.includes('moved by you')
              
              // Marcar como conversión si es movimiento interno
              if (isInternalTransfer) {
                activity._isConversion = true
                console.log(`✅ Marcando como conversión: "${activity.title || ''}" - "${activity.description || ''}"`)
              }
              
              return activity
            })
            .map((activity: any) => {
              // Parsear el monto del campo primaryAmount
              // Formato: "1.07 EUR", "+ 675 EUR", "<positive>+ 1,243.79 EUR</positive>"
              let amount = 0
              let currency = 'EUR'
              
              let primaryAmount = activity.primaryAmount || ''
              
              // Limpiar HTML tags primero (ej: "<positive>+ 675 EUR</positive>" -> "+ 675 EUR")
              primaryAmount = primaryAmount.replace(/<[^>]*>/g, '').trim()
              
              console.log(`Parseando monto: "${activity.primaryAmount}" -> "${primaryAmount}"`)
              
              // Extraer el monto y la moneda
              // Buscar patrones como: "+ 675 EUR", "1.07 EUR", "- 100 EUR", "1,243.79 EUR", "+ 1,243.79 EUR"
              // El signo puede estar antes o después del número
              let sign = ''
              if (primaryAmount.includes('+')) {
                sign = '+'
              } else if (primaryAmount.includes('-')) {
                sign = '-'
              }
              
              // Buscar número con posibles comas y decimales, seguido de moneda
              const amountMatch = primaryAmount.match(/([\d,]+\.?\d*)\s*([A-Z]{3})/i)
              if (amountMatch) {
                const numStr = amountMatch[1].replace(/,/g, '')
                amount = parseFloat(sign + numStr)
                currency = amountMatch[2].toUpperCase()
                console.log(`Monto parseado: ${amount} ${currency}`)
              } else {
                // Si no hay match con moneda, intentar extraer solo números
                const numMatch = primaryAmount.match(/([\d,]+\.?\d*)/)
                if (numMatch) {
                  const numStr = numMatch[1].replace(/,/g, '')
                  amount = parseFloat(sign + numStr)
                  console.log(`Monto parseado (sin moneda): ${amount}`)
                } else {
                  console.warn(`No se pudo parsear el monto: "${primaryAmount}"`)
                }
              }
              
              // Determinar si es ingreso o gasto basado en el tipo y el monto
              // TRANSFER con monto positivo = ingreso (dinero que entra)
              // CARD_PAYMENT = gasto (dinero que sale)
              // INTERBALANCE = movimiento interno (puede ser positivo o negativo)
              const isIncome = (activity.type === 'TRANSFER' && amount > 0) || 
                              (activity.type === 'INTERBALANCE' && amount > 0)
              const isExpense = activity.type === 'CARD_PAYMENT' || 
                               (activity.type === 'TRANSFER' && amount < 0) ||
                               (activity.type === 'INTERBALANCE' && amount < 0)
              
              // Extraer el título (puede tener HTML)
              const title = (activity.title || '').replace(/<[^>]*>/g, '').trim()
              
              // Preservar el flag de conversión del primer map
              const isConversion = activity._isConversion || false
              
              if (isConversion) {
                console.log(`✅ Transacción marcada como conversión: "${title}" - "${activity.description || ''}"`)
              }
              
              return {
                id: activity.id || String(Date.now() + Math.random()),
                type: activity.type || 'ACTIVITY',
                amount: {
                  value: isIncome ? Math.abs(amount) : (isExpense ? -Math.abs(amount) : amount),
                  currency: currency
                },
                details: {
                  description: `${title} - ${activity.description || ''}`.trim(),
                  paymentReference: activity.resource?.id || '',
                  recipient: {
                    name: title
                  }
                },
                exchangeDetails: null,
                date: activity.createdOn || activity.date || new Date().toISOString(),
                status: activity.status,
                _isConversion: isConversion // Preservar el flag de conversión
              }
            })
          
          console.log(`Después de procesar activities: ${transactions.length} transacciones válidas`)
        }
      } else {
        const errorText = await response.text()
        console.warn(`Activities falló (${response.status}): ${errorText}`)
      }
    } catch (error: any) {
      console.warn(`Error en activities: ${error.message}`)
    }

    // Método 3: Usar el endpoint de transfers solo si activities no devolvió nada
    // (transfers solo tiene transferencias salientes, no ingresos)
    if (transactions.length === 0) {
      console.log('Método 3: Probando endpoint /v1/transfers (fallback si activities no devolvió nada)')
      try {
        // Usar los parámetros de fecha en el endpoint para que Wise filtre en el servidor
        // Formato de fecha: YYYY-MM-DD
        const transfersResponse = await fetch(
        `https://api.transferwise.com/v1/transfers?createdDateStart=${startDateStr}&createdDateEnd=${endDateStr}&limit=500`,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      )

      if (transfersResponse.ok) {
        const transfersData = await transfersResponse.json()
        const transfers = Array.isArray(transfersData) ? transfersData : (transfersData.data || [])
        console.log(`Transfers: ${transfers.length} transferencias encontradas (total)`)
        
        if (transfers.length > 0) {
          console.log('Primera transferencia:', JSON.stringify(transfers[0], null, 2))
          console.log(`Rango de fechas buscado: ${startDate.toISOString()} a ${endDate.toISOString()}`)
          
          // Primero, mostrar todas las fechas de las transferencias para debug
          const sampleDates = transfers.slice(0, 10).map((t: any) => ({
            id: t.id,
            created: t.created,
            status: t.status,
            date: new Date(t.created || t.createdAt || t.completedAt || '')
          }))
          console.log('Fechas de muestra de transferencias:', JSON.stringify(sampleDates, null, 2))
          
          // Wise ya filtra por fecha en el servidor, pero hacemos un filtrado adicional por seguridad
          // y para manejar casos edge donde la fecha pueda estar en formato diferente
          const filteredByDate = transfers.filter((transfer: any) => {
            const transferDateStr = transfer.created || transfer.createdAt || transfer.completedAt
            if (!transferDateStr) {
              console.warn(`Transferencia ${transfer.id} no tiene fecha`)
              return false
            }
            
            // Intentar parsear la fecha en diferentes formatos
            let date: Date
            try {
              // Wise devuelve fechas como "2021-08-25 11:45:22" (formato MySQL datetime)
              if (typeof transferDateStr === 'string' && transferDateStr.includes(' ')) {
                // Formato: "2021-08-25 11:45:22" -> convertir a ISO
                // Reemplazar el primer espacio con 'T' y añadir 'Z' al final
                date = new Date(transferDateStr.replace(' ', 'T') + 'Z')
              } else {
                date = new Date(transferDateStr)
              }
              
              // Verificar que la fecha sea válida
              if (isNaN(date.getTime())) {
                console.warn(`Fecha inválida para transferencia ${transfer.id}: ${transferDateStr}`)
                return false
              }
              
              // Comparar fechas (solo la fecha, sin hora)
              const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate())
              const startDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate())
              const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate())
              
              const inRange = dateOnly >= startDateOnly && dateOnly <= endDateOnly
              if (!inRange) {
                console.log(`Transferencia ${transfer.id} fuera de rango: ${dateOnly.toISOString()} (rango: ${startDateOnly.toISOString()} - ${endDateOnly.toISOString()})`)
              }
              return inRange
            } catch (error) {
              console.warn(`Error parseando fecha ${transferDateStr} para transferencia ${transfer.id}:`, error)
              return false
            }
          })
          
          console.log(`Después de filtrar por fecha: ${filteredByDate.length} transferencias (de ${transfers.length} totales)`)
          
          // Filtrar por estado (incluir más estados válidos)
          const transfersTransactions = filteredByDate
            .filter((transfer: any) => {
              // Excluir solo las canceladas explícitamente
              const isCancelled = transfer.status === 'cancelled'
              if (isCancelled) {
                console.log(`Excluyendo transferencia ${transfer.id} - estado: cancelled`)
                return false
              }
              
              // Incluir todos los demás estados (pueden ser ingresos o gastos)
              return true
            })
              .map((transfer: any) => {
                // Determinar si es ingreso o gasto basado en el status
                // outgoing_payment_sent = gasto (salida de dinero)
                // incoming = ingreso (entrada de dinero)
                const isOutgoing = transfer.status === 'outgoing_payment_sent' || 
                                  transfer.status === 'funds_converted' ||
                                  transfer.status === 'processing'
                
                // Para determinar el monto, necesitamos ver si es salida o entrada
                // Si es salida (outgoing), el dinero sale de nuestra cuenta = gasto (negativo)
                // Si es entrada (incoming), el dinero entra = ingreso (positivo)
                let amount = 0
                let currency = 'EUR'
                
                if (isOutgoing) {
                  // Salida de dinero = gasto (negativo)
                  amount = -(transfer.sourceValue || 0)
                  currency = transfer.sourceCurrency || 'EUR'
                } else {
                  // Entrada de dinero = ingreso (positivo)
                  amount = transfer.targetValue || 0
                  currency = transfer.targetCurrency || 'EUR'
                }
                
                // Parsear la fecha correctamente
                let dateStr = transfer.created || transfer.createdAt || transfer.completedAt
                if (dateStr && typeof dateStr === 'string' && dateStr.includes(' ')) {
                  // Formato: "2021-08-25 11:45:22" -> convertir a ISO
                  dateStr = dateStr.replace(' ', 'T') + 'Z'
                }
                
                return {
                  id: String(transfer.id),
                  type: transfer.type || 'TRANSFER',
                  amount: {
                    value: amount,
                    currency: currency
                  },
                  details: {
                    description: transfer.details?.reference || transfer.reference || `Transferencia Wise ${transfer.id}`,
                    paymentReference: transfer.details?.reference || transfer.reference,
                    recipient: {
                      name: transfer.details?.recipient?.name || ''
                    }
                  },
                  exchangeDetails: transfer.exchangeDetails,
                  date: dateStr || new Date().toISOString(),
                  status: transfer.status
                }
              })
          
          // Añadir las transferencias encontradas
          if (transfersTransactions.length > 0) {
            transactions = transfersTransactions
            console.log(`Añadidas ${transfersTransactions.length} transferencias. Total: ${transactions.length}`)
          } else {
            console.log(`No se añadieron transferencias válidas`)
          }
        } else {
          console.warn('No se encontraron transferencias en la respuesta')
        }
      } else {
        const errorText = await transfersResponse.text()
        console.warn(`Transfers falló (${transfersResponse.status}): ${errorText}`)
      }
      } catch (error: any) {
        console.warn(`Error en transfers: ${error.message}`)
        console.error('Stack trace:', error.stack)
      }
    }
    
    // Si después de todos los métodos no hay transacciones, usar las de activities como fallback
    if (transactions.length === 0) {
      console.warn('⚠️ No se encontraron transacciones después de probar todos los métodos')
      console.warn(`Rango de fechas: ${startDate.toISOString()} a ${endDate.toISOString()}`)
    }

    // Mapear transacciones al formato esperado
    return transactions.map((tx: any) => ({
      id: tx.id || tx.transactionId || String(tx.transaction_id) || String(Date.now() + Math.random()),
      type: tx.type || 'TRANSFER',
      amount: {
        value: tx.amount?.value || tx.amount || 0,
        currency: tx.amount?.currency || tx.currency || 'EUR'
      },
      details: {
        description: tx.details?.description || tx.description || tx.reference || '',
        paymentReference: tx.details?.paymentReference || tx.reference,
        recipient: {
          name: tx.details?.recipient?.name || tx.recipientName || ''
        }
      },
      exchangeDetails: tx.exchangeDetails,
      date: tx.date || tx.createdAt || tx.timestamp || new Date().toISOString()
    }))
  } catch (error: any) {
    console.error('Error fetching Wise transactions:', error)
    throw new Error(`Error al obtener transacciones de Wise: ${error.message}`)
  }
}

export interface WiseInvoiceItem {
  description: string
  quantity: number
  unitPrice: number
}

export interface WiseInvoiceResult {
  invoiceId?: string
  paymentLink: string
  method: 'api' | 'paylink'
}

/**
 * Crea una factura en Wise y devuelve el link de pago.
 * Intenta primero la Invoice API; si falla, genera un Pay Me link con importe prefijado.
 */
export async function createWiseInvoice(opts: {
  recipientEmail: string
  amount: number
  currency: string
  title: string
  items: WiseInvoiceItem[]
  dueDate: string
}): Promise<WiseInvoiceResult> {
  const apiKey = process.env.WISE_API_KEY
  if (!apiKey) throw new Error('WISE_API_KEY no configurado')

  const profileId = await getBusinessProfileId()

  // ── Intento 1: Invoice API (requiere "Acceso total") ───────────────────────
  try {
    const body = {
      profileId,
      sourceAmount: opts.amount,
      sourceCurrency: opts.currency,
      targetCurrency: opts.currency,
      recipient: { email: opts.recipientEmail },
      dueDate: opts.dueDate,
      title: opts.title,
      lineItems: opts.items.map(i => ({
        description: i.description,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        currency: opts.currency,
      })),
    }

    const res = await fetch(
      `https://api.transferwise.com/v3/profiles/${profileId}/invoices`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    )

    if (res.ok) {
      const data = await res.json()
      const paymentLink =
        data.paymentLink ||
        data.paymentUrl ||
        `https://wise.com/invoice/${data.id}`
      return { invoiceId: String(data.id), paymentLink, method: 'api' }
    }

    const errText = await res.text()
    console.warn(`Wise Invoice API falló (${res.status}): ${errText}. Usando Pay Me link.`)
  } catch (e: any) {
    console.warn(`Wise Invoice API error: ${e.message}. Usando Pay Me link.`)
  }

  // ── Intento 2: Pay Me link con importe prefijado ───────────────────────────
  // Obtiene el handle del perfil para construir wise.com/pay/me/{handle}
  let handle = ''
  try {
    const profileRes = await fetch(
      `https://api.transferwise.com/v1/profiles/${profileId}`,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    )
    if (profileRes.ok) {
      const profileData = await profileRes.json()
      handle =
        profileData?.details?.payMeLink?.split('/').pop() ||
        profileData?.details?.handle ||
        profileData?.handle ||
        ''
    }
  } catch {}

  if (!handle) {
    // Último recurso: link genérico de Wise con amount en query param
    const note = encodeURIComponent(opts.title)
    const paymentLink = `https://wise.com/pay?amount=${opts.amount}&currency=${opts.currency}&note=${note}`
    return { paymentLink, method: 'paylink' }
  }

  const note = encodeURIComponent(opts.title)
  const paymentLink = `https://wise.com/pay/me/${handle}?amount=${opts.amount}&currency=${opts.currency}&note=${note}`
  return { paymentLink, method: 'paylink' }
}

/**
 * Obtiene información del perfil de Wise
 */
export async function getProfile(): Promise<WiseProfile> {
  const apiKey = process.env.WISE_API_KEY

  if (!apiKey) {
    throw new Error('WISE_API_KEY debe estar configurado en .env.local')
  }

  try {
    // Obtener el Profile ID automáticamente
    const profileId = await getBusinessProfileId()

    const response = await fetch(`https://api.transferwise.com/v1/profiles/${profileId}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Wise API error: ${response.status} - ${errorText}`)
    }

    return await response.json()
  } catch (error: any) {
    console.error('Error fetching Wise profile:', error)
    throw new Error(`Error al obtener perfil de Wise: ${error.message}`)
  }
}

