import { NextResponse, type NextRequest } from 'next/server'
import { requireAppAccess } from '@/lib/auth/api'
import { UUID, errorResponse, fail, readText } from '@/lib/amazon/api'
import {
  MENSAJE_FALTA_LA_200,
  actualizarCliente,
  anioValido,
  borrarCliente,
  cuantosFicherosTiene,
  faltaLa200,
  leerCliente,
  leerVista,
  type CambiosClienteTax,
} from '@/lib/tax-reports/datos'

/**
 * EDITAR O QUITAR UN CLIENTE DE LA REJILLA.
 *
 *
 * ============ EL CUERPO SE LEE CAMPO A CAMPO, NUNCA CON UN SPREAD ==========
 *
 * Solo se miran los cinco campos que se pueden cambiar desde la pantalla. Un
 * `client_id`, un `id` o un `created_at` colados en el JSON no tienen por donde
 * entrar: no es que se filtren, es que nadie los lee.
 *
 * Y un campo que NO venga en el cuerpo se queda como esta, porque la pantalla
 * manda solo lo que se ha tocado: con un spread, un `undefined` serializado
 * borraria las notas de un cliente por cambiarle el tipo de fichero.
 *
 *
 * ============ UN CLIENTE CON INFORMES NO SE BORRA ============
 *
 * La clave ajena es ON DELETE CASCADE, asi que un borrado se llevaria por
 * delante las filas de sus meses —y los ficheros se quedarian en el bucket sin
 * ninguna fila que los nombre, invisibles para la pantalla Y PARA LA PURGA, que
 * es lo que de verdad importa: son ficheros con datos de compradores—.
 *
 * Por eso esto contesta 409 y dice cuantos tiene. Lo que se quiere casi siempre
 * es `activo: false`, que deja de sacarlo en los meses nuevos y sigue
 * ensenando lo que ya se le mando.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const sesion = await requireAppAccess(
      'tax-reports',
      'No tienes acceso a Tax Reports. Pideselo a un administrador: se concede por usuario desde Usuarios.'
    )
    if (sesion instanceof NextResponse) return sesion
    if (!UUID.test(params.id)) return fail(400, 'Ese cliente no existe')

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') return fail(400, 'No ha llegado ningun cambio')

    const cambios: CambiosClienteTax = {}

    if ('nombre' in body) {
      const nombre = readText(body.nombre, 120)
      if (!nombre) return fail(400, 'El cliente necesita un nombre: es como lo reconoces en la rejilla')
      cambios.nombre = nombre
    }

    /**
     * AQUI SI SE RECHAZA EL BLANCO, y no es incoherente con el alta.
     *
     * En el alta, no decir nada significa «el de siempre» y se pone el DEFAULT.
     * Aqui, mandar `tipoFichero` con la clave puesta significa «cambialo a
     * esto», y «esto» vacio es borrarle a la fila lo unico que dice que hay que
     * ir a descargar el dia 3 —ademas de chocar contra el CHECK de la columna y
     * volver con un 23514 que nombra una restriccion y nada mas—.
     */
    if ('tipoFichero' in body) {
      const tipo = readText(body.tipoFichero, 60)
      if (!tipo) {
        return fail(
          400,
          'Dile como se llama el fichero que le toca a este cliente: «Tax report», «Sellerboard», ' +
            'o lo que uses con el. Es lo que se lee el dia 3 para saber que hay que descargar.'
        )
      }
      cambios.tipoFichero = tipo
    }

    if ('activo' in body) cambios.activo = leerBooleano(body.activo)
    if ('notas' in body) cambios.notas = readText(body.notas, 2000)

    if ('orden' in body) {
      const n = Number(body.orden)
      if (!Number.isInteger(n) || n < 0 || n > 9999) {
        return fail(400, 'El orden tiene que ser un numero entero entre 0 y 9999')
      }
      cambios.orden = n
    }

    /**
     * CAMBIAR EL TIPO DE FICHERO NO TOCA LOS MESES YA SUBIDOS, Y ES A
     * PROPOSITO: si Creative Toys pasa manana a tax report, lo que se le mando
     * en marzo sigue siendo un Sellerboard, y la celda tiene que seguir
     * diciendo la verdad. Lo que cambia es lo que toca colgar de ahora en
     * adelante.
     */
    const existia = await actualizarCliente(params.id, cambios)
    if (!existia) {
      if (Object.keys(cambios).length === 0) {
        return fail(400, 'No hay ningun campo que se pueda guardar en lo que ha llegado')
      }
      return fail(404, 'Ese cliente ya no existe. Recarga la pantalla.')
    }

    return NextResponse.json(await leerVista(anioDe(request)))
  } catch (error) {
    if (faltaLa200(error)) return fail(503, MENSAJE_FALTA_LA_200)

    if ((error as { code?: string })?.code === '23505') {
      return fail(409, 'Ya hay otro cliente con ese nombre en Tax Reports')
    }

    return errorResponse(error, 'Error guardando un cliente de Tax Reports')
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const sesion = await requireAppAccess(
      'tax-reports',
      'No tienes acceso a Tax Reports. Pideselo a un administrador: se concede por usuario desde Usuarios.'
    )
    if (sesion instanceof NextResponse) return sesion
    if (!UUID.test(params.id)) return fail(400, 'Ese cliente no existe')

    const cliente = await leerCliente(params.id)
    if (!cliente) return fail(404, 'Ese cliente ya no existe. Recarga la pantalla.')

    /**
     * EL RECUENTO SE CUENTA COMO ES, y no todo junto.
     *
     * A los seis meses la purga retira el fichero y DEJA LA FILA, asi que un
     * cliente de hace un ano tiene doce meses en la rejilla y cero ficheros en
     * el almacen. Decirle a quien lo va a borrar que «tiene 12 informes
     * colgados» es mentira —no queda ninguno colgado— y ademas le esconde lo
     * unico que se esta protegiendo ahi: el historial de que esos meses SI se
     * mandaron. Se sigue impidiendo el borrado en los dos casos.
     */
    const meses = await cuantosFicherosTiene(params.id)
    if (meses.total > 0) {
      const retirados = meses.total - meses.conFichero
      const detalle =
        meses.conFichero > 0 && retirados > 0
          ? `${meses.conFichero} con el fichero todavia guardado y ${retirados} ya retirados a los seis meses`
          : meses.conFichero > 0
            ? `${meses.conFichero} con el fichero todavia guardado`
            : `todos con el fichero ya retirado a los seis meses, pero consta que se mandaron`

      return NextResponse.json(
        {
          error:
            `No se puede borrar «${cliente.nombre}»: tiene ${meses.total} ` +
            `${meses.total === 1 ? 'mes' : 'meses'} en la rejilla (${detalle}). Borrarlo se ` +
            'llevaria por delante ese historial y dejaria los ficheros en el almacen sin que nada ' +
            'vuelva a nombrarlos. Si solo quieres que deje de salir en los meses nuevos, desactivalo.',
          ficheros: meses.total,
          conFichero: meses.conFichero,
        },
        { status: 409 }
      )
    }

    await borrarCliente(params.id)

    return NextResponse.json(await leerVista(anioDe(request)))
  } catch (error) {
    if (faltaLa200(error)) return fail(503, MENSAJE_FALTA_LA_200)
    return errorResponse(error, 'Error borrando un cliente de Tax Reports')
  }
}

/* ------------------------------------------------------------------ */

/** Acepta el true de JSON y el 'true' de un formulario */
function leerBooleano(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'string') return ['true', '1', 'si', 'sí', 'on'].includes(raw.trim().toLowerCase())
  return false
}

/** El ano que tenia abierto la pantalla, para devolverle su misma rejilla */
function anioDe(request: NextRequest): number {
  return anioValido(request.nextUrl.searchParams.get('anio')) ?? new Date().getFullYear()
}
