import { NextResponse, type NextRequest } from 'next/server'
import { fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { OrigenError, SecretoOrigen, type ContextoOrigen } from '@/lib/stock-sync/origenes'
import { conectorImap } from '@/lib/stock-sync/origenes/imap'
import { MAX_FICHERO_BYTES } from '@/lib/stock-sync/proceso'

/**
 * PROBAR UN BUZÓN QUE TODAVÍA NO EXISTE.
 *
 * Es la ruta del formulario de alta: se teclea el servidor, el usuario y la
 * contraseña, se pulsa «Probar» y se ve si se entra ANTES de guardar nada.
 * Obligar a guardar primero deja buzones a medias en el catálogo cada vez que
 * alguien se equivoca de servidor, y deja contraseñas equivocadas guardadas en
 * el ERP, que es peor.
 *
 *
 * ============ NO LEE NINGUNA CREDENCIAL GUARDADA. NINGUNA. ============
 *
 * Aquí el destino lo elige quien manda la petición, así que la contraseña TIENE
 * que venir también en el cuerpo. No hay ni un `leerCredencialBuzon` en este
 * fichero, y no puede haberlo nunca.
 *
 * Por eso son dos rutas y no una: la hermana,
 * /api/stock-sync/buzones/[id]/probar, es la contraria —coge el destino de la
 * fila de la base y solo admite del cuerpo una contraseña tecleada—. NO SE
 * UNIFICAN.
 *
 * EL MOTIVO, QUE ES TODO EL MOTIVO: nunca pueden coexistir en la misma llamada
 * «el destino lo elige quien manda la petición» y «la contraseña sale de la
 * tabla cifrada». Ese par convierte una ruta en un exfiltrador de contraseñas de
 * clientes: bastaría un POST con el host de quien llama y sin contraseña en el
 * cuerpo para que el ERP sacara la contraseña cifrada de un buzón de un cliente
 * y la entregara EN CLARO a ese servidor. credenciales-buzon.ts promete que una
 * contraseña guardada no se puede volver a ver, solo sustituir, y esa promesa se
 * sostiene aquí o no se sostiene.
 *
 * La contraseña que entra por aquí ya la sabe quien la escribe, así que puede
 * probarla contra el servidor que quiera: no es nuestra y no sale de ninguna
 * tabla. Del navegador al servidor es la única dirección en la que una
 * contraseña puede viajar, y va por HTTPS como el resto. Lo que NO pasa aquí es
 * guardarla: eso lo hace, y solo si se pide, la ruta de la credencial.
 *
 *
 * ============ SOLO IMAP, Y NO ES UNA LIMITACIÓN QUE FALTE POR QUITAR ========
 *
 * Un buzón de Gmail no tiene contraseña que teclear: se entra por la delegación
 * de dominio de la cuenta de servicio. No hay nada que probar antes de guardarlo,
 * así que se da de alta y se prueba con la ruta hermana, que sí sabe hacerlo.
 */
export const dynamic = 'force-dynamic'
// nodejs y no edge: imapflow abre un socket TCP contra el servidor de correo, y
// en edge no hay sockets.
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as {
      config?: unknown
      secreto?: unknown
    }

    const entrada = esObjeto(body.config) ? body.config : {}

    if (entrada.transporte === 'google') {
      return fail(
        400,
        'Un buzón de Gmail no lleva contraseña: se entra por la API con la delegación de dominio. ' +
          'Dale de alta y pulsa «Probar» en la lista, que es donde se comprueba que Google nos deja ' +
          'leer esa dirección.'
      )
    }

    if (typeof body.secreto !== 'string' || body.secreto === '') {
      return fail(
        400,
        'Escribe la contraseña del buzón para probarlo. Aquí no se usa ninguna contraseña guardada: ' +
          'el servidor lo estás eligiendo tú en este formulario, y una contraseña de un cliente no ' +
          'puede viajar a un servidor que no sea el suyo.'
      )
    }

    const host = texto(entrada.host)
    if (!host) {
      return fail(400, 'Falta el servidor del buzón (por ejemplo imap.hostinger.com)')
    }

    // El login es el usuario si se ha puesto, y si no la dirección: esa columna
    // solo se rellena en los proveedores raros cuyo login no es el correo, y en
    // los demás mandar una cadena vacía haría que el conector se quejara de que
    // falta el usuario en un buzón perfectamente escrito. Es lo mismo que hace
    // loginDe() con la fila guardada.
    const usuario = texto(entrada.usuario) || texto(entrada.direccion)
    if (!usuario) {
      return fail(400, 'Falta la dirección del buzón, que es con lo que se entra en casi todos los servidores')
    }

    const puerto = leerPuerto(entrada.puerto)
    if (puerto === 'mal') {
      return fail(
        400,
        'El puerto tiene que ser un número entre 1 y 65535. Déjalo vacío y se usará 993, que es el cifrado.'
      )
    }

    /**
     * El config se arma CAMPO A CAMPO y nunca con un spread de lo que ha
     * llegado. Lo que no se copia no puede llegar al conector: un `dias` de
     * cuatro cifras o un campo que mañana signifique algo distinto no tienen por
     * dónde entrar.
     *
     * Sin filtros de remitente ni de asunto a propósito: lo que se prueba aquí
     * es SI SE ENTRA en el buzón, no si el cliente ya mandó su fichero.
     */
    const ctx: ContextoOrigen = {
      config: {
        host,
        puerto,
        usuario,
        carpeta: texto(entrada.carpeta) || 'INBOX',
        seguro: entrada.seguro !== false && entrada.seguro !== 'false',
      },
      // No hay perfil ni buzón todavía: el nombre es solo para redactar los
      // mensajes de error del conector.
      perfil: texto(entrada.direccion) || usuario,
      // Los dos a null Y ES IMPORTANTE: son las llaves con las que los
      // conectores buscan una credencial GUARDADA, y esta ruta no lee ninguna.
      perfilId: null,
      buzonId: null,
      maxBytes: MAX_FICHERO_BYTES,
      subida: null,
      /**
       * La contraseña va envuelta en SecretoOrigen y no pelada: esa clase tiene
       * pisados `toString` y `toJSON`, así que si acaba dentro de un mensaje de
       * error o de un console.log sale «credencial oculta».
       */
      secretoEnPantalla: new SecretoOrigen('password', body.secreto, null),
    }

    // Un servidor que no contesta NO es un error de la petición: la petición ha
    // funcionado y la respuesta es el diagnóstico. Un 400 haría que la pantalla
    // lo pintara como un fallo del ERP.
    return NextResponse.json(await conectorImap.comprobar(ctx))
  } catch (error) {
    // El mismo criterio que la ruta hermana: el OrigenError sale con su mensaje
    // porque lo escribimos nosotros y ya está tachado; lo demás se registra en
    // el servidor y a la pantalla va una frase fija, porque por aquí pasa la
    // contraseña de un cliente y los errores de imapflow no los redactamos.
    if (error instanceof OrigenError) {
      return NextResponse.json({ ok: false, mensaje: error.message, candidatos: [] })
    }
    console.error('Error probando un buzón sin guardar:', error)
    return fail(500, 'No se ha podido probar el buzón. Vuelve a intentarlo y avisa si sigue fallando')
  }
}

/* ------------------------------------------------------------------ */

function esObjeto(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

function texto(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

/** Vacío es null: el conector lo entiende como «993 si cifra, 143 si no» */
function leerPuerto(raw: unknown): number | null | 'mal' {
  if (raw === null || raw === undefined || raw === '') return null
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 65535) return 'mal'
  return n
}
