import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { conectorDe, OrigenError, SecretoOrigen } from '@/lib/stock-sync/origenes'
import type { SecretoEnviado } from '@/lib/stock-sync/origenes/respuestas'
import { loadPerfil } from '@/lib/stock-sync/perfiles'
import { MAX_FICHERO_BYTES } from '@/lib/stock-sync/proceso'

/**
 * EL EXPLORADOR DE ORÍGENES: «¿llegamos?» y «¿qué hay aquí dentro?».
 *
 * Son dos preguntas distintas y por eso van en la misma ruta con dos acciones,
 * no en dos rutas: las dos necesitan exactamente el mismo montaje —sesión, rol,
 * perfil, conector, configuración de pantalla, credencial— y separarlas sería
 * copiar ese montaje dos veces para que un día se separen.
 *
 *   'comprobar' → ¿se llega al fichero que este perfil va a procesar?
 *   'explorar'  → ¿qué hay dentro de esta carpeta? (para ir bajando y elegirla)
 *
 *
 * ============ LA CONFIGURACIÓN VIENE DE LA PANTALLA, NO DE LA BASE ============
 *
 * Y no es un detalle: es el fallo que va a pasar la primera vez con CADA cliente.
 * Con campos no controlados, el `mousedown` del botón dispara el `onBlur` del
 * input —que lanza un PATCH asíncrono— y el click dispara la comprobación, que
 * releería la fila ANTERIOR al PATCH. Resultado: «este perfil no tiene puesto el
 * servidor» para un servidor que se acaba de escribir. Está documentado en
 * components/amazon/PerfilConfig.tsx y aquí se sostiene el otro extremo.
 *
 *
 * ============ POR QUÉ LA CONTRASEÑA PUEDE VENIR EN EL CUERPO ============
 *
 * Porque el alta de un cliente es: se teclea host, usuario y contraseña, se
 * pulsa «Conectar» y se navega hasta encontrar la carpeta. Obligar a guardar la
 * contraseña ANTES de saber si funciona deja contraseñas equivocadas guardadas
 * en el ERP, que es peor.
 *
 * Del navegador al servidor es la única dirección en la que una contraseña puede
 * viajar, y va por HTTPS como el resto. Lo que NO pasa aquí es guardarla: eso lo
 * hace, y solo si se pide, PUT /api/stock-sync/perfiles/[id]/credencial. Y no
 * vuelve nunca hacia atrás: esta ruta no devuelve credenciales.
 *
 *
 * ============ LA CREDENCIAL GUARDADA SOLO VA AL DESTINO GUARDADO ============
 *
 * Esta es la regla que sostiene todo lo anterior, y es de una línea:
 *
 *     la contraseña que sale de la tabla cifrada solo se usa contra el servidor,
 *     el puerto y el usuario que están GUARDADOS en ese mismo perfil.
 *
 * Sin ella, mezclar «lo guardado» con «lo de la pantalla» convierte esta ruta en
 * un exfiltrador: un POST con `{"config":{"host":"mi-servidor.com"}}` y sin
 * secreto en el cuerpo haría que el conector leyera la credencial cifrada del
 * cliente y la entregara EN CLARO a un servidor elegido por quien manda la
 * petición. La contraseña no es nuestra: nos la confió el cliente, y credenciales.ts
 * promete que una vez guardada no se puede volver a ver, solo sustituir.
 *
 * Así que cuando el cuerpo NO trae contraseña y el conector necesita una, los
 * campos de DESTINO que declara el conector (`clavesDestino`) tienen que coincidir
 * con los guardados. Si no coinciden es que se está probando OTRO servidor, y
 * entonces hay que teclear su contraseña: es lo natural, porque la guardada es la
 * del servidor anterior y no serviría igualmente.
 *
 * Lo demás de la configuración de pantalla —carpeta, patrón, días— se sigue
 * admitiendo entero: no decide a dónde viaja nada.
 */
