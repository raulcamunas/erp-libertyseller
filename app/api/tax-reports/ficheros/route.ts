import { NextResponse, type NextRequest } from 'next/server'
import { requireAppAccess } from '@/lib/auth/api'
import { UUID, errorResponse, fail, readText } from '@/lib/amazon/api'
import { comprobarTamañoPeticion } from '@/lib/subidas-limite'
import {
  EXTENSIONES_ACEPTADAS,
  MAX_BYTES_INFORME,
  MENSAJE_FALTA_LA_200,
  anioValido,
  extensionValida,
  faltaLa200,
  guardarInforme,
  guardarNotaDelMes,
  leerCliente,
  leerVista,
  mesValido,
} from '@/lib/tax-reports/datos'

/**
 * COLGAR EL INFORME DE UN CLIENTE EN UN MES.
 *
 * Es la ruta del dia 3: el empleado abre la rejilla, va cuenta por cuenta y
 * suelta aqui el fichero de cada celda.
 *
 *
 * ============ EL NAVEGADOR NO HABLA CON STORAGE ============
 *
 * El fichero llega a ESTA ruta en un multipart, y de aqui al bucket con la
 * clave de servicio. En el resto del ERP se hace al reves —el navegador sube
 * directo con la clave anonima a un bucket publico y guarda el getPublicUrl en
 * la tabla, ver components/agenda/AttachmentsField.tsx— y aqui eso no vale:
 * dentro de estos ficheros van la ciudad, el codigo postal y el Order ID de
 * cada comprador. Esta explicado largo en lib/tax-reports/datos.ts.
 *
 *
 * ============ EL ORDEN DE LAS COMPROBACIONES ============
 *
 *   1. Sesion y rol. Antes de nada, porque /api/ entero es ruta publica para el
 *      middleware.
 *   2. El tamano de la peticion, ANTES de `await request.formData()`. Ese
 *      formData() bufferiza el cuerpo entero en memoria, asi que comprobarlo
 *      despues no evita el pico de RSS: cuatro subidas de 60 MB dejaron el
 *      proceso en 874 MB, que en un contenedor de Easypanel es un OOM-kill.
 *      Medido y escrito en lib/subidas-limite.ts.
 *   3. Ya con el fichero, el tope propio de 10 MB —el de subidas-limite son 25,
 *      que para esto es una talla que no protege de nada— y la extension.
 *
 * OJO CON EL PROXY DE DELANTE: el contenedor va detras de Easypanel, y el
 * client_max_body_size de nginx por omision es 1 MB. Un tax report de 170 KB no
 * lo nota nunca; un xlsx de Sellerboard de 3 MB se cortaria con un 413 que no
 * menciona ni al ERP ni a Supabase. Hay que probarlo con un fichero grande de
 * verdad antes de darlo por hecho.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const sesion = await requireAppAccess(
      'tax-reports',
      'No tienes acceso a Tax Reports. Pideselo a un administrador: se concede por usuario desde Usuarios.'
    )
    if (sesion instanceof NextResponse) return sesion

    const demasiado = comprobarTamañoPeticion(request)
    if (demasiado) return demasiado

    const form = await request.formData()

    const clienteId = String(form.get('clienteId') ?? '')
    if (!UUID.test(clienteId)) return fail(400, 'No se sabe de que cliente es este informe')

    const anio = anioValido(form.get('anio'))
    if (anio === null) return fail(400, 'Falta el ano, o no es un numero entre 2020 y 2100')

    const mes = mesValido(form.get('mes'))
    if (mes === null) return fail(400, 'Falta el mes, o no esta entre 1 y 12')

    const fichero = form.get('fichero')
    if (!(fichero instanceof File) || fichero.size === 0) {
      return fail(400, 'No ha llegado ningun fichero. Vuelve a elegirlo y prueba otra vez.')
    }

    // El tope de verdad, ya con el fichero en la mano: un cuerpo troceado no
    // lleva Content-Length y se salta la comprobacion de arriba.
    if (fichero.size > MAX_BYTES_INFORME) {
      return fail(
        413,
        `«${fichero.name}» ocupa ${(fichero.size / 1024 / 1024).toFixed(1)} MB y el maximo son ` +
          `${MAX_BYTES_INFORME / 1024 / 1024} MB. Un tax report son unos 170 KB y un Sellerboard ` +
          'unos pocos MB: si pesa mas, comprueba que es el fichero que crees.'
      )
    }

    if (!extensionValida(fichero.name)) {
      return fail(
        400,
        `«${fichero.name}» no tiene una extension que valga aqui. Se aceptan ` +
          `${EXTENSIONES_ACEPTADAS.map((e) => '.' + e).join(', ')}, que es lo que bajan Amazon y ` +
          'Sellerboard. Nada de PDF: esto no es el sitio de las facturas, y lo que se cuelgue aqui ' +
          'se retira a los seis meses.'
      )
    }

    /**
     * Que el cliente exista se comprueba AQUI aunque la clave ajena diria lo
     * mismo: lo diria con un 23503 de Postgres y DESPUES de haber subido el
     * fichero al bucket, o sea dejando el objeto colgado.
     */
    const cliente = await leerCliente(clienteId)
    if (!cliente) return fail(404, 'Ese cliente ya no esta en la rejilla. Recarga la pantalla.')

    await guardarInforme({ clienteId, anio, mes, fichero, userId: sesion.userId })

    return NextResponse.json(await leerVista(anio))
  } catch (error) {
    if (faltaLa200(error)) return fail(503, MENSAJE_FALTA_LA_200)
    return errorResponse(error, 'Error guardando un informe de Tax Reports')
  }
}

