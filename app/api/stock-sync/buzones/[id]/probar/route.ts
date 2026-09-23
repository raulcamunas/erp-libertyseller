import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { anotarPrueba, leerBuzon, loginDe } from '@/lib/stock-sync/buzones'
import { OrigenError, SecretoOrigen, type ContextoOrigen } from '@/lib/stock-sync/origenes'
import { conectorCorreo } from '@/lib/stock-sync/origenes/correo'
import { conectorImap } from '@/lib/stock-sync/origenes/imap'
import { leerCredencialBuzon } from '@/lib/stock-sync/origenes/credenciales-buzon'
import { MAX_FICHERO_BYTES } from '@/lib/stock-sync/proceso'

/**
 * PROBAR UN BUZÓN QUE YA ESTÁ DADO DE ALTA.
 *
 *
 * ============ EL DESTINO SALE DE LA FILA. SIEMPRE. ============
 *
 * Esta ruta coge el servidor, el puerto y el usuario de la FILA DE LA BASE, y
 * del cuerpo admite UNA SOLA COSA: una contraseña tecleada. Jamás acepta un
 * destino que venga en la petición.
 *
 * Y por eso hay una segunda ruta, /api/stock-sync/buzones/probar, que es la
 * contraria: exige el destino Y la contraseña en el cuerpo, y no lee ninguna
 * credencial guardada. Son dos a propósito y NO se unifican.
 *
 * EL MOTIVO, QUE ES TODO EL MOTIVO: nunca pueden coexistir en la misma llamada
 * «el destino lo elige quien manda la petición» y «la contraseña sale de la
 * tabla cifrada». Ese par convierte una ruta en un exfiltrador de contraseñas de
 * clientes: un POST con {"config":{"host":"mi-servidor.com"}} y sin contraseña
 * en el cuerpo haría que el ERP leyera la contraseña cifrada del buzón del
 * cliente y la entregara EN CLARO a un servidor elegido por quien llama.
 * credenciales-buzon.ts promete que una contraseña guardada no se puede volver a
 * ver, solo sustituir, y esa promesa se sostiene aquí o no se sostiene.
 *
 * La misma regla, escrita para los perfiles, está en
 * app/api/stock-sync/perfiles/[id]/explorar/route.ts. Aquí es más sencilla de
 * cumplir: como el destino NO se admite del cuerpo, no hay nada que comparar.
 *
 * Y por el otro lado queda cerrado también: editar el host de un buzón que
 * tiene contraseña guardada la BORRA (ver la cabecera de ../route.ts), así que
 * tampoco se puede mover el destino primero y probar después.
 *
 *
 * ============ UN BUZÓN AL QUE NO SE LLEGA NO ES UN ERROR DE LA PETICIÓN =====
 *
 * Contesta 200 con `ok: false` y el motivo. La petición ha funcionado; la
 * respuesta es un diagnóstico. Un 400 haría que la pantalla lo pintara como un
 * fallo del ERP en vez de como lo que es: «este servidor rechaza la contraseña».
 * Es lo mismo que hace la ruta del explorador de perfiles.
 *
 * El resultado se APUNTA en la fila (anotarPrueba), porque un buzón que se probó
 * bien hace tres semanas, con la contraseña caducada ayer, no es un buzón que
 * funcione — y esa es justo la pregunta que se hace quien mira la lista.
 */
