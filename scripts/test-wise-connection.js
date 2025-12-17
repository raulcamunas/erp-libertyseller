// Script para probar la conexión con Wise API
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

if (!apiKey) {
  console.error('❌ WISE_API_KEY no encontrado en .env.local')
  process.exit(1)
}

console.log('🔑 API Key encontrado:', apiKey.substring(0, 10) + '...')

async function testWiseConnection() {
  try {
    // Paso 1: Obtener perfiles
    console.log('\n📋 Paso 1: Obteniendo perfiles...')
    const profilesResponse = await fetch('https://api.transferwise.com/v1/profiles', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    })

    if (!profilesResponse.ok) {
      const errorText = await profilesResponse.text()
      console.error('❌ Error obteniendo perfiles:', profilesResponse.status, errorText)
      return
    }

    const profiles = await profilesResponse.json()
    console.log('✅ Perfiles obtenidos:', profiles.length)
    profiles.forEach(p => {
      console.log(`   - ID: ${p.id}, Tipo: ${p.type}, Nombre: ${p.businessName || p.personalFirstName || 'Sin nombre'}`)
    })

    // Buscar perfil BUSINESS
    const businessProfile = profiles.find(p => p.type === 'BUSINESS' || p.type === 'business')
    const profileId = businessProfile ? businessProfile.id : profiles[0].id

    console.log(`\n📊 Usando Profile ID: ${profileId} (${businessProfile ? businessProfile.type : profiles[0].type})`)

    // Paso 2: Obtener balances
    console.log('\n💰 Paso 2: Obteniendo balances...')
    const balanceResponse = await fetch(`https://api.transferwise.com/v4/profiles/${profileId}/balances?types=STANDARD`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    })

    if (!balanceResponse.ok) {
      const errorText = await balanceResponse.text()
      console.error('❌ Error obteniendo balances:', balanceResponse.status, errorText)
      return
    }

    const balances = await balanceResponse.json()
    console.log('✅ Balances obtenidos:', balances.length)
    console.log('Estructura del balance:', JSON.stringify(balances[0], null, 2))
    balances.forEach(b => {
      const amount = b.amount?.value || b.amount || b.cashAmount?.value || b.cashAmount || 'N/A'
      console.log(`   - ${b.currency}: ${amount}`)
    })

    const eurBalance = balances.find(b => b.currency === 'EUR')
    if (eurBalance) {
      const amount = eurBalance.amount?.value || eurBalance.amount || eurBalance.cashAmount?.value || eurBalance.cashAmount
      console.log(`\n✅ Balance EUR: €${amount}`)
    } else {
      console.log('\n⚠️  No se encontró balance en EUR')
    }

    // Paso 3: Obtener transacciones (últimos 7 días)
    console.log('\n📜 Paso 3: Obteniendo transacciones (últimos 7 días)...')
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - 7)
    
    const startDateStr = startDate.toISOString().split('T')[0]
    const endDateStr = endDate.toISOString().split('T')[0]

    const activitiesResponse = await fetch(
      `https://api.transferwise.com/v1/profiles/${profileId}/activities?start=${startDateStr}&end=${endDateStr}&limit=10`,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    )

    if (!activitiesResponse.ok) {
      const errorText = await activitiesResponse.text()
      console.error('❌ Error obteniendo transacciones:', activitiesResponse.status, errorText)
      console.log('\n💡 Nota: El endpoint de activities puede no estar disponible para tu tipo de cuenta.')
      return
    }

    const activities = await activitiesResponse.json()
    const transactions = Array.isArray(activities) ? activities : (activities.data || [])
    console.log('✅ Transacciones obtenidas:', transactions.length)
    
    if (transactions.length > 0) {
      console.log('\n📋 Primeras transacciones:')
      transactions.slice(0, 3).forEach((tx, idx) => {
        console.log(`   ${idx + 1}. ID: ${tx.id || tx.transactionId || 'N/A'}, Amount: ${tx.amount?.value || tx.amount || 'N/A'}`)
      })
    }

    console.log('\n✅ Conexión con Wise exitosa!')
  } catch (error) {
    console.error('\n❌ Error:', error.message)
    console.error(error.stack)
  }
}

testWiseConnection()

