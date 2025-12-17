// Script para probar la obtención de transacciones de Wise para diciembre 2025
const fs = require('fs')
const path = require('path')

// Leer variables de entorno de .env.local
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local')
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8')
    envContent.split('\n').forEach(line => {
      const match = line.match(/^([^=]+)=(.*)$/)
      if (match) {
        const key = match[1].trim()
        const value = match[2].trim().replace(/^["']|["']$/g, '')
        process.env[key] = value
      }
    })
  }
}

loadEnv()

const apiKey = process.env.WISE_API_KEY
const profileId = process.env.WISE_PROFILE_ID || '22659190'

if (!apiKey) {
  console.error('❌ WISE_API_KEY no encontrado en .env.local')
  process.exit(1)
}

console.log(`🔑 API Key: ${apiKey.substring(0, 10)}...`)
console.log(`📊 Profile ID: ${profileId}\n`)

// Fechas de diciembre 2025
const startDate = new Date(2025, 11, 1) // Diciembre es mes 11 (0-indexed)
const endDate = new Date(2025, 11, 31, 23, 59, 59)

const startDateStr = startDate.toISOString().split('T')[0]
const endDateStr = endDate.toISOString().split('T')[0]

console.log(`📅 Rango: ${startDateStr} a ${endDateStr}\n`)

async function testDecemberTransactions() {
  try {
    // Obtener activities
    console.log('🔍 Obteniendo activities...')
    const response = await fetch(
      `https://api.transferwise.com/v1/profiles/${profileId}/activities?limit=500`,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`❌ Error: ${response.status} - ${errorText}`)
      return
    }

    const data = await response.json()
    const activities = data.activities || data.data || (Array.isArray(data) ? data : [])
    
    console.log(`✅ Total de activities: ${activities.length}\n`)

    // Filtrar por fecha de diciembre 2025
    const decemberActivities = activities.filter((activity) => {
      const activityDate = activity.createdOn || activity.date || activity.createdAt
      if (!activityDate) return false
      
      const date = new Date(activityDate)
      if (isNaN(date.getTime())) return false
      
      const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate())
      const startDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate())
      const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate())
      
      return dateOnly >= startDateOnly && dateOnly <= endDateOnly
    })

    console.log(`📊 Actividades de diciembre 2025: ${decemberActivities.length}\n`)

    if (decemberActivities.length === 0) {
      console.log('⚠️  No se encontraron actividades en diciembre 2025')
      console.log('\nPrimeras 5 actividades (todas):')
      activities.slice(0, 5).forEach((a, i) => {
        console.log(`${i + 1}. ${a.type} - ${a.createdOn} - ${a.primaryAmount} - ${a.title}`)
      })
      return
    }

    // Procesar cada actividad
    const transactions = decemberActivities
      .filter((activity) => {
        if (activity.status !== 'COMPLETED') return false
        if (activity.type === 'CARD_CHECK') return false
        return true
      })
      .map((activity) => {
        // Parsear monto
        let primaryAmount = activity.primaryAmount || ''
        primaryAmount = primaryAmount.replace(/<[^>]*>/g, '').trim()
        
        let sign = ''
        if (primaryAmount.includes('+')) sign = '+'
        else if (primaryAmount.includes('-')) sign = '-'
        
        let amount = 0
        let currency = 'EUR'
        
        const amountMatch = primaryAmount.match(/([\d,]+\.?\d*)\s*([A-Z]{3})/i)
        if (amountMatch) {
          const numStr = amountMatch[1].replace(/,/g, '')
          amount = parseFloat(sign + numStr)
          currency = amountMatch[2].toUpperCase()
        } else {
          const numMatch = primaryAmount.match(/([\d,]+\.?\d*)/)
          if (numMatch) {
            const numStr = numMatch[1].replace(/,/g, '')
            amount = parseFloat(sign + numStr)
          }
        }
        
        const isIncome = (activity.type === 'TRANSFER' && amount > 0) || 
                        (activity.type === 'INTERBALANCE' && amount > 0)
        const isExpense = activity.type === 'CARD_PAYMENT' || 
                         (activity.type === 'TRANSFER' && amount < 0) ||
                         (activity.type === 'INTERBALANCE' && amount < 0)
        
        const title = (activity.title || '').replace(/<[^>]*>/g, '').trim()
        
        return {
          id: activity.id,
          type: activity.type,
          date: activity.createdOn,
          title: title,
          description: activity.description,
          primaryAmount: activity.primaryAmount,
          parsedAmount: amount,
          currency: currency,
          isIncome: isIncome,
          isExpense: isExpense,
          finalAmount: isIncome ? Math.abs(amount) : (isExpense ? -Math.abs(amount) : amount),
          status: activity.status
        }
      })

    console.log(`💰 Transacciones válidas: ${transactions.length}\n`)
    
    // Mostrar resumen
    const totalIncome = transactions.filter(t => t.isIncome).reduce((sum, t) => sum + Math.abs(t.finalAmount), 0)
    const totalExpenses = transactions.filter(t => t.isExpense).reduce((sum, t) => sum + Math.abs(t.finalAmount), 0)
    
    console.log('📊 RESUMEN:')
    console.log(`   Ingresos: €${totalIncome.toFixed(2)}`)
    console.log(`   Gastos: €${totalExpenses.toFixed(2)}`)
    console.log(`   Beneficio: €${(totalIncome - totalExpenses).toFixed(2)}\n`)

    console.log('📋 DETALLE DE TRANSACCIONES:\n')
    transactions.forEach((tx, i) => {
      const type = tx.isIncome ? '💰 INGRESO' : (tx.isExpense ? '💸 GASTO' : '🔄 OTRO')
      const date = new Date(tx.date).toLocaleDateString('es-ES')
      console.log(`${i + 1}. ${type}`)
      console.log(`   Fecha: ${date}`)
      console.log(`   Tipo: ${tx.type}`)
      console.log(`   Título: ${tx.title}`)
      console.log(`   Monto original: ${tx.primaryAmount}`)
      console.log(`   Monto parseado: ${tx.parsedAmount} ${tx.currency}`)
      console.log(`   Monto final: €${tx.finalAmount.toFixed(2)}`)
      console.log(`   Descripción: ${tx.description || 'N/A'}`)
      console.log('')
    })

  } catch (error) {
    console.error('❌ Error:', error.message)
    console.error(error.stack)
  }
}

testDecemberTransactions()

