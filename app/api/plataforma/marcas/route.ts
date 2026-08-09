import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { registrarEvento } from '@/lib/plataforma/eventos'
import {
  FALTA_MIGRACION_MARCAS,
  estadoDelEnriquecido,
  guardarMarcasPropias,
  marcasDeCliente,
  marcasPropiasDe,
} from '@/lib/plataforma/marcas'
import { faltaEsquema } from '@/lib/plataforma/pantallas'

/**
 * LAS MARCAS PROPIAS DEL CLIENTE: VERLAS Y DECIDIRLAS.
 *
 * Solo admin, y SIEMPRE DE UN CLIENTE. No hay ni va a haber una vista que
 * mezcle las marcas de varios: los datos de un vendedor se usan para operar SU
 * cuenta, y una lista de «las marcas que más pesan en la agencia» ya sería
 * cruzar catálogos de clientes distintos.
 *
 *
 * ============ LO QUE SE ESCRIBE DESDE AQUÍ ============
 *
 * La lista de marcas propias, y como consecuencia el indicador de cada
 * referencia. Nada más. Esta ruta NO habla con Amazon: qué marcas son del
 * cliente es una decisión nuestra sobre nuestros propios datos.
 *
 * GUARDAR SÍ RECALCULA, al revés que el criterio de SKU activos. Es a propósito
 * y está razonado en marcas.ts: dejar la lista guardada y el catálogo sin
 * clasificar hasta el próximo barrido deja la pantalla diciendo una cosa y los
 * datos otra, y en ese hueco el BSR se mide sobre el conjunto equivocado. El
 * recálculo son dos consultas y unos cuantos UPDATE por lotes, no un barrido
 * contra Amazon: cabe de sobra en una petición.
 */
export const dynamic = 'force-dynamic'

/** Tope de marcas propias de un cliente. Por encima de esto no es una lista de
    marcas propias: es un catálogo entero pegado, y eso es otra pantalla */
const MAX_MARCAS = 500

/* ------------------------------------------------------------------ */
/* Ver                                                                 */
/* ------------------------------------------------------------------ */

export async function GET(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const clientId = request.nextUrl.searchParams.get('clientId') ?? ''
    if (!UUID.test(clientId)) return fail(400, 'Elige el cliente cuyas marcas quieres ver')

    // Los dos a la vez: el resumen contesta «qué hay» y los barridos contestan
    // «por qué no hay más», que es la pregunta de verdad los primeros días.
    const [resumen, barridos] = await Promise.all([
      marcasDeCliente(clientId),
      estadoDelEnriquecido(clientId),
    ])

    return NextResponse.json({ ...resumen, barridos, leidoAt: new Date().toISOString() })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTA_MIGRACION_MARCAS)
    return errorResponse(error, 'Error leyendo las marcas del cliente')
  }
}

/* ------------------------------------------------------------------ */
/* Guardar la lista                                                    */
/* ------------------------------------------------------------------ */

export async function PATCH(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as {
      clientId?: unknown
      marcas?: unknown
    }

    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : ''
    if (!UUID.test(clientId)) return fail(400, 'Ese cliente no es válido')

    // Se exige un array, aunque venga vacío. `undefined` NO se interpreta como
    // «ninguna»: un cuerpo mal formado borraría la lista entera del cliente sin
    // que nadie lo hubiera pedido, y eso apaga el BSR de sus productos.
    if (!Array.isArray(body.marcas)) {
      return fail(400, 'Falta la lista de marcas. Manda un array, aunque esté vacío')
    }
    const marcas = body.marcas.filter((m): m is string => typeof m === 'string')
    if (marcas.length > MAX_MARCAS) {
      return fail(400, `Una lista de marcas propias admite ${MAX_MARCAS} entradas como mucho`)
    }

    const antes = await marcasPropiasDe(clientId)

    const { marcas: guardadas, listingsTocados } = await guardarMarcasPropias({
      clientId,
      marcas,
      userId: session.userId,
    })

    const [resumen, barridos] = await Promise.all([
      marcasDeCliente(clientId),
      estadoDelEnriquecido(clientId),
    ])

    // El mensaje dice lo que ha pasado en el CATÁLOGO, no en la lista: guardar
    // cuatro marcas sin que se mueva ninguna referencia es un resultado
    // perfectamente normal —el catálogo aún no está enriquecido, o las
    // referencias están marcadas a mano— y hay que poder distinguirlo de que no
    // haya guardado.
    let mensaje: string
    if (listingsTocados > 0) {
      mensaje = `Guardado. ${listingsTocados} ${
        listingsTocados === 1 ? 'referencia ha cambiado' : 'referencias han cambiado'
      } de clasificación.`
    } else if (!resumen.enriquecido) {
      mensaje =
        'Guardado. Todavía no ha cambiado ninguna referencia porque el catálogo no tiene marcas: ' +
        'las rellena el barrido semanal, y en cuanto pase se clasifican solas.'
    } else if (resumen.manuales > 0) {
      mensaje = `Guardado. No ha cambiado ninguna referencia; ${resumen.manuales} están marcadas a mano y el recálculo no las toca.`
    } else {
      mensaje = 'Guardado. Ninguna referencia ha cambiado de clasificación.'
    }

    await registrarEvento({
      tipo: 'marcas_propias_cambiadas',
      // Info y no aviso: lo ha hecho una persona que está mirando la pantalla.
      // Por el trigger de la 123, un evento con autor no hace sonar la campana.
      severidad: 'info',
      clientId,
      mensaje: `Marcas propias del cliente: ${guardadas} en la lista. ${listingsTocados} referencias reclasificadas.`,
      detalle: {
        antes: antes.map((m) => m.marca),
        ahora: [...new Set(marcas.map((m) => m.trim()).filter((m) => m !== ''))],
        listingsTocados,
      },
      createdBy: session.userId,
      // Sin huella estable: cada cambio de la lista es un suceso distinto y
      // tiene que quedar constancia de todos, no solo del primero.
      huella: `marcas_propias_cambiadas·${Date.now()}`,
    })

    return NextResponse.json({
      ...resumen,
      barridos,
      listingsTocados,
      marcasGuardadas: guardadas,
      mensaje,
      leidoAt: new Date().toISOString(),
    })
  } catch (error) {
    if (faltaEsquema(error)) return fail(503, FALTA_MIGRACION_MARCAS)
    if ((error as { code?: string })?.code === '23503') {
      return fail(404, 'Ese cliente ya no existe')
    }
    return errorResponse(error, 'Error guardando las marcas propias del cliente')
  }
}
