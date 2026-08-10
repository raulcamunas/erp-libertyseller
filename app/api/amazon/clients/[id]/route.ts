import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import {
  actualizarClasificacionCliente,
  eliminarCliente,
  loadAmazonData,
  queSePierdeAlBorrarCliente,
} from '@/lib/amazon/data'
import { esModeloNegocio, esPoliticaBsr } from '@/lib/plataforma/modelo-negocio'

/**
 * CLASIFICA A UN CLIENTE: SU MODELO DE NEGOCIO Y SU POLÍTICA DE BSR.
 *
 * Es la escritura que decide el gasto de la ventana nocturna. Un catálogo de
 * reventa marcado como mixto se lleva el barrido diario de BSR entero —unas seis
 * horas midiendo el ranking de productos que no son de ese cliente—, y lo único
 * que hace falta para evitarlo es esta petición.
 *
 *
 * ============ POR QUÉ NO DEVUELVE LA VISTA ENTERA ============
 *
 * El resto de rutas del módulo devuelven `loadAmazonData()` completa, y aquí se
 * rompe esa costumbre a propósito. Esa carga hace DOS consultas de recuento por
 * cada conexión —líneas de catálogo y cambios enviados—, y un `count: 'exact'`
 * sobre un espejo de trece mil referencias no es gratis. Con 16 clientes eso son
 * más de treinta consultas CADA VEZ QUE ALGUIEN MUEVE UN DESPLEGABLE, y ninguna
 * de ellas dice nada distinto: clasificar a un cliente no cambia ni sus
 * conexiones, ni sus recuentos, ni el cupo de autorizaciones.
 *
 * Se devuelve la fila recién escrita y la pantalla la sustituye en su lista. Lo
 * que se pierde a cambio —enterarse de que otra pestaña ha cambiado algo— no
 * existe: esta es la única ruta que toca estas columnas.
 *
 *
 * ============ LO QUE SÍ SE VALIDA ============
 *
 * Los dos valores contra su lista, y no por gusto: el CHECK de la migración 123
 * también los pararía, pero devolvería un error de restricción de Postgres que
 * no le dice nada a nadie. Aquí se contesta en español y con un 400.
 */
export const dynamic = 'force-dynamic'

/**
 * QUÉ SE PERDERÍA AL BORRAR A ESTE CLIENTE.
 *
 * Lo pide el diálogo de borrado ANTES de enseñar el botón. Todo lo del cliente
 * está en CASCADE, así que hace falta poder decir el número —«2.620 referencias
 * y 41.000 observaciones de BSR»— en vez de un «¿seguro?» que nadie lee.
 */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session
    if (!UUID.test(params.id)) return fail(400, 'Ese cliente no existe')

    return NextResponse.json({ perdido: await queSePierdeAlBorrarCliente(params.id) })
  } catch (error) {
    return errorResponse(error, 'No se ha podido calcular qué se perdería')
  }
}

/**
 * BORRA UN CLIENTE. NO SE PUEDE DESHACER.
 *
 * Dos frenos, y los dos están en lib/amazon/data.ts para que valgan también si
 * algún día se llama desde otro sitio:
 *
 *   · si todavía tiene una cuenta de Amazon conectada, se niega. Esa fila
 *     guarda el refresh token del vendedor y está en CASCADE: borrar el cliente
 *     destruiría la llave sin que nadie haya pulsado «Desconectar».
 *   · hay que escribir el nombre exacto.
 *
 * Devuelve la vista entera recargada, como el resto de escrituras del módulo.
 */
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session
    if (!UUID.test(params.id)) return fail(400, 'Ese cliente no existe')

    const body = (await request.json().catch(() => ({}))) as { nombre?: unknown }
    const nombreEscrito = typeof body.nombre === 'string' ? body.nombre : ''

    const { nombre, perdido } = await eliminarCliente({
      clientId: params.id,
      nombreEscrito,
    })
    const data = await loadAmazonData()

    const trozos: string[] = []
    if (perdido.referencias > 0) trozos.push(`${perdido.referencias} referencias`)
    if (perdido.observacionesBsr > 0) {
      trozos.push(`${perdido.observacionesBsr} observaciones de BSR`)
    }

    return NextResponse.json({
      ...data,
      message:
        trozos.length > 0
          ? `«${nombre}» borrado, con ${trozos.join(' y ')}`
          : `«${nombre}» borrado`,
    })
  } catch (error) {
    return errorResponse(error, 'Error borrando un cliente de Amazon')
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    if (!UUID.test(params.id)) return fail(400, 'Ese cliente no existe')

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return fail(400, 'No ha llegado ningún cambio')

    // Los dos juntos y ninguno opcional: son un par. La política solo se entiende
    // al lado del modelo —`auto` significa una cosa u otra según él—, así que
    // guardar uno sin el otro deja al cliente en un estado que nadie ha elegido.
    const { modelo_negocio: modelo, bsr_politica: politica } = body
    if (!esModeloNegocio(modelo)) {
      return fail(400, 'El modelo de negocio tiene que ser marca propia, arbitraje o mixto')
    }
    if (!esPoliticaBsr(politica)) {
      return fail(400, 'Esa política de BSR no existe')
    }

    const { client, sinColumnaFecha } = await actualizarClasificacionCliente({
      clientId: params.id,
      modelo,
      politica,
    })

    return NextResponse.json({
      client,
      message: `«${client.name}» clasificado`,
      // La pantalla lo dice UNA VEZ, al guardar, y no como un aviso permanente:
      // lo que se ha pedido guardar se ha guardado, y el planificador ya lo va a
      // respetar. Lo único que falta es que el contador de «sin clasificar»
      // sepa distinguir la decisión del valor por defecto.
      avisoMigracion: sinColumnaFecha
        ? 'Guardado. Para que el contador de clientes sin clasificar sea exacto, falta lanzar ' +
          '128_amazon_clientes_clasificacion.sql en el editor SQL de Supabase.'
        : undefined,
    })
  } catch (error) {
    return errorResponse(error, 'Error clasificando un cliente de Amazon')
  }
}
