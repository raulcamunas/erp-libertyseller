import { NextResponse } from 'next/server'
import { getBalance } from '@/lib/wise'

/**
 * Endpoint para obtener el saldo actual de Wise
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
          balance: null
        },
        { status: 200 } // Devolvemos 200 para que el frontend pueda manejar el error
      )
    }

    console.log('Obteniendo balance de Wise...')
    const balance = await getBalance()
    console.log('Balance obtenido:', balance)

    return NextResponse.json({
      success: true,
      balance,
      currency: 'EUR'
    })
  } catch (error: any) {
    console.error('Error fetching Wise balance:', error)
    return NextResponse.json(
      { 
        success: false,
        error: 'Error al obtener saldo',
        message: error.message,
        balance: null
      },
      { status: 200 } // Devolvemos 200 para que el frontend pueda manejar el error
    )
  }
}

