import { NextResponse, type NextRequest } from 'next/server'
import { exigirSoloAdmin } from '@/lib/comisiones-puente/acceso'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { planDeCalculo } from '@/lib/comisiones-puente/datos'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * PREPARA EL CÁLCULO DE UN MES. NO GUARDA NADA.
 *
 *
 * ============ POR QUÉ ESTA RUTA DEVUELVE UN PLAN Y NO EL RESULTADO ==========
 *
 * Porque el cálculo lo sigue disparando EL NAVEGADOR contra
 * `/api/commissions/process`, exactamente igual que lleva haciéndolo la
 * calculadora de siempre once veces al mes. Esta ruta hace todo lo demás:
 * comprueba el permiso, encuentra el informe de ese mes en Tax Reports, se niega
 * si falta, y devuelve los enlaces firmados de 60 segundos junto con el nombre
 * del campo del FormData en el que va cada fichero.
 *
 * LAS OTRAS DOS FORMAS DE HACERLO, Y POR QUÉ NO:
 *
 *   · FABRICAR UN `Request` Y LLAMAR AL POST DE process DESDE AQUÍ. Es la que
 *     más se parece a «no toco nada» y la que más se rompe sola: ese POST no es
 *     una función pura —hace `requireSession()` y `createClient()`, que leen las
 *     cookies del contexto de petición de Next—, así que invocarlo con un
 *     Request fabricado depende de que ese contexto se herede, cosa que no está
 *     garantizada entre versiones y que falla con un 401 que parece un problema
 *     de sesión del usuario.
 *
 *   · SACAR EL NÚCLEO DEL CÁLCULO A `lib/`. Es lo correcto en un mundo sin
 *     prisa y hoy es lo más arriesgado que se puede hacer: de esas 1.386 líneas
 *     salen las facturas de verdad, dentro hay casos escritos a mano cliente por
 *     cliente y NO HAY UN SOLO TEST que los cubra. Un error de refactor no da
 *     error: da un número distinto, ya facturado, que nadie mira. Si algún día
 *     se hace, primero se guardan los 42 informes de `commission_reports` como
 *     casos de prueba y se comprueba que el refactor devuelve el mismo céntimo
 *     en los 42.
 *
 * Con el plan, el camino de los datos es el que ya funciona y está probado, y si
 * algo falla aquí, falla en la pantalla nueva: la calculadora de siempre sigue
 * viva y no se ha tocado ni una línea de las 1.386.
 *
 * Lo que viaja al navegador es el mismo fichero que ya se baja hoy con el botón
 * «Descargar» de Tax Reports. No es un agujero nuevo, pero sí es el motivo de
 * que esta ruta sea de admin y no del permiso de Tax Reports.
 */
export async function POST(request: NextRequest) {
  const permiso = await exigirSoloAdmin()
  if (!permiso.ok) return fail(permiso.estado, permiso.mensaje)

  try {
    const cuerpo = (await request.json().catch(() => null)) as {
      clienteId?: string
      anio?: number
      mes?: number
      tasaManual?: string | null
      tramoBeneficio?: string | null
    } | null

    if (!cuerpo) return fail(400, 'No ha llegado nada que calcular')

    const clienteId = cuerpo.clienteId ?? ''
    const anio = Number(cuerpo.anio)
    const mes = Number(cuerpo.mes)

    if (!UUID.test(clienteId)) return fail(400, 'Falta el cliente')
    if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) return fail(400, 'Ese año no vale')
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) return fail(400, 'Ese mes no vale')

    const resultado = await planDeCalculo(clienteId, anio, mes, {
      tasaManual: cuerpo.tasaManual ?? null,
      tramoBeneficio: cuerpo.tramoBeneficio ?? null,
    })

    if (!resultado.ok) return fail(resultado.estado, resultado.mensaje)

    return NextResponse.json({ plan: resultado.plan, estado: resultado.estado })
  } catch (error) {
    return errorResponse(error, 'Error preparando el cálculo de comisiones de un mes')
  }
}
