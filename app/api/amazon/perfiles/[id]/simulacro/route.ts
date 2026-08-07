import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { StockSyncError } from '@/lib/stock-sync/engine'
import { OrigenError } from '@/lib/stock-sync/origenes'
import { loadPerfil } from '@/lib/stock-sync/perfiles'
import { procesarPerfil } from '@/lib/stock-sync/proceso'
import { leerSubidaOpcional } from '@/lib/stock-sync/subidas'

/**
 * EL SIMULACRO: QUÉ SE MANDARÍA, SIN MANDARLO.
 *
 * Lee, aplica las reglas, cruza, CONTRASTA CONTRA EL CATÁLOGO QUE AMAZON TIENE
 * AHORA MISMO y evalúa los frenos. Y ahí se para: esta ruta no llama a
 * sendChanges() por ningún camino. No es una comprobación pendiente de
 * implementar, es el diseño — encender el envío es una decisión aparte, por
 * cliente, y hoy nace apagada porque la escritura de precio contra Amazon
 * todavía no se ha validado con una cuenta real.
 *
 * Deja su fila en stock_profile_runs igualmente, con estado 'simulacro',
 * 'sin_cambios' o 'frenado'. Un cliente frenado tres días seguidos tiene que
 * verse en el historial, no solo en los logs.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Más margen que «Probar» porque aquí, además de parsear el Excel, se traen el
 * mapeo entero y el espejo del catálogo, que son dos consultas paginadas.
 */
export const maxDuration = 120

/**
 * Topes de lo que viaja de vuelta.
 *
 * El resumen lleva SIEMPRE los totales de verdad; esto solo recorta las listas
 * del detalle. Sin el tope, un cliente de 40.000 referencias devolvería una
 * respuesta de decenas de megas que el navegador tarda más en pintar que el
 * servidor en calcularla — y la tabla se mira filtrada, no entera.
 */
const MAX_FILAS = 3000
const MAX_HUERFANOS = 500
const MAX_SIN_CASAR = 500

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    if (!UUID.test(params.id)) return fail(400, 'Ese perfil no existe')

    const perfil = await loadPerfil(params.id)
    if (!perfil) return fail(404, 'Ese perfil ya no existe')

    const form = await request.formData()
    const subida = await leerSubidaOpcional(form, ['fichero', 'stock', 'file'], 'El fichero de stock')
    const subidaEan = await leerSubidaOpcional(form, ['ean'], 'El fichero de códigos de barras')

    const resultado = await procesarPerfil({
      perfil,
      subida,
      subidaEan,
      userId: session.userId,
    })

    const { simulacro } = resultado

    return NextResponse.json({
      ...resultado,
      simulacro: {
        ...simulacro,
        filas: simulacro.filas.slice(0, MAX_FILAS),
        huerfanos: simulacro.huerfanos.slice(0, MAX_HUERFANOS),
        sinCasar: simulacro.sinCasar.slice(0, MAX_SIN_CASAR),
        // Los cambios no viajan: son el mismo dato que las filas y solo servirían
        // para que el navegador tuviera una copia de lo que se enviaría. El envío
        // de verdad lo hace el ciclo automático (lib/stock-sync/ciclo.ts) con la
        // lista que calcula EL SERVIDOR a partir del perfil y el fichero, nunca
        // con una que haya pasado por el navegador.
        cambios: [],
      },
      recortado: {
        filas: simulacro.filas.length > MAX_FILAS,
        huerfanos: simulacro.huerfanos.length > MAX_HUERFANOS,
        sinCasar: simulacro.sinCasar.length > MAX_SIN_CASAR,
      },
    })
  } catch (error) {
    if (error instanceof StockSyncError) return fail(400, error.message)
    if (error instanceof OrigenError) {
      return NextResponse.json(
        { error: error.message, esDeAcceso: error.esDeAcceso },
        { status: 400 }
      )
    }

    console.error('Error simulando un perfil de lectura:', error)
    return fail(
      500,
      'No se ha podido completar el simulacro. Vuelve a intentarlo y avisa si sigue fallando'
    )
  }
}
