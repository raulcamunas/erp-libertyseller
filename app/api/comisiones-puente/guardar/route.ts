import { NextResponse, type NextRequest } from 'next/server'
import { exigirSoloAdmin } from '@/lib/comisiones-puente/acceso'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { guardarComision, leerEstadoDelMes } from '@/lib/comisiones-puente/datos'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Más que esto no es una comisión: es un dedo en el teclado numérico */
const TOPE_COMISION = 1_000_000

/**
 * ESCRIBE LA COMISIÓN VALIDADA EN TESORERÍA. Y NADA MÁS.
 *
 *
 * ============ GUARDAR ES UN PASO APARTE DE CALCULAR ============
 *
 * A propósito, y es lo que pidió Raúl con sus palabras: «cuando la tenga y la
 * valide». Calcular no escribe nada en ninguna parte; esta ruta solo se llama
 * cuando alguien ha mirado el número y ha dicho que sí. Un guardado automático
 * al terminar el cálculo convertiría cualquier prueba —el fichero equivocado, el
 * mes equivocado— en un importe puesto en el mes que se va a facturar.
 *
 *
 * ============ EL `fee` NO SE TOCA. NI SE PROPONE ============
 *
 * Se escribe `commission` y solo `commission`. El fee es lo pactado con cada
 * cliente, lo pone Raúl a mano en Tesorería, y el ERP no tiene de dónde sacarlo.
 * Por eso aquí no viaja ni como campo opcional: lo que no se puede mandar no se
 * puede pisar por un cuerpo mal montado.
 *
 *
 * ============ EL IMPORTE LLEGA DEL NAVEGADOR, Y ESO ESTÁ PENSADO ============
 *
 * Es el número que el admin ha visto y validado en pantalla, no uno que el
 * servidor vuelva a deducir: si el servidor recalculara, podría guardar algo
 * distinto de lo que se aprobó, que es peor. Lo que sí hace esta ruta es
 * comprobar que sea un número de verdad, redondearlo a dos decimales una sola
 * vez y negarse si es absurdo. Y el listón de quién puede llamarla —admin o
 * socio, primera línea— es el que impide que ese número lo mande cualquiera.
 *
 * La cuenta de qué campo del cálculo es «la comisión» está en
 * `importeDeCalculo()` de lib/comisiones-puente/tipos.ts, porque Keslem devuelve
 * otro JSON —sin `summary`— y leerlo mal guardaría un cero sin dar ningún error.
 */
export async function POST(request: NextRequest) {
  const permiso = await exigirSoloAdmin()
  if (!permiso.ok) return fail(permiso.estado, permiso.mensaje)

  try {
    const cuerpo = (await request.json().catch(() => null)) as {
      clienteId?: string
      anio?: number
      mes?: number
      importe?: number
      /** true = «sí, pisa lo que había». Lo manda la pantalla tras preguntar */
      confirmar?: boolean
    } | null

    if (!cuerpo) return fail(400, 'No ha llegado nada que guardar')

    const clienteId = cuerpo.clienteId ?? ''
    const anio = Number(cuerpo.anio)
    const mes = Number(cuerpo.mes)
    const importe = Number(cuerpo.importe)

    if (!UUID.test(clienteId)) return fail(400, 'Falta el cliente')
    if (!Number.isInteger(anio) || anio < 2000 || anio > 2100) return fail(400, 'Ese año no vale')
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) return fail(400, 'Ese mes no vale')

    if (!Number.isFinite(importe)) {
      return fail(
        400,
        'No ha llegado ningún importe. Si el cálculo es de Keslem, la comisión está en ' +
          '`totalComision` y no en `summary`: mira la consola antes de volver a intentarlo.'
      )
    }
    if (importe < 0) return fail(400, 'Una comisión negativa no se puede facturar')
    if (importe > TOPE_COMISION) {
      return fail(400, `Ese importe (${importe} €) no parece una comisión. Repásalo.`)
    }

    const redondeado = Math.round(importe * 100) / 100

    const resultado = await guardarComision(
      clienteId,
      anio,
      mes,
      redondeado,
      cuerpo.confirmar === true
    )

    if (!resultado.ok) {
      return NextResponse.json(
        { error: resultado.mensaje, conflicto: resultado.conflicto ?? null },
        { status: resultado.estado }
      )
    }

    // Se devuelve el estado entero recién leído, no solo «ok»: la pantalla
    // repinta con esto y así el mes de Tesorería que enseña es el que hay en la
    // base, no el que la pantalla cree haber escrito.
    const estado = await leerEstadoDelMes(clienteId, anio, mes)

    return NextResponse.json({
      guardado: resultado.guardado,
      estado: 'noExiste' in estado ? null : estado,
    })
  } catch (error) {
    return errorResponse(error, 'Error guardando la comisión de un mes en Tesorería')
  }
}
