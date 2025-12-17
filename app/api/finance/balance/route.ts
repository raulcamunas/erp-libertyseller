import { NextResponse } from 'next/server'
import { getBalances, getBalance } from '@/lib/wise'

/**
 * Endpoint para obtener los saldos actuales de Wise en todas las monedas
 * GET /api/finance/balance
 */
export async function GET() {
  try {
    // Verificar que la variable de entorno esté configurada
    if (!process.env.WISE_API_KEY) {
      console.warn('WISE_API_KEY no configurado')
      return NextResponse.json(
        { 
          success: false,
          error: 'Wise API no configurada',
          message: 'Por favor, configura WISE_API_KEY en .env.local',
          balances: [],
          balance: null
        },
        { status: 200 } // Devolvemos 200 para que el frontend pueda manejar el error
      )
    }

    console.log('Obteniendo balances de Wise...')
    const balances = await getBalances()
    console.log('Balances obtenidos:', balances)

    // Mantener compatibilidad: también devolver el balance en EUR
    const eurBalance = balances.find(b => b.currency === 'EUR')
    const balance = eurBalance?.amount || 0

    return NextResponse.json({
      success: true,
      balances, // Todos los balances en diferentes monedas
      balance, // Balance en EUR (compatibilidad)
      currency: 'EUR'
    })
  } catch (error: any) {
    console.error('Error fetching Wise balances:', error)
    return NextResponse.json(
      { 
        success: false,
        error: 'Error al obtener saldos',
        message: error.message,
        balances: [],
        balance: null
      },
      { status: 200 } // Devolvemos 200 para que el frontend pueda manejar el error
    )
  }
}

