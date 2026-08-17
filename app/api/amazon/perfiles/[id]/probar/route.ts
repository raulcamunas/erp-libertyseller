import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { StockSyncError } from '@/lib/stock-sync/engine'
import { OrigenError } from '@/lib/stock-sync/origenes'
import { loadPerfil } from '@/lib/stock-sync/perfiles'
import { probarPerfil } from '@/lib/stock-sync/proceso'
import { leerSubidaOpcional } from '@/lib/stock-sync/subidas'

/**
 * EL BOTÓN DE «PROBAR».
 *
 * Lee el fichero con el perfil tal y como está configurado y devuelve QUÉ HA
 * ENTENDIDO: la hoja, la fila de cabecera, qué columna real se ha llevado cada
 * campo y las primeras filas ya interpretadas con las reglas puestas.
 *
 * No cruza, no contrasta contra Amazon y no escribe nada: es deliberadamente lo
 * más barato que se puede hacer con un fichero, porque es lo que se pulsa diez
 * veces seguidas mientras se ajustan los alias de las columnas.
 *
 * Sin esto, configurar un cliente es rellenar diez campos a ciegas y descubrir
 * el fallo al procesar, con un «no ha casado nada» del que no se sale.
 */
export const dynamic = 'force-dynamic'

// El motor usa Buffer y el parser de xlsx, que no existen en el runtime edge.
export const runtime = 'nodejs'

/**
 * Leer un Excel de 21.000 filas son milisegundos de cruce pero varios segundos
 * de parseo en una máquina cargada. El margen es para eso.
 *
 * Y SON 120 Y NO 60 DESDE QUE HAY ORÍGENES DE API. Aquí lo que tarda ya no es
 * el parseo: es el servidor del proveedor. El catálogo entero de Entrais son
 * 6.916 productos y tarda unos 48 segundos en contestar, o sea que con 60 el
 * botón «Probar» estaba a doce segundos de agotarse — y al agotarse no dice
 * «el proveedor tarda demasiado», dice un error de red genérico que manda a
 * buscar el fallo donde no está.
 *
 * Es el mismo margen que ya tenía el simulacro, que hace lo mismo y algo más.
 */
export const maxDuration = 120

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    if (!UUID.test(params.id)) return fail(400, 'Ese perfil no existe')

    const perfil = await loadPerfil(params.id)
    if (!perfil) return fail(404, 'Ese perfil ya no existe')

    const form = await request.formData()
    const subida = await leerSubidaOpcional(form, ['fichero', 'stock', 'file'], 'El fichero')

    const prueba = await probarPerfil({ perfil, subida })

    return NextResponse.json({ prueba })
  } catch (error) {
    return traducir(error)
  }
}

/**
 * Los dos errores esperables salen con su texto tal cual y un 400: están
 * escritos para que quien los lea sepa qué hacer, y aquí son la respuesta útil,
 * no un fallo del servidor.
 *
 *   StockSyncError -> el fichero no encaja con el perfil (se arregla mirando el Excel)
 *   OrigenError    -> no se llega al fichero (se arregla en Drive o en el servidor)
 */
function traducir(error: unknown): NextResponse {
  if (error instanceof StockSyncError) return fail(400, error.message)
  if (error instanceof OrigenError) {
    return NextResponse.json(
      { error: error.message, esDeAcceso: error.esDeAcceso },
      { status: 400 }
    )
  }

  console.error('Error probando un perfil de lectura:', error)
  return fail(
    500,
    'No se ha podido probar el perfil. Vuelve a intentarlo y avisa si sigue fallando'
  )
}
