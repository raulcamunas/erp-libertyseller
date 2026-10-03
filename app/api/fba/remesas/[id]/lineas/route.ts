import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { requireFbaAccess } from '@/lib/fba/acceso'
import { puedeEditarLineas, type EstadoRemesa } from '@/lib/fba/flujo'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LAS LÍNEAS DEL BOCETO: lo que de verdad convierte una remesa en un boceto.
 *
 * Hasta ahora las líneas solo se escribían AL CREAR la remesa y no había forma
 * de tocarlas después: ni la agencia ni el cliente. Un «boceto» que no se puede
 * dibujar no es un boceto, es un pedido cerrado con otro nombre.
 *
 *
 * ============ EL CLIENTE TAMBIÉN, Y NO ES UN DESCUIDO ============
 *
 * Quien sabe qué tiene en el almacén es él. El permiso ya existía desde la 193
 * —fba_accesos.puede_editar, «además crea y corrige remesas»— y nunca se había
 * usado para esto. Un cliente con ese permiso suma referencias, cambia
 * cantidades y quita; uno sin él solo mira.
 *
 *
 * ============ SOLO EN BORRADOR ============
 *
 * `puedeEditarLineas` ya lo decía y aquí se respeta. En cuanto el envío está
 * aprobado hay etiquetas impresas con esos SKU: cambiar la lista por debajo
 * dejaría pegatinas puestas en mercancía que ya no va. Para cambiarlo hay que
 * volver a borrador, que es el paso que sube la versión y deja constancia.
 *
 *
 * ============ SE MANDA LA LISTA ENTERA, NO UN PARCHE ============
 *
 * Y es a propósito. Con operaciones sueltas —«añade esta», «borra aquella»— dos
 * personas editando el mismo boceto a la vez se pisan sin enterarse: cada una
 * manda su cambio, los dos se aplican, y el resultado no es lo que vio ninguna.
 * Mandando la lista entera, el último que guarda ve lo que está guardando.
 */
export const dynamic = 'force-dynamic'

interface LineaEntrante {
  sku?: unknown
  unidades?: unknown
  referencia?: unknown
  nombre?: unknown
  variante?: unknown
  ean?: unknown
  fnsku?: unknown
  asin?: unknown
}

const texto = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!UUID.test(params.id)) return fail(400, 'Esa remesa no existe')

    const sesion = await requireFbaAccess('editar')
    if (sesion instanceof NextResponse) return sesion

    const service = createServiceClient()
    const { data } = await service
      .from('fba_remesas')
      .select('id, client_id, estado')
      .eq('id', params.id)
      .maybeSingle()
    if (!data) return fail(404, 'Esa remesa ya no existe')

    const remesa = data as { id: string; client_id: string; estado: EstadoRemesa }

    // El nivel 'editar' dice que puede editar ALGO; esto comprueba que puede
    // editar ESTE cliente. Sin esto, un cliente con permiso sobre el suyo podría
    // tocar el boceto de otro escribiendo su id en la dirección.
    const editables = sesion.clientesEditables
    if (editables !== null && !editables.includes(remesa.client_id)) {
      return fail(404, 'Esa remesa ya no existe')
    }

    if (!puedeEditarLineas(remesa.estado)) {
      return fail(
        409,
        'Este envío ya está aprobado y hay etiquetas impresas con estas referencias. Para cambiar ' +
          'qué se manda, vuelve primero a borrador: así queda constancia de que lo impreso antes ' +
          'ya no vale.'
      )
    }

    const body = (await request.json().catch(() => null)) as { lineas?: unknown } | null
    if (!body || !Array.isArray(body.lineas)) {
      return fail(400, 'Falta la lista de referencias')
    }

    // ---------- Validación ----------
    const limpias: Array<Record<string, unknown>> = []
    const vistos = new Set<string>()

    for (const bruta of body.lineas as LineaEntrante[]) {
      const sku = texto(bruta.sku)
      if (!sku) return fail(400, 'Hay una línea sin SKU. El SKU es lo que identifica la referencia.')

      // Un SKU una vez. Dos líneas del mismo con 3 y 5 unidades no son «ocho»:
      // son un error de quien lo escribió, y sumarlas por nuestra cuenta manda a
      // Amazon una cantidad que nadie ha decidido.
      const clave = sku.toLowerCase()
      if (vistos.has(clave)) {
        return fail(400, `«${sku}» aparece dos veces. Cada referencia va en una sola línea, con su total.`)
      }
      vistos.add(clave)

      const unidades = Number(bruta.unidades)
      if (!Number.isInteger(unidades) || unidades < 1) {
        return fail(
          400,
          `«${sku}» lleva ${bruta.unidades} unidades. Tiene que ser un número entero de 1 en ` +
            'adelante: para no mandar una referencia, quítala de la lista.'
        )
      }

      limpias.push({
        sku,
        unidades,
        referencia: texto(bruta.referencia),
        nombre: texto(bruta.nombre),
        variante: texto(bruta.variante),
        ean: texto(bruta.ean),
        fnsku: texto(bruta.fnsku),
        asin: texto(bruta.asin),
      })
    }

    if (limpias.length === 0) {
      return fail(
        400,
        'Un envío sin ninguna referencia no se puede guardar. Si lo que quieres es descartarlo, ' +
          'bórralo entero.'
      )
    }

    /**
     * SE GUARDA CON UNA FUNCIÓN DE LA BASE Y NO CON UN DELETE + INSERT.
     *
     * Guardar es «quita las de antes y mete estas». En dos viajes son dos
     * transacciones: si el alta falla después del borrado —un SKU imposible, un
     * corte a mitad— el boceto se queda SIN NINGUNA LÍNEA y lo que había se ha
     * perdido. Dentro de fba_guardar_lineas (migración 215) las dos cosas son
     * una: o entra la lista nueva, o se queda la vieja.
     *
     * Y vuelve a comprobar el estado con FOR UPDATE. Entre que esta ruta lo leyó
     * arriba y escribe pueden pasar segundos, y en esos segundos otra persona
     * puede aprobar el envío: sin eso, las referencias cambiarían por debajo de
     * unas etiquetas recién impresas.
     *
     * `unidades_recibidas` se va con las filas viejas, y es aceptable AQUÍ y
     * solo aquí: en borrador no se ha mandado nada, así que no puede haber nada
     * recibido.
     */
    const { data: metidas, error } = await service.rpc('fba_guardar_lineas', {
      p_remesa: params.id,
      p_lineas: limpias,
    })

    if (error) {
      // 23514 es el CHECK con el que la función avisa de que el envío ha dejado
      // de estar en borrador mientras se editaba. Su mensaje ya está escrito
      // para leerse, así que se pasa tal cual en vez de «no se ha podido».
      if (error.code === '23514') return fail(409, error.message)
      // La función todavía no está: el código se despliega antes de que nadie
      // lance la migración a mano.
      if (error.code === 'PGRST202') {
        return fail(
          503,
          'Falta lanzar la migración 215 en Supabase. Hasta entonces las referencias de un boceto ' +
            'no se pueden cambiar: guardarlas sin ella podría dejar el envío sin ninguna.'
        )
      }
      throw error
    }

    return NextResponse.json({
      ok: true,
      lineas: Number(metidas ?? limpias.length),
      unidades: limpias.reduce((s, l) => s + (l.unidades as number), 0),
    })
  } catch (error) {
    return errorResponse(error, 'No se han podido guardar las referencias')
  }
}
