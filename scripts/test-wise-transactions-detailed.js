// Script detallado para probar endpoints de Wise y obtener transacciones reales
const fs = require('fs')
const path = require('path')

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

async function getBusinessProfileId() {
  const response = await fetch('https://api.transferwise.com/v1/profiles', {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  })
  const profiles = await response.json()
  const businessProfile = profiles.find(p => p.type === 'BUSINESS' || p.type === 'business')
  return businessProfile ? businessProfile.id : profiles[0].id
}

async function testDetailed() {
  try {
    const profileId = await getBusinessProfileId()
    console.log(`📊 Profile ID: ${profileId}\n`)

    // Obtener balances
    const balancesResponse = await fetch(
      `https://api.transferwise.com/v4/profiles/${profileId}/balances?types=STANDARD`,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    )

    const balances = await balancesResponse.json()
    console.log(`💰 Balances encontrados: ${balances.length}\n`)

    for (const balance of balances) {
      console.log(`\n🔍 Probando con Balance ID: ${balance.id} (${balance.currency})`)
      
      const endDate = new Date()
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - 30)
      
      const startDateISO = startDate.toISOString()
      const endDateISO = endDate.toISOString()

      // Endpoint: balance-statements con balance ID
      console.log(`   Probando: /v1/profiles/{profileId}/balance-statements/{balanceId}`)
      try {
        const response = await fetch(
          `https://api.transferwise.com/v1/profiles/${profileId}/balance-statements/${balance.id}?currency=${balance.currency}&intervalStart=${startDateISO}&intervalEnd=${endDateISO}`,
          {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            }
          }
        )

        console.log(`   Status: ${response.status}`)
        if (response.ok) {
          const data = await response.json()
          console.log(`   ✅ Respuesta recibida`)
          console.log(`   📋 Estructura completa:`, JSON.stringify(data, null, 2))
          
          // Buscar transacciones en diferentes formatos posibles
          if (data.transactions) {
            console.log(`   ✅ Transacciones encontradas: ${data.transactions.length}`)
          }
          if (data.entries) {
            console.log(`   ✅ Entradas encontradas: ${data.entries.length}`)
          }
          if (data.items) {
            console.log(`   ✅ Items encontrados: ${data.items.length}`)
          }
        } else {
          const errorText = await response.text()
          console.log(`   ❌ Error: ${errorText}`)
        }
      } catch (error) {
        console.log(`   ❌ Excepción: ${error.message}`)
      }

      // Endpoint alternativo: statement
      console.log(`\n   Probando: /v1/profiles/{profileId}/statement`)
      try {
        const response2 = await fetch(
          `https://api.transferwise.com/v1/profiles/${profileId}/statement?currency=${balance.currency}&intervalStart=${startDateISO}&intervalEnd=${endDateISO}`,
          {
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            }
          }
        )

        console.log(`   Status: ${response2.status}`)
        if (response2.ok) {
          const data2 = await response2.json()
          console.log(`   ✅ Respuesta recibida`)
          console.log(`   📋 Estructura:`, JSON.stringify(data2, null, 2).substring(0, 1000))
        } else {
          const errorText = await response2.text()
          console.log(`   ❌ Error: ${errorText}`)
        }
      } catch (error) {
        console.log(`   ❌ Excepción: ${error.message}`)
      }
    }

  } catch (error) {
    console.error('\n❌ Error general:', error.message)
    console.error(error.stack)
  }
}

testDetailed()


