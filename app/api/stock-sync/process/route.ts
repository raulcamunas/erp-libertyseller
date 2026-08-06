import { NextRequest, NextResponse } from 'next/server'
import {
  AmazonStockRow,
  CrossMapping,
  EanIndex,
  UNMATCHED_REASON_LABELS,
  UnmatchedRow,
  buildAmazonWorkbook,
  buildUnmatchedWorkbook,
  crossStock,
  parseEanWorkbook,
  parseStockWorkbook,
  plainText,
  unmatchedAsZeroRows,
} from '@/lib/stock-sync/engine'
import {
  StockSupabase,
  errorResponse,
  fail,
  fetchAll,
  fileFromForm,
  readUpload,
  requireClient,
  requireStockTeam,
  slug,
} from '@/lib/stock-sync/api'
import { toMadrid } from '@/lib/timezone'

/**
 * El proceso de los lunes y los jueves: entra el volcado del ERP del cliente
 * y sale el fichero de tres columnas que se sube a Amazon.
 *
 * Devuelve el .xlsx directamente como descarga en vez de guardarlo y
 * responder con una URL. El fichero solo tiene sentido durante los cinco
 * minutos que van de generarlo a subirlo a Seller Central, y almacenar el
 * stock de un cliente en un bucket es una superficie que no hace falta abrir.
 * Lo que sí queda guardado es el resumen del proceso en stock_runs, que es lo
 * que permite responder al «¿por qué Amazon dice que tengo 0 de esto?».
 *
 * Las estadísticas viajan además en cabeceras X-* porque el cuerpo es el
 * Excel: sin ellas la pantalla tendría que abrir el fichero para saber cuántos
 * SKU casaron.
 *
 * Con `format=json` contesta con un JSON que lleva dentro los dos ficheros en
 * base64 y, sobre todo, la lista entera de listings sin resolver. Es lo que
 * usa la pantalla del módulo: los sin resolver son el trabajo pendiente de la
 * semana y tienen que verse en una tabla, no en un recuento. Va en la misma
 * petición y no en un segundo endpoint porque el cruce depende de dos ficheros
 * de 2 MB que la persona acaba de subir: pedirlos otra vez para pintar la
 * tabla los subiría dos veces y generaría dos entradas en el historial.
 */

// El motor usa Buffer y el parser de xlsx, que no existen en el runtime edge.
export const runtime = 'nodejs'
// Con 21.000 líneas el cruce tarda milisegundos, pero leer los dos Excel en
// una máquina cargada se acerca a los 10 s: el margen es para eso.
export const maxDuration = 60

