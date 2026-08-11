import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { OrigenError } from '@/lib/stock-sync/origenes'
import { loadPerfil } from '@/lib/stock-sync/perfiles'
import { traerFichero } from '@/lib/stock-sync/proceso'

/**
 * BAJARSE EL FICHERO QUE EL ERP ESTÁ LEYENDO.
 *
 * Trae del origen —FTPS, SFTP, Drive, correo— exactamente el mismo fichero que
 * cogería el ciclo, y lo devuelve tal cual para abrirlo en Excel.
 *
 *
 * ============ POR QUÉ HACE FALTA ============
 *
 * Configurando un cliente pasó esto: la pantalla decía «stock leído: 0» en las
 * 4.773 filas y el Excel que el cliente había mandado por otro lado traía 402,
 * 2, 1. Dos fuentes y ninguna forma de saber cuál mentía.
 *
 * Y el fichero que hay que mirar NO es el que te pasa el cliente por WhatsApp:
 * es EL QUE HAY EN SU SERVIDOR AHORA MISMO, que puede ser de otro día, de otra
 * carpeta o directamente otro. Bajarlo por aquí es lo único que garantiza estar
 * mirando lo mismo que lee el ERP.
 *
 * La vista previa de la pantalla enseña quince filas, que resuelve el 90 % de
 * los casos. Esto es para el 10 % restante: buscar un artículo concreto,
 * comprobar un formato raro, contar cuántas filas traen algo.
 *
 *
 * ============ NO SE GUARDA EN NINGÚN SITIO ============
 *
 * El fichero pasa por memoria y sale hacia el navegador. No toca disco, no toca
 * la base y no queda en ningún registro: son datos de un cliente y no tienen por
 * qué acumularse en el servidor. El tope de tamaño es el mismo que el del ciclo
 * (traerFichero), así que un fichero que no cabría en una pasada tampoco se baja
 * — si reventara aquí, reventaría también al sincronizar y es mejor saberlo.
 */
export const dynamic = 'force-dynamic'

/** El motor usa Buffer y los conectores hablan SSH/TLS: nada de eso hay en edge */
export const runtime = 'nodejs'

/** Traer un fichero de un SFTP lento puede irse a medio minuto */
export const maxDuration = 60

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    if (!UUID.test(params.id)) return fail(400, 'Ese perfil no existe')

    const perfil = await loadPerfil(params.id)
    if (!perfil) return fail(404, 'Ese perfil ya no existe')

    /**
     * SE LO LLEVA AUNQUE ESTÉ ROTO, y esa es la única razón de este parámetro.
     *
     * El conector comprueba que el fichero haya llegado entero y corta si no.
     * Está bien para el ciclo —un .xlsx a medias no puede acabar publicando
     * stock— pero aplicado aquí rompía este botón EXACTAMENTE en el caso para
     * el que se hizo: cuando el fichero está mal y hay que abrirlo para saber
     * de quién es el problema. Pasó de verdad, con un stockOcio.xlsx de 212.355
     * bytes sin el final del zip.
     *
     * Aquí no se procesa nada: los bytes salen hacia el navegador y ahí acaba
     * el viaje. Un fichero roto sigue sin poder llegar a Amazon por este camino.
     */
    const fichero = await traerFichero(perfil, null, { aunqueEsteRoto: true })
    const bytes = fichero.bytes instanceof Uint8Array ? fichero.bytes : new Uint8Array()

    if (bytes.byteLength === 0) {
      return fail(
        400,
        `«${fichero.nombre}» está vacío en el origen (0 bytes). Suele ser que el ERP del cliente ` +
          'lo estaba escribiendo justo cuando hemos entrado.'
      )
    }

    return new NextResponse(bytes as unknown as BodyInit, {
      headers: {
        /**
         * `octet-stream` a propósito y no el tipo real del fichero.
         *
         * Con el tipo verdadero, el navegador puede decidir ABRIRLO en vez de
         * guardarlo —y un HTML o un SVG que viniera de un servidor de un cliente
         * se ejecutaría en el dominio del ERP, con la sesión del usuario puesta.
         * Aquí no se está previsualizando nada: se está descargando un fichero
         * que viene de fuera.
         */
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${nombreSeguro(fichero.nombre)}"`,
        'Content-Length': String(bytes.byteLength),
        // No se cachea: el fichero del origen cambia cada día y una copia vieja
        // en el navegador sería exactamente el malentendido que esto viene a
        // resolver.
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    if (error instanceof OrigenError) {
      return NextResponse.json(
        { error: error.message, esDeAcceso: error.esDeAcceso },
        { status: 400 }
      )
    }
    console.error('Error descargando el fichero de un perfil:', error)
    return fail(500, 'No se ha podido traer el fichero del origen. Vuelve a intentarlo')
  }
}

/**
 * El nombre, sin lo que pueda romper la cabecera.
 *
 * Un nombre con comillas o un salto de línea permite inyectar cabeceras HTTP, y
 * el nombre viene del servidor de un cliente: no es nuestro y no se controla.
 * Se quedan letras, números y los cuatro signos que aparecen en un nombre de
 * fichero real.
 */
function nombreSeguro(nombre: string): string {
  const limpio = nombre.replace(/[^\w.\- ]+/g, '_').trim()
  return limpio === '' ? 'fichero' : limpio.slice(0, 120)
}