/**
 * LAS NOTAS DE UN MES, DICIENDO QUE MES ES. ES LA RUTA QUE USA LA PANTALLA.
 *
 * Se direcciona la celda como se ve —cliente, ano y mes—, y no por el id del
 * fichero, PORQUE LA CELDA QUE MAS SE ANOTA ES LA QUE NO TIENE FICHERO. «Falta
 * la factura de enero» habla de un mes que falta: si hiciera falta el id de un
 * fichero para escribirlo, no se podria escribir nunca.
 *
 * Esto contestaba 409 en ese caso, y era el agujero: la nota vivia en
 * `tax_report_ficheros.notas` y esa fila solo existe cuando hay algo colgado.
 * Ahora vive en `tax_report_notas_mes`, que cuelga del CLIENTE —que existe
 * siempre— y por eso ya no hay ningun caso que rechazar.
 *
 * NO SE CREA NINGUNA FILA EN tax_report_ficheros al anotar, y ese es el motivo
 * de que la tabla sea aparte: «hay fila en tax_report_ficheros» significa «ese
 * mes esta puesto», y de ahi salen el tic verde, la cifra de meses que le
 * faltan a cada cliente y el recuento de arriba. Anotar un mes no lo pone.
 *
 * `notas: null` o `""` BORRA la nota. La fila se va entera: una nota vacia es
 * una nota que no existe.
 */
export async function PATCH(request: NextRequest) {
  try {
    const sesion = await requireAppAccess(
      'tax-reports',
      'No tienes acceso a Tax Reports. Pideselo a un administrador: se concede por usuario desde Usuarios.'
    )
    if (sesion instanceof NextResponse) return sesion

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') return fail(400, 'No ha llegado ningun cambio')

    const clienteId = String(body.clienteId ?? '')
    if (!UUID.test(clienteId)) return fail(400, 'No se sabe de que cliente es esta nota')

    const anio = anioValido(body.anio)
    if (anio === null) return fail(400, 'Falta el ano, o no es un numero entre 2020 y 2100')

    const mes = mesValido(body.mes)
    if (mes === null) return fail(400, 'Falta el mes, o no esta entre 1 y 12')

    // Solo `notas`, campo a campo. Ni `ruta` ni `subido_por` ni `purgado_at`
    // tienen por donde entrar: no es que se filtren, es que nadie los lee.
    if (!('notas' in body)) {
      return fail(400, 'No hay ningun campo que se pueda guardar en lo que ha llegado')
    }

    await guardarNotaDelMes(clienteId, anio, mes, readText(body.notas, 2000), sesion.userId)

    return NextResponse.json(await leerVista(anio))
  } catch (error) {
    if (faltaLa200(error)) return fail(503, MENSAJE_FALTA_LA_200)
    return errorResponse(error, 'Error guardando las notas de un mes de Tax Reports')
  }
}