export async function POST(request: NextRequest) {
  try {
    const session = await requireStockTeam()
    if (session instanceof NextResponse) return session
    const { supabase, userId } = session

    let form: FormData
    try {
      form = await request.formData()
    } catch {
      // Pasa cuando el cuerpo llega cortado (la subida se interrumpió) o
      // cuando alguien llama a la ruta con JSON en vez de multipart.
      return fail(400, 'No se ha recibido ningún fichero. Envía el formulario con el volcado de stock')
    }

    const client = await requireClient(supabase, form.get('client_id'))
    if (client instanceof NextResponse) return client

    const stockFile = fileFromForm(form, ['stock', 'file', 'stock_file'])
    if (!stockFile) {
      return fail(400, 'Falta el fichero de stock del cliente (ARTICULOS_STOCK_COSTE PROMEDIO)')
    }
    const eanFile = fileFromForm(form, ['ean', 'ean_file', 'eans'])

    const wantsJson = plainText(form.get('format')).toLowerCase() === 'json'

    /**
     * Meter los sin resolver en el fichero con 0 unidades. Apagado salvo
     * petición expresa, y la pantalla lo avisa antes de encenderlo: vacía en
     * Amazon todo listing que el volcado no explique, así que un volcado
     * incompleto se lleva por delante producto que sí estaba en el almacén.
     */
    const includeZero = isTrue(form.get('include_zero'))

    // ---------- Ficheros ----------
    const stockLines = parseStockWorkbook(await readUpload(stockFile, 'El fichero de stock'))

    // El de EAN es opcional: sin él se pierde la vía por EAN, que es la que
    // desempata las referencias que solo se diferencian en los ceros a la
    // izquierda. Las dos por referencia resuelven la inmensa mayoría, así que
    // no tiene sentido bloquear el envío del día por no tenerlo; lo que pasa
    // es que ese día se quedan fuera los pocos SKU ambiguos.
    let eanIndex: EanIndex | null = null
    if (eanFile) {
      eanIndex = parseEanWorkbook(await readUpload(eanFile, 'El fichero de EAN'))
    }

    // ---------- Mapeo ----------
    const mappings = await fetchMappings(supabase, client.id)
    if (mappings.length === 0) {
      return fail(
        404,
        `${client.name} no tiene ninguna línea de mapeo activa. Impórtalas antes de procesar el stock`
      )
    }

    // ---------- Cruce ----------
    const { rows, unmatched, stats } = crossStock({ mappings, stockLines, eanIndex })

    // Lo que acaba en el fichero. `rows` son los que casaron y siguen siendo
    // la medida de si el proceso ha ido bien: los ceros añadidos a mano no
    // cuentan como resueltos ni aquí ni en el historial.
    const zeroed: AmazonStockRow[] = includeZero ? unmatchedAsZeroRows(unmatched) : []
    const outputRows = [...rows, ...zeroed]

    // Un fichero sin filas vacía el inventario del cliente en Amazon si
    // alguien lo sube sin mirarlo. Se mira `rows` y no `outputRows` a
    // propósito: con el interruptor encendido y cero coincidencias, el fichero
    // llevaría todos los listings a 0, que es el peor resultado posible.
    if (rows.length === 0) {
      return fail(
        422,
        `No ha casado ninguna de las ${stats.mappings} líneas de mapeo de ${client.name} con las ` +
          `${stats.stockLines} del volcado. Comprueba que el fichero es el del cliente correcto`
      )
    }

    // ---------- Registro ----------
    // El proceso queda anotado ANTES de devolver el fichero, pero un fallo al
    // anotarlo no cancela la descarga: entre quedarse sin trazabilidad y
    // dejar al cliente sin actualizar el stock, lo segundo cuesta ventas. La
    // cabecera X-Run-Id vacía es la señal de que hay que revisarlo.
    let runId = ''
    try {
      const { data, error } = await supabase
        .from('stock_runs')
        .insert({
          client_id: client.id,
          created_by: userId,
          source_filename: stockFile.name || null,
          ean_filename: eanFile?.name || null,
          rows_input: stats.stockLines,
          rows_matched: stats.matched,
          rows_unmatched: stats.unmatched,
          total_units: stats.totalUnits,
          notes: runNotes(stats.byVia, stats.warnings, zeroed.length),
        })
        .select('id')
        .single()

      if (error) throw error
      runId = data?.id ?? ''
    } catch (error) {
      console.error('No se ha podido registrar el proceso en stock_runs:', error)
    }

    // ---------- Salida ----------
    const workbook = buildAmazonWorkbook(outputRows)
    const day = madridDay(new Date())
    const filename = `stock-${slug(client.name)}-${day}.xlsx`

    if (wantsJson) {
      return NextResponse.json({
        runId: runId || null,
        client: { id: client.id, name: client.name },
        stockFilename: stockFile.name || null,
        eanFilename: eanFile?.name || null,
        // Se devuelve lo que se pidió y no lo que se aplicó porque son lo
        // mismo; si algún día dejan de serlo (un tope de seguridad, por
        // ejemplo), este campo es el que delataría la diferencia.
        includeZero,
        zeroedRows: zeroed.length,
        stats,
        warnings: stats.warnings,
        // La lista entera, no un recuento: es la pantalla de trabajo
        // pendiente. Son decenas de filas, no miles, porque cada una es un
        // listing publicado del cliente.
        unmatched: unmatched.map((row) => ({
          sku: row.sku,
          asin: row.asin,
          refErp: row.refErp,
          reason: row.reason,
          // El texto viaja resuelto para que la pantalla no tenga que
          // importar el motor: engine.ts arrastra xlsx y lo metería entero
          // en el bundle del navegador.
          reasonLabel: UNMATCHED_REASON_LABELS[row.reason] ?? row.reason,
          detail: row.detail,
        })),
        file: { name: filename, base64: workbook.toString('base64') },
        // Solo si hay algo que arreglar: un botón de descarga que baja un
        // Excel con la cabecera y nada debajo confunde más que ayuda.
        unmatchedFile:
          unmatched.length > 0
            ? {
                name: `sin-casar-${slug(client.name)}-${day}.xlsx`,
                base64: buildUnmatchedWorkbook(unmatched).toString('base64'),
              }
            : null,
      })
    }

    // Un Buffer de Node no encaja en BodyInit; el Uint8Array sí.
    const file = new Uint8Array(workbook)

    return new NextResponse(file, {
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        // Sin Content-Length a mano: si el proxy de delante recodifica el
        // cuerpo, una longitud fija corta la descarga a medias.
        'Cache-Control': 'no-store',

        // Las estadísticas del proceso, para que la pantalla las enseñe sin
        // abrir el Excel. Solo números y ASCII: una cabecera con acentos la
        // rechaza el runtime.
        'X-Rows-Input': String(stats.stockLines),
        'X-Rows-Matched': String(stats.matched),
        'X-Rows-Unmatched': String(stats.unmatched),
        'X-Total-Units': String(stats.totalUnits),
        'X-Rows-Zero': String(stats.zeroStock),
        // Cuántos listings sin resolver se han metido a 0 con el interruptor.
        // Distinto de X-Rows-Zero, que son los que casaron y tienen 0 de
        // verdad en el almacén del cliente.
        'X-Rows-Zeroed': String(zeroed.length),
        // Las cuatro vías por las que una línea puede casar, de más fiable a
        // menos: código exacto, EAN del ERP, referencia sin ceros a la
        // izquierda y, ya en último lugar, el EAN que figura en el listing.
        'X-Via-Ref-Exacta': String(stats.byVia.ref_exacta),
        'X-Via-Ean-Erp': String(stats.byVia.ean_erp),
        'X-Via-Ref-Padding': String(stats.byVia.ref_padding),
        'X-Via-Ean-Listing': String(stats.byVia.ean_listing),
        // Por qué se quedó fuera cada SKU, agrupado: «sin_articulo=69,
        // ref_ambigua=1». Es lo que convierte «86 sin casar» en algo
        // accionable, y los códigos son ASCII (las frases de UNMATCHED_REASON_
        // LABELS llevan tildes y no caben en una cabecera).
        'X-Unmatched-Reasons': countByReason(unmatched),
        'X-Warnings': String(stats.warnings.length),
        'X-Run-Id': runId,

        // Hoy la pantalla y la ruta comparten origen y esto sobra, pero en
        // cuanto el ERP se sirva detrás de otro dominio las X-* dejarían de
        // leerse desde JavaScript sin avisar de nada.
        'Access-Control-Expose-Headers':
          'Content-Disposition, X-Rows-Input, X-Rows-Matched, X-Rows-Unmatched, X-Total-Units, X-Rows-Zero, X-Rows-Zeroed, X-Via-Ref-Exacta, X-Via-Ean, X-Via-Ref-Padding, X-Unmatched-Reasons, X-Warnings, X-Run-Id',
      },
    })
  } catch (error) {
    return errorResponse(error, 'Error procesando el stock del cliente')
  }
}

