// Script para obtener el ID de la cuenta de empresa de Wise
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
  try {
    const response = await fetch('https://api.transferwise.com/v1/profiles', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    })

    if (!response.ok) {
      throw new Error(`Error: ${response.status}`)
    }

    const profiles = await response.json()
    
    console.log('\n📋 Perfiles encontrados:\n')
    profiles.forEach((profile, index) => {
      const isBusiness = profile.type === 'BUSINESS' || profile.type === 'business'
      const marker = isBusiness ? '✅ (EMPRESA)' : '   (Personal)'
      console.log(`${index + 1}. ID: ${profile.id}`)
      console.log(`   Tipo: ${profile.type} ${marker}`)
      if (profile.businessName) {
        console.log(`   Nombre: ${profile.businessName}`)
      } else if (profile.personalFirstName) {
        console.log(`   Nombre: ${profile.personalFirstName} ${profile.personalLastName || ''}`)
      }
      console.log('')
    })

    // Buscar perfil BUSINESS
    const businessProfile = profiles.find(p => 
      p.type === 'BUSINESS' || p.type === 'business' || p.type.toLowerCase() === 'business'
    )

    if (businessProfile) {
      console.log('✅ PERFIL DE EMPRESA ENCONTRADO:')
      console.log(`   ID: ${businessProfile.id}`)
      console.log(`   Nombre: ${businessProfile.businessName || 'Sin nombre'}`)
      console.log(`   Tipo: ${businessProfile.type}`)
      console.log('\n💡 Este es el ID que debes usar para la cuenta de empresa.')
      return businessProfile.id
    } else {
      console.log('⚠️  No se encontró un perfil de tipo BUSINESS.')
      console.log('   Usando el primer perfil disponible:')
      console.log(`   ID: ${profiles[0].id}`)
      console.log(`   Tipo: ${profiles[0].type}`)
      return profiles[0].id
    }
  } catch (error) {
    console.error('❌ Error:', error.message)
    process.exit(1)
  }
}

getBusinessProfileId()

