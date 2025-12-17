import { NextResponse } from 'next/server'
import { getBalances, getBalance } from '@/lib/wise'

/**
 * Endpoint para obtener los saldos actuales de Wise en todas las monedas
 * GET /api/finance/balance
 */
export async function GET() {
  try {
    // Debug: Ver todas las variables de entorno relacionadas con Wise
    console.log('=== DEBUG WISE API ===')
    console.log('WISE_API_KEY existe:', !!process.env.WISE_API_KEY)
    console.log('WISE_API_KEY valor (primeros 10 chars):', process.env.WISE_API_KEY ? process.env.WISE_API_KEY.substring(0, 10) + '...' : 'NO EXISTE')
    console.log('WISE_PROFILE_ID:', process.env.WISE_PROFILE_ID || 'NO CONFIGURADO')
    console.log('Todas las vars que empiezan con WISE:', Object.keys(process.env).filter(k => k.startsWith('WISE')))
    console.log('========================')
    
    // Verificar que la variable de entorno esté configurada
    if (!process.env.WISE_API_KEY) {
      console.warn('WISE_API_KEY no configurado en el servidor')
      console.warn('Variables de entorno disponibles:', Object.keys(process.env).filter(k => k.includes('WISE') || k.includes('API')))
      return NextResponse.json(
        { 
          success: false,
          error: 'Wise API no configurada',
          message: 'Por favor, configura WISE_API_KEY en Easypanel y reinicia el servicio',
          balances: [],
          balance: null
        },
        { status: 200 } // Devolvemos 200 para que el frontend pueda manejar el error
      )
    }

    console.log('Obteniendo balances de Wise...')
    console.log('WISE_API_KEY está configurado:', !!process.env.WISE_API_KEY)
    console.log('WISE_PROFILE_ID:', process.env.WISE_PROFILE_ID || 'No configurado')
    
    const balances = await getBalances()
    console.log('Balances obtenidos de Wise:', balances)
    console.log('Número de balances:', balances.length)

    if (!balances || balances.length === 0) {
      console.warn('No se encontraron balances en Wise')
      return NextResponse.json(
        {
          success: true,
          balances: [],
          balance: null,
          message: 'No se encontraron balances en la cuenta de Wise'
        },
        { status: 200 }
      )
    }

    // Mantener compatibilidad: también devolver el balance en EUR
    const eurBalance = balances.find(b => b.currency === 'EUR')
    const balance = eurBalance?.amount || 0

    console.log('Devolviendo respuesta con balances:', { balances, balance })

    return NextResponse.json({
      success: true,
      balances, // Todos los balances en diferentes monedas
      balance, // Balance en EUR (compatibilidad)
      currency: 'EUR'
    })
  } catch (error: any) {
    console.error('Error fetching Wise balances:', error)
    console.error('Error stack:', error.stack)
    return NextResponse.json(
      { 
        success: false,
        error: 'Error al obtener saldos',
        message: error.message || 'Error desconocido',
        balances: [],
        balance: null
      },
      { status: 200 } // Devolvemos 200 para que el frontend pueda manejar el error
    )
  }
}

