// Script para probar diferentes endpoints de Wise para obtener transacciones
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

async function getBusinessProfileId() {
  const response = await fetch('https://api.transferwise.com/v1/profiles', {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  })

  if (!response.ok) {
    throw new Error(`Error obteniendo perfiles: ${response.status}`)
  }

  const profiles = await response.json()
  const businessProfile = profiles.find(p => p.type === 'BUSINESS' || p.type === 'business')
  return businessProfile ? businessProfile.id : profiles[0].id
}

async function testEndpoints() {
  try {
    const profileId = await getBusinessProfileId()
    console.log(`📊 Profile ID: ${profileId}\n`)

    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - 90) // 90 días atrás
    
    const startDateStr = startDate.toISOString().split('T')[0]
    const endDateStr = endDate.toISOString().split('T')[0]

    console.log(`📅 Rango de fechas: ${startDateStr} a ${endDateStr}\n`)

    // Primero probar sin parámetros de fecha
    console.log('🔍 Probando endpoint sin parámetros de fecha: /v1/profiles/{profileId}/activities')
    try {
      const response0 = await fetch(
        `https://api.transferwise.com/v1/profiles/${profileId}/activities?limit=10`,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      )

      console.log(`   Status: ${response0.status}`)
      if (response0.ok) {
        const data0 = await response0.json()
        const transactions0 = Array.isArray(data0) ? data0 : (data0.data || [])
        console.log(`   ✅ Transacciones encontradas (sin filtro de fecha): ${transactions0.length}`)
        if (transactions0.length > 0) {
          console.log(`   📋 Primera transacción:`, JSON.stringify(transactions0[0], null, 2))
        }
      } else {
        const errorText = await response0.text()
        console.log(`   ❌ Error: ${errorText}`)
      }
    } catch (error) {
      console.log(`   ❌ Excepción: ${error.message}`)
    }

    console.log('\n')

    // Endpoint 1: /v1/profiles/{profileId}/activities
    console.log('🔍 Probando endpoint 1: /v1/profiles/{profileId}/activities')
    try {
      const response1 = await fetch(
        `https://api.transferwise.com/v1/profiles/${profileId}/activities?start=${startDateStr}&end=${endDateStr}&limit=100`,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      )

      console.log(`   Status: ${response1.status}`)
      if (response1.ok) {
        const data1 = await response1.json()
        const transactions1 = Array.isArray(data1) ? data1 : (data1.data || [])
        console.log(`   ✅ Transacciones encontradas: ${transactions1.length}`)
        if (transactions1.length > 0) {
          console.log(`   📋 Primera transacción:`, JSON.stringify(transactions1[0], null, 2))
        }
      } else {
        const errorText = await response1.text()
        console.log(`   ❌ Error: ${errorText}`)
      }
    } catch (error) {
      console.log(`   ❌ Excepción: ${error.message}`)
    }

    console.log('\n')

    // Endpoint 2: /v1/profiles/{profileId}/transfers
    console.log('🔍 Probando endpoint 2: /v1/profiles/{profileId}/transfers')
    try {
      const response2 = await fetch(
        `https://api.transferwise.com/v1/profiles/${profileId}/transfers?createdDateStart=${startDateStr}&createdDateEnd=${endDateStr}&limit=100`,
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
        const transactions2 = Array.isArray(data2) ? data2 : (data2.data || [])
        console.log(`   ✅ Transacciones encontradas: ${transactions2.length}`)
        if (transactions2.length > 0) {
          console.log(`   📋 Primera transacción:`, JSON.stringify(transactions2[0], null, 2))
        }
      } else {
        const errorText = await response2.text()
        console.log(`   ❌ Error: ${errorText}`)
      }
    } catch (error) {
      console.log(`   ❌ Excepción: ${error.message}`)
    }

    console.log('\n')

    // Endpoint 3: /v3/profiles/{profileId}/balance-statements
    console.log('🔍 Probando endpoint 3: /v3/profiles/{profileId}/balance-statements')
    try {
      const response3 = await fetch(
        `https://api.transferwise.com/v3/profiles/${profileId}/balance-statements?currency=EUR&intervalStart=${startDateStr}T00:00:00.000Z&intervalEnd=${endDateStr}T23:59:59.999Z`,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      )

      console.log(`   Status: ${response3.status}`)
      if (response3.ok) {
        const data3 = await response3.json()
        console.log(`   ✅ Respuesta recibida`)
        console.log(`   📋 Estructura:`, JSON.stringify(data3, null, 2).substring(0, 500))
      } else {
        const errorText = await response3.text()
        console.log(`   ❌ Error: ${errorText}`)
      }
    } catch (error) {
      console.log(`   ❌ Excepción: ${error.message}`)
    }

    console.log('\n')

    // Endpoint 4: /v1/profiles/{profileId}/statement
    console.log('🔍 Probando endpoint 4: /v1/profiles/{profileId}/statement')
    try {
      const response4 = await fetch(
        `https://api.transferwise.com/v1/profiles/${profileId}/statement?currency=EUR&intervalStart=${startDateStr}T00:00:00.000Z&intervalEnd=${endDateStr}T23:59:59.999Z`,
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      )

      console.log(`   Status: ${response4.status}`)
      if (response4.ok) {
        const data4 = await response4.json()
        console.log(`   ✅ Respuesta recibida`)
        console.log(`   📋 Estructura:`, JSON.stringify(data4, null, 2).substring(0, 500))
      } else {
        const errorText = await response4.text()
        console.log(`   ❌ Error: ${errorText}`)
      }
    } catch (error) {
      console.log(`   ❌ Excepción: ${error.message}`)
    }

  } catch (error) {
    console.error('\n❌ Error general:', error.message)
    console.error(error.stack)
  }
}

testEndpoints()

