import { NextResponse, type NextRequest } from 'next/server'
import { requireAppAccess } from '@/lib/auth/api'
import { UUID, errorResponse, fail, readText } from '@/lib/amazon/api'
import {
  MENSAJE_FALTA_LA_200,
  anioValido,
  borrarInforme,
  enlaceDeDescarga,
  faltaLa200,
  guardarNotaPorFichero,
  leerVista,
} from '@/lib/tax-reports/datos'

/**
 * DESCARGAR, ANOTAR O QUITAR EL INFORME DE UNA CELDA.
 *
 *
 * ============ EL GET NO DEVUELVE EL FICHERO: DEVUELVE UN ENLACE QUE CADUCA ==
 *
 * Sesenta segundos, firmado, y se pide AL PULSAR «Descargar» — nunca al pintar
 * la rejilla. Con once clientes y doce meses, firmarla entera de una vez
 * (`createSignedUrls`, que existe y es la salida comoda) serian 132 enlaces
 * validos repartidos dentro del HTML cada vez que alguien abre la pantalla.
 *
 * Y NUNCA getPublicUrl, que es lo que hace hoy el resto del ERP: eso no firma
 * nada —es una concatenacion de cadenas—, no caduca y no comprueba sesion.
 * Dentro de estos ficheros van datos de compradores.
 *
 * LA ALTERNATIVA MAS CERRADA, por si algun dia se quiere: `download(ruta)`
 * devuelve un Blob aqui, en el servidor, y esta ruta lo reemite como Response
 * con su Content-Disposition. Asi el token no pasa NUNCA por el navegador —ni
 * por el historial, ni por una extension, ni por un Referer—. Cuesta que el
 * fichero atraviese el contenedor, que para 170 KB no es nada. El enlace
 * firmado de 60 segundos es el termino medio, y es lo que hay montado.
 *
 *
 * ============ EL DELETE QUITA EL FICHERO Y LA FILA, EN ESE ORDEN ============
 *
 * Primero el objeto del bucket y despues la fila. Al reves, un borrado que
 * fallara a medias dejaria el fichero en el almacen para siempre sin que
 * ninguna pantalla ni la purga vuelvan a mencionarlo: la purga mira la tabla.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const sesion = await requireAppAccess(
      'tax-reports',
      'No tienes acceso a Tax Reports. Pideselo a un administrador: se concede por usuario desde Usuarios.'
    )
    if (sesion instanceof NextResponse) return sesion
    if (!UUID.test(params.id)) return fail(400, 'Ese informe no existe')

    const enlace = await enlaceDeDescarga(params.id)

    if (enlace === null) return fail(404, 'Ese informe ya no existe. Recarga la pantalla.')

    if (enlace === 'purgado') {
      return fail(
        410,
        'Ese informe ya se retiro: los ficheros se guardan seis meses desde que se suben, porque ' +
          'llevan datos de los compradores del cliente. Si hace falta otra vez, se vuelve a ' +
          'descargar de Seller Central o de Sellerboard.'
      )
    }

    // Solo la URL y el nombre. La `ruta` dentro del bucket no sale de aqui.
    return NextResponse.json({ url: enlace.url, nombre: enlace.nombre })
  } catch (error) {
    if (faltaLa200(error)) return fail(503, MENSAJE_FALTA_LA_200)
    return errorResponse(error, 'Error preparando la descarga de un informe')
  }
}

/**
 * LAS NOTAS DE UN MES, LLEGANDO POR EL FICHERO DE ESE MES.
 *
 * «Este lo mando tarde», «va sin la factura de enero». Son de UN mes y no del
 * cliente: las del cliente ya existen —PATCH /api/tax-reports/clientes/[id]— y
 * valen para los doce, asi que lo que se escribio en febrero habria que
 * acordarse de borrarlo en marzo.
 *
 *
 * ============ ESTA RUTA YA NO ES LA UNICA, NI LA PRINCIPAL ============
 *
 * La nota se guarda en `tax_report_notas_mes`, que cuelga del CLIENTE. Asi que
 * la ruta que la pantalla usa es la que direcciona la celda como se ve —PATCH
 * /api/tax-reports/ficheros con { clienteId, anio, mes, notas }— y funciona
 * tenga ese mes fichero o no.
 *
 * Esta se queda porque quien ya tiene el fichero en la mano no tiene por que
 * volver a componer la celda: traduce el id a (cliente, ano, mes) y escribe en
 * el mismo sitio. Lo unico que puede contestar de mas es un 404 si ese fichero
 * ya no esta.
 *
 * ANTES ESCRIBIA EN `tax_report_ficheros.notas` Y POR ESO NO SERVIA: esa fila
 * solo existe cuando hay algo colgado, o sea que el unico mes que se queria
 * anotar era el unico que no se podia. El porque del cambio esta en el bloque
 * 2 bis de la migracion 200.
 *
 * `notas: null` o `""` BORRA la nota; que la clave no venga no toca nada. Es la
 * diferencia entre «lo he vaciado» y «no lo he tocado», y sin ella la pantalla
 * no puede mandar solo lo que ha cambiado.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const sesion = await requireAppAccess(
      'tax-reports',
      'No tienes acceso a Tax Reports. Pideselo a un administrador: se concede por usuario desde Usuarios.'
    )
    if (sesion instanceof NextResponse) return sesion
    if (!UUID.test(params.id)) return fail(400, 'Ese informe no existe')

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') return fail(400, 'No ha llegado ningun cambio')

    // Campo a campo, nunca un spread: aqui solo se lee `notas`. Ni `ruta`, ni
    // `subido_por`, ni `purgado_at` tienen por donde entrar; no es que se
    // filtren, es que nadie los lee. Y desde que la nota vive en otra tabla,
    // esta ruta ni siquiera escribe en la fila del fichero: solo la usa para
    // saber de que celda esta hablando.
    if (!('notas' in body)) {
      return fail(400, 'No hay ningun campo que se pueda guardar en lo que ha llegado')
    }

    const guardada = await guardarNotaPorFichero(
      params.id,
      readText(body.notas, 2000),
      sesion.userId
    )
    if (!guardada) return fail(404, 'Ese informe ya no existe. Recarga la pantalla.')

    return NextResponse.json(await leerVista(anioDe(request)))
  } catch (error) {
    if (faltaLa200(error)) return fail(503, MENSAJE_FALTA_LA_200)
    return errorResponse(error, 'Error guardando las notas de un mes de Tax Reports')
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const sesion = await requireAppAccess(
      'tax-reports',
      'No tienes acceso a Tax Reports. Pideselo a un administrador: se concede por usuario desde Usuarios.'
    )
    if (sesion instanceof NextResponse) return sesion
    if (!UUID.test(params.id)) return fail(400, 'Ese informe no existe')

    const habia = await borrarInforme(params.id)
    if (!habia) return fail(404, 'Ese informe ya no existe. Recarga la pantalla.')

    return NextResponse.json(await leerVista(anioDe(request)))
  } catch (error) {
    if (faltaLa200(error)) return fail(503, MENSAJE_FALTA_LA_200)
    return errorResponse(error, 'Error quitando un informe de Tax Reports')
  }
}

/** El ano que tenia abierto la pantalla, para devolverle su misma rejilla */
function anioDe(request: NextRequest): number {
  return anioValido(request.nextUrl.searchParams.get('anio')) ?? new Date().getFullYear()
}
