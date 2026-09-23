import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { leerBuzon } from '@/lib/stock-sync/buzones'
import { OrigenError } from '@/lib/stock-sync/origenes'
import {
  borrarCredencialBuzon,
  estadoCredencialBuzon,
  guardarCredencialBuzon,
} from '@/lib/stock-sync/origenes/credenciales-buzon'

/**
 * LA CONTRASEÑA DE UN BUZÓN.
 *
 * Dos verbos, y ninguno devuelve nunca el valor:
 *
 *   POST   → guardar o sustituir. Entra en claro, se cifra y se acabó.
 *   DELETE → quitarla.
 *
 * No hay GET, y no es un olvido: si HAY contraseña ya lo dice
 * `tieneContrasena` en la lista de buzones, que es lo único que la pantalla
 * necesita para avisar de que un buzón IMAP sin contraseña no va a leer nada.
 * Una ruta más que hable de credenciales es una ruta más donde equivocarse.
 *
 *
 * ============ POR QUÉ LA CONTRASEÑA ES DEL BUZÓN Y NO DEL PERFIL ============
 *
 * Un buzón de la agencia sirve a los perfiles de diez clientes. Con la
 * contraseña colgando del perfil habría que teclearla diez veces, y cambiarla el
 * día que caduque serían diez sitios — nueve de los cuales se quedarían sin
 * cambiar, y el fallo aparecería semanas después como «este cliente no recibe
 * stock» sin nada que lo relacione con aquel cambio.
 *
 *
 * ============ EL CATCH ES PROPIO Y NO errorResponse ============
 *
 * Y aquí importa más que en ninguna otra ruta de este árbol: el cuerpo de esta
 * petición ES una contraseña. `errorResponse` reenvía el `message` de cualquier
 * Error tal cual —está escrito en lib/amazon/api.ts y hay medio ERP apoyado en
 * ello— y un error de la librería de cifrado o de Postgres puede llevar dentro
 * un trozo del valor que no ha podido procesar. Se registra en el servidor, que
 * es donde sirve para algo, y a la pantalla va una frase fija.
 *
 * El OrigenError sí sale con su mensaje: lo escribimos nosotros, está en
 * español, dice qué hacer y no lleva el valor dentro.
 *
 *
 * ============ LO QUE NO SE HACE, Y ES DELIBERADO ============
 *
 * No se comprueba que la contraseña funcione antes de guardarla. Podría hacerse
 * —conectar y ver— pero entonces una contraseña BUENA con el servidor del
 * cliente caído no se podría guardar, y ese es el momento en que menos ganas hay
 * de pelearse con el ERP. Se guarda, y el botón de al lado prueba.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session
    if (!UUID.test(params.id)) return fail(400, 'Ese buzón no existe')

    const buzon = await leerBuzon(params.id)
    if (!buzon) return fail(404, 'Ese buzón ya no existe. Recarga la pantalla.')

    /**
     * Un buzón de Gmail NO tiene dónde guardar una contraseña, y decirlo aquí no
     * es quisquillosería: se entra por delegación de dominio con la cuenta de
     * servicio, así que una contraseña guardada ahí no la usaría nadie nunca.
     * Sería la contraseña de un cliente guardada sin ninguna razón — y lo que no
     * existe no se puede filtrar.
     */
    if (buzon.transporte !== 'imap') {
      return fail(
        400,
        `El buzón «${buzon.nombre}» está guardado como buzón de Gmail, y esos se leen por la ` +
          'delegación de dominio: no llevan contraseña. Si acabas de cambiarlo a IMAP en el ' +
          'formulario, ese cambio todavía no está grabado — dale a «Guardar» primero y luego ponle ' +
          'la contraseña.'
      )
    }

    const body = (await request.json().catch(() => null)) as { valor?: unknown } | null
    if (!body || typeof body.valor !== 'string' || body.valor === '') {
      return fail(400, 'No ha llegado ninguna contraseña que guardar')
    }

    const estado = await guardarCredencialBuzon({
      buzonId: params.id,
      valor: body.valor,
      userId: session.userId,
    })

    return NextResponse.json({ estado })
  } catch (error) {
    if (error instanceof OrigenError) return fail(400, error.message)
    // Ver «EL CATCH ES PROPIO» en la cabecera. Ni el error original ni un trozo.
    console.error('Error guardando la contraseña de un buzón:', error)
    return fail(
      500,
      'No se ha podido guardar la contraseña. Vuelve a intentarlo y avisa si sigue fallando'
    )
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session
    if (!UUID.test(params.id)) return fail(400, 'Ese buzón no existe')

    // Borrar la que no hay no es un error: es idempotente a propósito, para que
    // el botón «Quitar contraseña» no falle por pulsarlo dos veces.
    await borrarCredencialBuzon(params.id)

    return NextResponse.json({ estado: await estadoCredencialBuzon(params.id) })
  } catch (error) {
    if (error instanceof OrigenError) return fail(400, error.message)
    // El mismo criterio que el POST: por aquí pasan errores de la librería de
    // cifrado y de Postgres que nadie ha tachado.
    console.error('Error borrando la contraseña de un buzón:', error)
    return fail(
      500,
      'No se ha podido quitar la contraseña. Vuelve a intentarlo y avisa si sigue fallando'
    )
  }
}