/**
 * Las líneas de mapeo activas del cliente.
 *
 * Solo las columnas que usa el cruce: son 480 filas hoy, pero el `select('*')`
 * arrastraría también los campos de diagnóstico y los títulos de Amazon, que
 * no pintan nada aquí.
 *
 * `is_active` filtra los listings retirados. Sin ese filtro, un producto que
 * se dio de baja en Amazon seguiría apareciendo en el fichero y el cargador
 * devolvería un error por cada uno.
 */
async function fetchMappings(supabase: StockSupabase, clientId: string): Promise<CrossMapping[]> {
  return await fetchAll<CrossMapping>((from, to) =>
    supabase
      .from('stock_mappings')
      .select(
        'sku_amazon, ref_erp, asin, ean_amazon, ean_erp, ean_final, todos_ean_erp, origen_ean'
      )
      .eq('client_id', clientId)
      .eq('is_active', true)
      .order('id', { ascending: true })
      .range(from, to)
  )
}

/** «sin_articulo=69,sin_referencia=16», de mayor a menor, para la cabecera X-Unmatched-Reasons */
function countByReason(unmatched: UnmatchedRow[]): string {
  const counts = new Map<string, number>()
  for (const row of unmatched) counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1)

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, total]) => `${reason}=${total}`)
    .join(',')
}

/**
 * Resumen del proceso para la columna notes de stock_runs.
 *
 * Se guarda el desglose por vía y no solo los totales porque es lo que
 * permite ver de un vistazo si el mapeo se está degradando: el día que las
 * que casan «por referencia sin ceros» crecen de golpe a costa de las que
 * casaban por EAN, alguien ha tocado los códigos en el ERP del cliente.
 */
function runNotes(
  byVia: Record<string, number>,
  warnings: string[],
  zeroed: number
): string {
  let resumen =
    `Por referencia exacta: ${byVia.ref_exacta}. Por EAN del ERP: ${byVia.ean_erp}. ` +
    `Por referencia sin ceros: ${byVia.ref_padding}. Por EAN del listing: ${byVia.ean_listing}. ` +
    `Sin casar: ${byVia.sin_casar}.`

  // Que se encendió el interruptor queda escrito: es el primer dato que hay
  // que mirar el día que un listing aparezca a cero en Amazon sin motivo.
  if (zeroed > 0) resumen += ` Enviados a 0 sin resolver: ${zeroed}.`

  return warnings.length > 0 ? `${resumen} Avisos: ${warnings.join(' | ')}` : resumen
}

/**
 * Casillas y interruptores de un formulario multipart llegan como texto y
 * cada cliente HTTP manda el suyo: «on» el <input type="checkbox"> de un form
 * nativo, «true» un fetch escrito a mano, «1» un curl de prueba.
 *
 * Cualquier otra cosa es false. Un valor no reconocido NO puede interpretarse
 * como encendido: se prefiere generar un fichero de menos listings a uno que
 * ponga a cero los que no se han sabido resolver.
 */
function isTrue(value: unknown): boolean {
  const text = plainText(value).toLowerCase()
  return text === 'true' || text === '1' || text === 'on' || text === 'si' || text === 'sí'
}

/**
 * Día en hora de España para el nombre del fichero. Con UTC, un proceso
 * lanzado a las 00:30 de un lunes saldría fechado el domingo y el operario
 * pensaría que se ha bajado el fichero de la semana pasada.
 */
function madridDay(date: Date): string {
  const madrid = toMadrid(date)
  const month = String(madrid.getMonth() + 1).padStart(2, '0')
  const day = String(madrid.getDate()).padStart(2, '0')
  return `${madrid.getFullYear()}-${month}-${day}`
}