export const dynamic = 'force-dynamic'
// nodejs y no edge: el conector de SFTP usa `ssh2`, que necesita sockets TCP y
// el módulo `crypto` de Node. En edge no existe ninguna de las dos cosas.
export const runtime = 'nodejs'

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    if (!UUID.test(params.id)) return fail(400, 'Ese perfil no existe')

    const perfil = await loadPerfil(params.id)
    if (!perfil) return fail(404, 'Ese perfil ya no existe')

    const body = (await request.json().catch(() => ({}))) as {
      accion?: unknown
      config?: unknown
      ruta?: unknown
      secreto?: unknown
    }

    const accion = body.accion === 'explorar' ? 'explorar' : 'comprobar'

    const conector = conectorDe(perfil.origen)
    const secretoEnPantalla = leerSecreto(body.secreto)

    // Lo guardado por debajo y lo de la pantalla por encima: así un campo que
    // todavía no se ha tocado en esta sesión no se pierde.
    const guardada = (perfil.origen_config ?? {}) as Record<string, unknown>
    const dePantalla = esObjeto(body.config) ? body.config : {}
    const config = { ...guardada, ...dePantalla }

    // Ver «LA CREDENCIAL GUARDADA SOLO VA AL DESTINO GUARDADO» en la cabecera.
    // Solo se comprueba cuando la credencial va a salir de la tabla cifrada: si
    // viene tecleada en el cuerpo, quien la manda ya la sabe y puede probarla
    // contra el servidor que quiera.
    if (!secretoEnPantalla && conector.secreto) {
      const movidas = (conector.clavesDestino ?? []).filter(
        (clave) => clave in dePantalla && texto(dePantalla[clave]) !== texto(guardada[clave])
      )
      if (movidas.length > 0) {
        const campos = movidas
          .map((clave) => conector.campos.find((c) => c.clave === clave)?.etiqueta ?? clave)
          .join(', ')
        return fail(
          400,
          `Has cambiado ${movidas.length === 1 ? 'el campo' : 'los campos'} «${campos}», así que este ya no es ` +
            'el servidor del que tenemos guardada la contraseña. Escribe la contraseña de este otro servidor ' +
            'para probarlo: la guardada es la del anterior y no sale de aquí.'
        )
      }
    }

    const ctx = {
      config,
      perfil: perfil.name,
      perfilId: perfil.id,
      maxBytes: MAX_FICHERO_BYTES,
      subida: null,
      secretoEnPantalla,
    }

    if (accion === 'explorar') {
      if (!conector.explorar) {
        return fail(400, `El origen «${conector.etiqueta}» no tiene explorador.`)
      }
      const ruta = typeof body.ruta === 'string' ? body.ruta : ''
      const listado = await conector.explorar(ctx, ruta)
      return NextResponse.json({ listado })
    }

    const estado = await conector.comprobar(ctx)

    // Un origen al que no se llega NO es un error de la petición: la petición ha
    // funcionado y la respuesta es «no se llega, y este es el motivo». Un 400
    // aquí haría que la pantalla lo pintara como un fallo del ERP en vez de como
    // el diagnóstico que es.
    return NextResponse.json({ estado })
  } catch (error) {
    /**
     * Un OrigenError SÍ sale con su mensaje, y es la única excepción de esta
     * ruta que lo hace: está escrito en español, dice qué hacer y ya ha pasado
     * por tacharSecreto() en el conector.
     *
     * TODO LO DEMÁS SALE GENÉRICO, Y AQUÍ NO VALE errorResponse: ese ayudante
     * reenvía `error.message` de cualquier Error tal cual (lib/amazon/api.ts),
     * y por esta ruta pasan errores de ssh2, de la librería de cifrado y de
     * Postgres que no han pasado por tacharSecreto(). El texto se queda en el
     * registro del servidor, que es donde sirve para algo.
     */
    if (error instanceof OrigenError) return fail(400, error.message)
    console.error('Error explorando el origen de un perfil:', error)
    return fail(500, 'No se ha podido mirar el origen. Vuelve a intentarlo y avisa si sigue fallando')
  }
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Un valor de configuración como texto comparable.
 *
 * El puerto llega del formulario como cadena y de la base puede venir como
 * número, así que comparar en crudo diría que «22» y 22 son destinos distintos
 * y pediría la contraseña sin motivo. Es la misma normalización que hace
 * textoConfig() al leerlo, pero admitiendo también el número.
 */
function texto(v: unknown): string {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

/**
 * La credencial del cuerpo, si la hay.
 *
 * Se construye un SecretoOrigen y no se pasa el objeto pelado a propósito: esa
 * clase tiene el `toString` y el `toJSON` pisados, así que si acaba dentro de
 * un mensaje de error o de un `console.log` sale «credencial oculta» y no la
 * contraseña del cliente.
 */
function leerSecreto(raw: unknown): SecretoOrigen | null {
  if (!esObjeto(raw)) return null
  const s = raw as unknown as SecretoEnviado

  if (typeof s.valor !== 'string' || s.valor === '') return null
  const tipo = s.tipo === 'clave_privada' ? 'clave_privada' : 'password'

  return new SecretoOrigen(tipo, s.valor, typeof s.passphrase === 'string' ? s.passphrase : null)
}
