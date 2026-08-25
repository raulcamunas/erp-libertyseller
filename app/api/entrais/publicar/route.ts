import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { createServiceClient } from '@/lib/supabase/service'
import { fetchAll } from '@/lib/supabase/paginacion'
import { sendChanges, type ChangeToSend } from '@/lib/amazon/data'
import { leerConfig } from '@/lib/entrais/motor'

/**
 * ENTRAIS · PUBLICAR LOS PRECIOS EN AMAZON
 * ========================================
 *
 * ============ ESTA ES LA PRIMERA RUTA QUE CAMBIA PRECIOS DEL CLIENTE ============
 *
 * Hasta ahora el motor calculaba y guardaba una propuesta, y ahí se paraba. Esto
 * la manda. Conviene tener presente qué significa: cada fila aceptada cambia lo
 * que un comprador ve en la tienda de otra empresa.
 *
 * De ahí las cinco cosas de abajo, y ninguna es ceremonia.
 *
 *
 * 1 · EL PRECIO LO PONE EL SERVIDOR, NO LA PANTALLA
 * -------------------------------------------------
 * Llega una lista de SKU y nada más. El importe se busca aquí, en
 * `entrais_precios`. Es lo contrario de lo que hace Limpieza de ofertas —allí la
 * pantalla manda el precio dentro— y la diferencia está en quién es el autor: en
 * Limpieza el número lo teclea una persona, y mandar otro sería ignorarla. Aquí
 * lo calcula el motor, así que la pantalla no tiene ningún precio propio que
 * defender: si lo mandara, un navegador con la tabla abierta desde ayer
 * publicaría los precios de ayer sin que nada lo delatara.
 *
 *
 * 2 · SOLO LAS QUE YA ESTÁN EN AMAZON
 * -----------------------------------
 * Se exige `pvp_actual`, o sea que el listing existe. Sin esa condición, un SKU
 * del catálogo del proveedor que nunca se ha listado recibiría un PATCH de
 * precio contra un listing que no existe: Amazon lo rechaza uno por uno y son
 * cuatro mil llamadas para cuatro mil errores idénticos.
 *
 * Crear listings nuevos es otra cosa, con su plantilla y sus imágenes, y no cae
 * de este lado.
 *
 *
 * 3 · LO QUE NO CAMBIA NO SE MANDA
 * --------------------------------
 * Si el precio propuesto es el que ya está publicado, no hay nada que enviar.
 * No es un filtro de prudencia: es que un PATCH que deja el listing igual gasta
 * cupo, ensucia el registro y hace que «se han mandado 2.700 cambios» sea falso.
 *
 *
 * 4 · SE SIMULA ANTES, Y LA PANTALLA LO EXIGE
 * -------------------------------------------
 * `validateOnly` le pregunta a Amazon si aceptaría el dato sin aplicarlo, y no
 * deja registro. Es lo que convierte «creo que 2.700 precios están bien» en una
 * lista de los que Amazon va a rechazar, ANTES de tocar la tienda.
 *
 *
 * 5 · SIN FRENOS POR TAMAÑO NI POR SALTO, Y ES UNA DECISIÓN
 * ---------------------------------------------------------
 * No hay tope de «no mandes si cambia más de un 30 %» ni «no mandes si cambian
 * más de N». Se preguntó y se decidió así.
 *
 * El freno es que hay una persona delante: no hay envío automático, hay un botón
 * que alguien pulsa después de ver el simulacro. Queda escrito para que dentro
 * de seis meses no se lea como un olvido — y para que si algún día esto pasa a
 * ser automático, se sepa que entonces SÍ hacen falta.
 *
 * Lo que sí se hace es enseñar los mayores saltos en el resumen. Eso no bloquea
 * nada; solo evita que revisar una lista de dos mil filas dependa de tener
 * paciencia para bajar hasta el final.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

/**
 * Cuántos SKU van en cada petición.
 *
 * `sendChanges` los manda de uno en uno a cinco por segundo, así que doscientos
 * son unos cuarenta segundos: caben de sobra en los cinco minutos y dejan una
 * barra de progreso que se mueve. El lote entero se agrupa con el mismo
 * `batchId`, que lo genera el primer tramo y reciben los demás.
 */
const POR_TRAMO = 200

interface FilaPublicable {
  sku: string
  precio: number
  pvpActual: number
  difEuros: number
  difPorcentaje: number | null
  tarifaEstimada: boolean
}

/**
 * Las que se pueden publicar hoy, en orden de salto descendente.
 *
 * El orden no es estético: la pantalla enseña los primeros sin que nadie tenga
 * que ordenar nada, y los mayores saltos son justo lo que hay que mirar antes de
 * pulsar el botón.
 */