export const dynamic = 'force-dynamic'
// nodejs y no edge: imapflow abre un socket TCP contra el servidor de correo, y
// en edge no hay sockets.
export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session
    if (!UUID.test(params.id)) return fail(400, 'Ese buzón no existe')

    const buzon = await leerBuzon(params.id)
    if (!buzon) return fail(404, 'Ese buzón ya no existe. Recarga la pantalla.')

    const body = (await request.json().catch(() => ({}))) as { secreto?: unknown }
    const tecleada =
      typeof body.secreto === 'string' && body.secreto !== ''
        ? new SecretoOrigen('password', body.secreto, null)
        : null

    /**
     * EN LOS DE GOOGLE NO HAY CONTRASEÑA QUE PROBAR.
     *
     * Se entra por la API de Gmail con la delegación de dominio de la cuenta de
     * servicio, así que lo que se comprueba es otra cosa: que Google nos deje
     * suplantar esa dirección. Se pasa por `conectorCorreo` con el `buzonId`
     * puesto, que es quien sabe hacer eso.
     *
     * Y si llega una contraseña tecleada se dice que no en vez de ignorarla: una
     * contraseña que se manda y no se usa parece guardada, y quien la escribió
     * se quedaría esperando a que sirviera para algo.
     */
    if (buzon.transporte !== 'imap') {
      if (tecleada) {
        return fail(
          400,
          `El buzón «${buzon.nombre}» se lee por la API de Gmail y no usa contraseña. Si en realidad ` +
            'es un buzón de otro proveedor, cámbialo a IMAP y ponle su servidor.'
        )
      }

      /**
       * El config va VACÍO, y eso es lo correcto: desde la 198 el conector saca
       * la dirección de la fila del buzón (`ctx.buzonId`), nunca de aquí. Pasarle
       * `{ buzon: … }` no haría daño —no lo leería— pero haría creer que el buzón
       * viaja por el cuerpo, que es justo lo contrario de lo que protege la
       * cabecera de esta ruta. Y desde el arreglo del buzón heredado esa clave sí
       * significa algo en otro sitio, así que dejarla aquí sería una pista falsa.
       */
      const estado = await conectorCorreo.comprobar(contexto(buzon.nombre, params.id, {}, null))
      await anotarPrueba(params.id, estado.ok, estado.ok ? null : estado.mensaje)
      return NextResponse.json(estado)
    }

    /**
     * La tecleada manda sobre la guardada: es lo que permite corregir una
     * contraseña y comprobarla ANTES de decidir guardarla. Es seguro porque el
     * destino no se puede mover desde el cuerpo — ver la cabecera.
     */
    const secreto = tecleada ?? (await leerCredencialBuzon(params.id))
    if (!secreto) {
      const mensaje =
        `El buzón «${buzon.nombre}» no tiene contraseña guardada. Escríbela y vuelve a probar: sin ` +
        'ella el ciclo automático no va a poder leer nada de aquí.'
      await anotarPrueba(params.id, false, mensaje)
      return NextResponse.json({ ok: false, mensaje, candidatos: [] })
    }

    /**
     * El config se arma A MANO, campo a campo, con los datos de la fila.
     *
     * `loginDe()` y no `buzon.usuario` a secas: esa columna solo se rellena en
     * los proveedores raros cuyo login no es el correo, y en los demás el
     * usuario ES la dirección. Mandar una cadena vacía haría que el conector se
     * quejara de que falta el usuario en un buzón perfectamente configurado.
     *
     * Sin filtros de remitente ni de asunto a propósito: lo que se prueba aquí
     * es SI SE ENTRA en el buzón, no si el cliente mandó su fichero hoy. El
     * filtro es cosa del perfil, y meterlo aquí haría que un buzón que funciona
     * saliera en rojo porque el correo de esta semana aún no ha llegado.
     */
    const estado = await conectorImap.comprobar(
      contexto(
        buzon.nombre,
        params.id,
        {
          host: buzon.host,
          puerto: buzon.puerto,
          usuario: loginDe(buzon),
          carpeta: buzon.carpeta,
          seguro: buzon.seguro,
        },
        secreto
      )
    )

    await anotarPrueba(params.id, estado.ok, estado.ok ? null : estado.mensaje)
    return NextResponse.json(estado)
  } catch (error) {
    /**
     * Un OrigenError SÍ sale con su mensaje: está escrito en español, dice qué
     * hacer y ya ha pasado por el tachado del conector.
     *
     * TODO LO DEMÁS SALE GENÉRICO, Y AQUÍ NO VALE errorResponse: ese ayudante
     * reenvía el `message` de cualquier Error tal cual (lib/amazon/api.ts), y
     * por esta ruta pasan errores de imapflow, de la librería de cifrado y de
     * Postgres que nadie ha tachado — y por ella pasa también, en claro y
     * durante la llamada, la contraseña de un cliente. El texto se queda en el
     * registro del servidor, que es donde sirve para algo.
     */
    if (error instanceof OrigenError) {
      return NextResponse.json({ ok: false, mensaje: error.message, candidatos: [] })
    }
    console.error('Error probando un buzón:', error)
    return fail(500, 'No se ha podido probar el buzón. Vuelve a intentarlo y avisa si sigue fallando')
  }
}

/**
 * El contexto del conector, armado a mano.
 *
 * `perfilId` va a null Y ES IMPORTANTE: es la llave con la que los conectores
 * buscan la credencial de un PERFIL, y aquí no estamos probando ningún perfil.
 * Con un id ahí, el conector podría acabar usando la contraseña del SFTP de un
 * cliente para entrar en un buzón, que no tiene ningún sentido y sería la
 * contraseña de un cliente viajando a donde no le toca.
 *
 * La contraseña viaja como `secretoEnPantalla` porque es el único hueco del
 * contexto por el que un conector acepta una credencial ya resuelta. El nombre
 * se queda corto para este uso —aquí puede venir de la tabla cifrada— pero el
 * camino es el mismo y el tipo, `SecretoOrigen`, tiene pisados `toString` y
 * `toJSON`: si acaba dentro de un mensaje de error o de un console.log, sale
 * «credencial oculta» y no la contraseña del cliente.
 */
function contexto(
  nombre: string,
  buzonId: string,
  config: Record<string, unknown>,
  secreto: SecretoOrigen | null
): ContextoOrigen {
  return {
    config,
    perfil: nombre,
    perfilId: null,
    buzonId,
    maxBytes: MAX_FICHERO_BYTES,
    subida: null,
    secretoEnPantalla: secreto,
  }
}
