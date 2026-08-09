import { NextResponse } from 'next/server'
import { getBalances, getBalance } from '@/lib/wise'
import { requireAppAccess } from '@/lib/auth/api'

/**
 * Endpoint para obtener los saldos actuales de Wise en todas las monedas
 * GET /api/finance/balance
 *
 * QUÉ IMPIDE EL requireAppAccess() DE ABAJO
 * -----------------------------------------
 * Esta ruta no comprobaba nada, y middleware.ts (línea 41) declara pública toda
 * /api/. O sea que los saldos de la empresa se los llevaba cualquiera de
 * internet. Reproducido contra el código real, sin una sola cookie:
 *
 *     $ curl http://SERVIDOR/api/finance/balance
 *     HTTP 200 {"success":true,"balances":[...],"balance":...}
 *
 * y en el log del servidor quedó la prueba de que se llamó a la API de Wise DE
 * VERDAD, con la clave de la empresa: «Balances encontrados en Wise API: 5»
 * (COP, EUR, GBP, RON y USD). Ese día los cinco estaban a cero y el JSON salió
 * vacío, pero eso es suerte del saldo, no una defensa: el día que haya dinero
 * en la cuenta, sale en el JSON.
 *
 * POR QUÉ NO CAMBIA NADA PARA QUIEN LA USA
 * ----------------------------------------
 * El único llamante es components/finances/FinanceDashboard.tsx, que vive en
 * /dashboard/finances. Middleware ya cierra esa pantalla: los partners no
 * entran, y a un employee se le exige el permiso 'finances'. Aquí se pide
 * EXACTAMENTE lo mismo, ni más ni menos, porque el permiso tiene que mandar en
 * los dos caminos —pantalla y API— y hasta ahora solo mandaba en uno.
 *
 * Comprobado contra la base: hoy NADIE tiene el permiso 'finances', así que
 * quien abre Tesorería son los dos admins, y un admin pasa siempre.
 *
 * LOS console.log DEL PRINCIPIO
 * -----------------------------
 * Escribían en el log los diez primeros caracteres de WISE_API_KEY y el
 * WISE_PROFILE_ID. Un prefijo de diez caracteres no autentica por sí solo, pero
 * identifica la clave y ayuda a correlacionarla, y el log del panel lo lee más
 * gente de la que debería. Se quedan los que solo dicen si la variable existe,
 * que es lo único que hace falta para diagnosticar.
 *
 * POR QUÉ ADEMÁS `force-dynamic`
 * ------------------------------
 * El requireAppAccess() ya la hace dinámica —lee cookies— y el
 * prerender-manifest del build actual sale con CERO rutas /api estáticas, así
 * que esta línea no cambia nada hoy. Está porque el `catch (error: any)` de
 * abajo SE TRAGA el DynamicServerError y devuelve 200, con lo que el build
 * sigue escribiendo un `.next/server/app/api/finance/balance.body`. Hoy ese
 * fichero es inerte, pero el día que alguien mueva o quite la guarda, la ruta
 * vuelve a hornearse y a servir SALDOS CONGELADOS del momento del build sin
 * que nada avise —que es justo lo que pasaba antes: en producción el handler
 * no se ejecutaba nunca—. Con esto, esa vuelta atrás deja de depender de que
 * la guarda siga donde está.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const sesion = await requireAppAccess(
      'finances',
      'No tienes acceso a Tesorería'
    )
    if (sesion instanceof NextResponse) return sesion

    // Verificar que la variable de entorno esté configurada
    if (!process.env.WISE_API_KEY) {
      console.warn('WISE_API_KEY no configurado en el servidor')
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