async function candidatas(): Promise<FilaPublicable[]> {
  const service = createServiceClient()
  const filas = await fetchAll<{
    sku: string
    precio: number | null
    pvp_actual: number | null
    dif_euros: number | null
    dif_porcentaje: number | null
    tarifa_estimada: boolean | null
    origen: string | null
  }>((a, b) =>
    service
      .from('entrais_precios')
      .select('sku, precio, pvp_actual, dif_euros, dif_porcentaje, tarifa_estimada, origen')
      .order('sku', { ascending: true })
      .range(a, b)
  )

  const salida: FilaPublicable[] = []
  for (const f of filas) {
    // Bloqueado = envío directo. Nunca sale, ni con precio ni sin él.
    if (f.origen === 'bloqueado') continue
    if (f.precio === null || f.pvp_actual === null) continue
    const dif = f.dif_euros === null ? 0 : Number(f.dif_euros)
    // Medio céntimo: por debajo de eso el precio publicado ya es el propuesto.
    if (Math.abs(dif) < 0.005) continue
    salida.push({
      sku: f.sku,
      precio: Number(f.precio),
      pvpActual: Number(f.pvp_actual),
      difEuros: dif,
      difPorcentaje: f.dif_porcentaje === null ? null : Number(f.dif_porcentaje),
      tarifaEstimada: f.tarifa_estimada === true,
    })
  }
  salida.sort((a, b) => Math.abs(b.difEuros) - Math.abs(a.difEuros))
  return salida
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as {
      accion?: string
      skus?: unknown
      batchId?: unknown
    }

    const config = await leerConfig()
    if (!config.connection_id || !config.marketplace_id) {
      return fail(
        400,
        'El motor no tiene cuenta de Amazon ni país configurados, así que no hay dónde publicar. ' +
          'Elígelos arriba en la configuración.'
      )
    }

    /* ---------------- Qué se puede mandar ---------------- */
    if (body.accion !== 'simular' && body.accion !== 'enviar') {
      const filas = await candidatas()
      return NextResponse.json({
        ok: true,
        filas,
        porTramo: POR_TRAMO,
        // Se cuentan aquí y no en la pantalla para que el resumen que se lee
        // antes de pulsar salga del mismo sitio que la lista que se manda.
        resumen: {
          total: filas.length,
          suben: filas.filter((f) => f.difEuros > 0).length,
          bajan: filas.filter((f) => f.difEuros < 0).length,
          conTarifaEstimada: filas.filter((f) => f.tarifaEstimada).length,
        },
      })
    }

    /* ---------------- Simular o enviar ---------------- */
    const pedidos = Array.isArray(body.skus) ? (body.skus as unknown[]).map(String) : []
    if (pedidos.length === 0) return fail(400, 'No ha llegado ninguna referencia que publicar.')
    if (pedidos.length > POR_TRAMO) {
      return fail(
        400,
        `De una vez se mandan como mucho ${POR_TRAMO} referencias. Con más, la petición se queda ` +
          'sin tiempo a la mitad y no habría forma de saber cuáles llegaron.'
      )
    }

    /**
     * SE VUELVE A LEER EL PRECIO, y no se acepta el que venga de fuera.
     * Ver la nota 1 de arriba. También descarta de paso los que hayan dejado de
     * ser publicables desde que la pantalla pidió la lista.
     */
    const publicables = new Map((await candidatas()).map((f) => [f.sku, f]))

    const cambios: ChangeToSend[] = []
    const descartados: { sku: string; porQue: string }[] = []
    for (const sku of pedidos) {
      const f = publicables.get(sku)
      if (!f) {
        descartados.push({
          sku,
          porQue:
            'Ya no está entre las publicables: o se ha recalculado, o su precio propuesto coincide ' +
            'ya con el que tiene en Amazon.',
        })
        continue
      }
      cambios.push({
        sku: f.sku,
        marketplaceId: config.marketplace_id,
        field: 'precio',
        newValue: f.precio,
      })
    }

    if (cambios.length === 0) {
      return NextResponse.json({
        ok: true,
        simulado: body.accion === 'simular',
        batchId: null,
        aceptados: 0,
        fallidos: 0,
        resultados: [],
        descartados,
        abortReason: null,
      })
    }

    const resultado = await sendChanges({
      connectionId: config.connection_id,
      changes: cambios,
      /**
       * `fichero` y no `manual`, aunque lo dispare una persona.
       *
       * Lo que distingue esos dos valores no es quién pulsa, es quién decidió el
       * número: aquí lo ha calculado el motor. El día que un precio salga raro,
       * lo primero que hay que saber es si lo tecleó alguien o lo generó un
       * proceso — y la referencia dice qué pasada del motor fue.
       */
      source: 'fichero',
      sourceRef: `entrais-motor:${new Date().toISOString().slice(0, 16)}`,
      userId: session.userId,
      batchId: typeof body.batchId === 'string' && body.batchId ? body.batchId : null,
      validateOnly: body.accion === 'simular',
    })

    return NextResponse.json({
      ok: true,
      simulado: body.accion === 'simular',
      batchId: resultado.batchId,
      aceptados: resultado.accepted,
      fallidos: resultado.failed,
      resultados: resultado.results,
      descartados,
      abortReason: resultado.abortReason,
    })
  } catch (error) {
    return errorResponse(error, 'Error publicando los precios de Entrais')
  }
}
