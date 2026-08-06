import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadEmployeesData, buildCostResponse } from '@/lib/employees/data'
import { monthSeries, currentMonthKey, monthKeyOf } from '@/lib/types/employees'

/**
 * LO QUE CUESTA EL EQUIPO CADA MES
 * ================================
 * Esta ruta existe por un motivo muy concreto, y sin ella Tesorería miente:
 *
 *   Tesorería la ven los admin Y los partner (is_admin_or_partner), pero las
 *   tablas de empleados son SOLO de admin: el desglose de lo que cobra cada
 *   persona no es asunto de un socio. Si el bloque «Empleados al mes» se
 *   consultara directamente contra Supabase desde el navegador, a un partner
 *   las políticas RLS le devolverían cero filas —sin error, sin aviso— y su
 *   Tesorería enseñaría unos 2.300 € menos de gasto al mes, con el beneficio
 *   y el reparto entre socios inflados en la misma cantidad. Un cero que
 *   parece un dato es peor que un fallo.
 *
 * Así que la separación se hace aquí, en el servidor:
 *   - admin   -> el total Y el desglose por persona.
 *   - partner -> SOLO el total del mes. Suficiente para que le cuadren el
 *                beneficio y su parte, sin ver el sueldo de nadie.
 *   - el resto -> 403.
 *
 * Tesorería se pinta ya con los meses precargados por su Server Component, así
 * que esta ruta se usa cuando el usuario se va a un mes que no venía cargado:
 * navegar hacia atrás en la gráfica de doce meses.
 *
 * El cálculo no se reimplementa aquí: sale de lib/employees/data.ts, que a su
 * vez usa lib/types/employees.ts y lib/payroll/cost.ts, los mismos que usan la
 * pantalla del módulo y el CRM. Si esta ruta hiciera sus propias cuentas,
 * Tesorería y Control empleados acabarían discrepando y no habría forma de
 * saber cuál mirar.
 */

// Depende de la sesión de quien llama, así que no se puede prerenderizar.
// Sin esto, `next build` intenta ejecutarla en frío, revienta al leer las
// cookies y deja un error rojo en el log de la compilación que no es tal.
export const dynamic = 'force-dynamic'

/** Tope de meses por llamada: un `months=99999` no puede tumbar el servidor */
const MAX_MONTHS = 36

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'No has iniciado sesión' }, { status: 401 })
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    const role = profile?.role
    if (role !== 'admin' && role !== 'partner') {
      return NextResponse.json(
        { error: 'Esta información es solo para dirección' },
        { status: 403 }
      )
    }

    // ---------- Qué meses se piden ----------
    const params = request.nextUrl.searchParams
    const period = params.get('period')
    const from = params.get('from')
    const months = Number(params.get('months') ?? 1)

    let periods: string[]
    if (period) {
      periods = [monthKeyOf(period)]
    } else if (from) {
      periods = monthSeries(monthKeyOf(from), Math.min(Math.max(months, 1), MAX_MONTHS))
    } else {
      periods = [currentMonthKey()]
    }

    const data = await loadEmployeesData(periods)

    // El rol sale de la sesión, nunca de la petición: el cliente no puede
    // pedir el desglose diciendo que es admin.
    return NextResponse.json(buildCostResponse(data, periods, role === 'admin'))
  } catch (error) {
    console.error('Error calculando el coste mensual de empleados:', error)
    return NextResponse.json(
      { error: 'No se ha podido calcular el coste del equipo' },
      { status: 500 }
    )
  }
}
