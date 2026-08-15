import { NextResponse, type NextRequest } from 'next/server'
import { AdsError, canjearCodigo, consumirEstado } from '@/lib/ads/oauth'
import { guardarConexion, traerPerfiles } from '@/lib/ads/datos'

/**
 * LA VUELTA DE AMAZON DESPUÉS DE AUTORIZAR.
 *
 * Esta dirección tiene que estar registrada TAL CUAL en «Allowed Return URLs»
 * de la aplicación de Login with Amazon. Si sobra una barra, Amazon corta antes
 * de enseñar siquiera la pantalla de permisos.
 *
 *
 * ============ NO PIDE SESIÓN, Y ESO ES A PROPÓSITO ============
 *
 * Aquí llega el NAVEGADOR DEL CLIENTE volviendo de Amazon, no el nuestro. Puede
 * ser el dueño de la cuenta de publicidad, que no tiene usuario en el ERP y
 * nunca lo va a tener. Exigir sesión rompería el flujo justo al final, con la
 * autorización ya dada y sin forma de recuperarla.
 *
 * Lo que sustituye a la sesión es el `state`: se generó al pulsar «Conectar»,
 * se guardó con su cliente y su caducidad, y aquí se comprueba y se marca como
 * usado en la misma operación. Sin eso, cualquiera podría llamar a esta URL con
 * un código suyo y dejar SU cuenta de anunciante enganchada a un cliente
 * nuestro.
 *
 *
 * ============ LOS PERFILES SE TRAEN AQUÍ MISMO ============
 *
 * Porque una conexión sin perfiles no sirve para nada: el profileId va en la
 * cabecera de todas las demás llamadas. Traerlos en el momento convierte «he
 * autorizado» en «ya se ve la cuenta», que es la única forma de saber que la
 * autorización sirvió. Si falla, la conexión se queda guardada igual y se
 * reintenta desde la pantalla: perder el refresh token por un fallo de red
 * obligaría al cliente a autorizar otra vez.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PANTALLA = '/dashboard/marketing-api'

function volver(request: NextRequest, params: Record<string, string>): NextResponse {
  const url = new URL(PANTALLA, request.nextUrl.origin)
  for (const [clave, valor] of Object.entries(params)) url.searchParams.set(clave, valor)
  return NextResponse.redirect(url)
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams

  // Amazon avisa aquí cuando el usuario le da a «Cancelar». No es un fallo
  // nuestro y no tiene que salir como tal.
  const errorAmazon = sp.get('error')
  if (errorAmazon) {
    return volver(request, {
      ads_error:
        errorAmazon === 'access_denied'
          ? 'La autorización se ha cancelado en Amazon. No se ha conectado nada.'
          : `Amazon ha devuelto un error (${errorAmazon}): ${sp.get('error_description') ?? 'sin detalle'}`,
    })
  }

  const codigo = sp.get('code') ?? ''
  const state = sp.get('state') ?? ''

  try {
    if (!codigo) throw new AdsError('La vuelta de Amazon no trae el código de autorización.')

    const estado = await consumirEstado(state)
    const tokens = await canjearCodigo(codigo, estado.region)
    const conexionId = await guardarConexion({
      clienteId: estado.clienteId,
      region: estado.region,
      tokens,
      userId: estado.userId,
    })

    let perfiles = 0
    let avisoPerfiles = ''
    try {
      perfiles = (await traerPerfiles(conexionId)).length
    } catch (error) {
      // La conexión ya está guardada: esto es solo el primer uso. Se dice, pero
      // no se deshace nada.
      avisoPerfiles =
        error instanceof Error
          ? ` La cuenta ha quedado conectada, pero no se han podido traer sus perfiles: ${error.message}`
          : ' La cuenta ha quedado conectada, pero no se han podido traer sus perfiles.'
    }

    return volver(request, {
      ads_ok:
        `Cuenta de Amazon Ads conectada.${perfiles > 0 ? ` Se han encontrado ${perfiles} ${perfiles === 1 ? 'perfil' : 'perfiles'} de anunciante.` : ''}` +
        avisoPerfiles,
      cliente: estado.clienteId,
    })
  } catch (error) {
    if (error instanceof AdsError) return volver(request, { ads_error: error.message })
    console.error('Error en el callback de Amazon Ads:', error)
    return volver(request, {
      ads_error: 'No se ha podido completar la conexión con Amazon Ads. Vuelve a intentarlo.',
    })
  }
}
