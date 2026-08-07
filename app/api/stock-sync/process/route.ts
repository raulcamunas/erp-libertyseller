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
import {
  CANAL_VENDEDOR,
  MIME_XLSM,
  fillAmazonTemplate,
  type FilledTemplate,
} from '@/lib/stock-sync/amazon-template'
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
 *
 * Si además se sube la plantilla oficial de Amazon («Precio y cantidad», el
 * .xlsm que cada cliente descarga de SU Seller Central), sale un tercer fichero
 * con esa misma plantilla rellenada. Es una salida ADICIONAL: el .xlsx de tres
 * columnas se sigue generando siempre, así que quien no suba plantilla trabaja
 * exactamente como antes.
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

    /**
     * La plantilla oficial de Amazon, opcional.
     *
     * No hay ninguna copia guardada en el servidor a propósito: dentro lleva
     * grabado el identificador de UNA cuenta de vendedor y una versión con
     * fecha, así que reutilizar la de un cliente con otro le subiría el stock a
     * la cuenta equivocada. La descarga cada cliente de su Seller Central.
     */
    const templateFile = fileFromForm(form, ['plantilla', 'template', 'amazon_template'])

    const format = plainText(form.get('format')).toLowerCase()
    const wantsJson = format === 'json'
    // Descarga directa de la plantilla rellenada, para llamadas a mano. La
    // pantalla no lo usa: va siempre por JSON.
    const wantsTemplateBinary = format === 'xlsm' || format === 'plantilla'

    /**
     * Meter los sin resolver en el fichero con 0 unidades. Apagado salvo
     * petición expresa, y la pantalla lo avisa antes de encenderlo: vacía en
     * Amazon todo listing que el volcado no explique, así que un volcado
     * incompleto se lleva por delante producto que sí estaba en el almacén.
     */
    const includeZero = isTrue(form.get('include_zero'))

    /**
     * El canal de logística se rellena SIEMPRE que haya plantilla, ya no es
     * opcional.
     *
     * Nació como interruptor apagado porque lo pedido eran solo el SKU y las
     * unidades, pero la propia hoja de instrucciones de Amazon dice que hay que
     * declarar el canal para poder cambiar la cantidad: sin él, el fichero se
     * sube sin errores y el stock puede no llegar a aplicarse, que es la peor
     * de las combinaciones — parece que ha funcionado.
     *
     * Dejarlo apagado tampoco protegía de nada. Lo que saca un SKU de FBA es
     * escribir una cantidad, y la cantidad va siempre; el aviso de la pantalla
     * lo explica y no depende de esto.
     */
    const withChannel = templateFile !== null

    if (wantsTemplateBinary && !templateFile) {
      return fail(400, 'Has pedido la plantilla de Amazon rellenada pero no has subido ninguna plantilla')
    }

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

    // ---------- Plantilla de Amazon ----------
    // Se rellena AQUÍ, antes de anotar el proceso: si la plantilla no es la que
    // toca, la respuesta es un 400 con la explicación y no queda un run en el
    // historial de un fichero que nadie llegó a descargar.
    let filled: FilledTemplate | null = null
    if (templateFile) {
      filled = fillAmazonTemplate(
        await readUpload(templateFile, 'La plantilla de Amazon'),
        outputRows.map((row) => ({ sku: row.sku, stock: row.stock })),
        {
          filename: templateFile.name,
          canal: withChannel ? CANAL_VENDEDOR : null,
        }
      )
      // Los avisos del rellenado (columnas movidas de sitio, filas de una carga
      // anterior que se han limpiado) se cuelan en la misma lista que los del
      // cruce: la pantalla ya tiene un sitio donde enseñarlos y el operario no
      // tiene por qué saber cuál de las dos partes se los manda.
      stats.warnings.push(...filled.warnings)

      // ¿Es la plantilla de la cuenta de siempre? Se compara con la del último
      // proceso de este cliente. No bloquea: puede ser un cambio legítimo de
      // cuenta, y quien lo sabe es la persona que tiene el fichero delante.
      const aviso = await accountMismatchWarning(supabase, client.id, client.name, filled)
      if (aviso) stats.warnings.push(aviso)
    }

    // ---------- Registro ----------
    // El proceso queda anotado ANTES de devolver el fichero, pero un fallo al
    // anotarlo no cancela la descarga: entre quedarse sin trazabilidad y
    // dejar al cliente sin actualizar el stock, lo segundo cuesta ventas. La
    // cabecera X-Run-Id vacía es la señal de que hay que revisarlo.
    let runId = ''
    try {
      const base = {
        client_id: client.id,
        created_by: userId,
        source_filename: stockFile.name || null,
        ean_filename: eanFile?.name || null,
        rows_input: stats.stockLines,
        rows_matched: stats.matched,
        rows_unmatched: stats.unmatched,
        total_units: stats.totalUnits,
        notes: runNotes(stats.byVia, stats.warnings, zeroed.length, filled, withChannel),
      }

      const { data, error } = await supabase
        .from('stock_runs')
        .insert({
          ...base,
          template_contributor_id: filled?.contributorId ?? null,
          template_marketplace_id: filled?.marketplaceId ?? null,
        })
        .select('id')
        .single()

      if (error && isMissingColumn(error)) {
        // La migración 114 todavía no está aplicada en esta base de datos. Se
        // reintenta sin esas dos columnas para no perder el registro del
        // proceso: lo que se pierde mientras tanto es la comprobación de la
        // cuenta de vendedor, no la trazabilidad de lo que se subió.
        console.warn(
          'stock_runs no tiene las columnas de la plantilla: falta aplicar la migración 114'
        )
        const reintento = await supabase.from('stock_runs').insert(base).select('id').single()
        if (reintento.error) throw reintento.error
        runId = reintento.data?.id ?? ''
      } else if (error) {
        throw error
      } else {
        runId = data?.id ?? ''
      }
    } catch (error) {
      console.error('No se ha podido registrar el proceso en stock_runs:', error)
    }

    // ---------- Salida ----------
    const workbook = buildAmazonWorkbook(outputRows)
    const day = madridDay(new Date())
    const filename = `stock-${slug(client.name)}-${day}.xlsx`
    // Con el cliente y el día dentro: en la carpeta de descargas conviven las
    // plantillas de varios clientes y todas se llaman «PriceAndQuantity» al
    // bajarlas de Amazon, que es la forma más fácil de subirle a un cliente el
    // stock de otro.
    const templateFilename = `plantilla-amazon-${slug(client.name)}-${day}.xlsm`

    if (wantsTemplateBinary && filled) {
      return new NextResponse(new Uint8Array(filled.buffer), {
        headers: {
          'Content-Type': MIME_XLSM,
          'Content-Disposition': `attachment; filename="${templateFilename}"`,
          'Cache-Control': 'no-store',
          'X-Rows-Matched': String(stats.matched),
          'X-Template-Rows': String(filled.rows),
          'X-Run-Id': runId,
          'Access-Control-Expose-Headers':
            'Content-Disposition, X-Rows-Matched, X-Template-Rows, X-Run-Id',
        },
      })
    }

    if (wantsJson) {
      return NextResponse.json({
        runId: runId || null,
        client: { id: client.id, name: client.name },
        stockFilename: stockFile.name || null,
        eanFilename: eanFile?.name || null,
        templateFilename: templateFile?.name || null,
        // Se devuelve lo que se pidió y no lo que se aplicó porque son lo
        // mismo; si algún día dejan de serlo (un tope de seguridad, por
        // ejemplo), este campo es el que delataría la diferencia.
        includeZero,
        withChannel,
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
        // La plantilla de Amazon, solo si se ha subido una. El .xlsx de tres
        // columnas de arriba sale igual: son dos formas de subir lo mismo y
        // quien no use plantilla no nota ningún cambio.
        templateFile: filled
          ? {
              name: templateFilename,
              base64: filled.buffer.toString('base64'),
              // El MIME viaja con el fichero porque no es el de siempre: un
              // .xlsm declarado como .xlsx hace que algún navegador le cambie
              // la extensión al guardarlo y Amazon lo rechace.
              mime: MIME_XLSM,
              rows: filled.rows,
              // Dónde ha escrito de verdad. Se enseña en pantalla porque en una
              // plantilla con las columnas movidas es la prueba de que el stock
              // ha ido a la columna correcta y no a la de al lado.
              colSku: filled.colSku,
              colCantidad: filled.colCantidad,
              colCanal: filled.colCanal,
              // El texto que ha ido a la celda del canal, ya traducido al
              // idioma de la plantilla. Se enseña porque es el valor que
              // Amazon va a leer, y no el código con el que se pidió.
              canalEtiqueta: filled.canalEtiqueta,
              version: filled.version,
              // La cuenta de vendedor de la plantilla, para que se pueda
              // comprobar de un vistazo que es la del cliente que se procesa.
              contributorId: filled.contributorId,
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

/**
 * El aviso de «esta plantilla no es de la cuenta de siempre», o null.
 *
 * Compara la cuenta de vendedor grabada en la plantilla que se acaba de subir
 * con la del último proceso de ese mismo cliente. Es la única comprobación
 * posible: las columnas técnicas de la plantilla son idénticas en todas las
 * cuentas, así que un fichero del cliente equivocado se rellena igual de bien
 * y el fallo no aparece hasta el informe de Seller Central, con un error por
 * SKU.
 *
 * Avisa, no bloquea. Un cambio de cuenta puede ser legítimo (el cliente migra
 * de cuenta, se empieza a llevar otro marketplace) y quien lo sabe es la
 * persona que tiene el fichero delante. La primera vez que se ve una cuenta no
 * dice nada: no hay con qué compararla.
 *
 * Nunca lanza: si la consulta falla o la migración 114 no está aplicada, el
 * proceso sigue sin la comprobación. Quedarse sin aviso es peor que no tenerlo,
 * pero mucho mejor que quedarse sin el fichero del día.
 */
async function accountMismatchWarning(
  supabase: StockSupabase,
  clientId: string,
  clientName: string,
  filled: FilledTemplate
): Promise<string | null> {
  if (!filled.contributorId) return null

  try {
    const { data, error } = await supabase
      .from('stock_runs')
      .select('template_contributor_id, template_marketplace_id, created_at')
      .eq('client_id', clientId)
      .not('template_contributor_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data) return null

    const previa = data.template_contributor_id as string | null
    if (!previa || previa === filled.contributorId) return null

    const mercado =
      data.template_marketplace_id && data.template_marketplace_id !== filled.marketplaceId
        ? ' Además, es de otro marketplace.'
        : ''

    return (
      `Esta plantilla es de la cuenta de vendedor ${filled.contributorId}, y la última que se usó ` +
      `con ${clientName} era ${previa}.${mercado} Comprueba que la has descargado del Seller ` +
      'Central de este cliente: subida a la cuenta equivocada, ninguno de los SKU existe allí y ' +
      'el informe de procesamiento devuelve un error por cada uno'
    )
  } catch (error) {
    console.error('No se ha podido comprobar la cuenta de la plantilla:', error)
    return null
  }
}

/** Si el fallo de Supabase es «esa columna no existe», o sea que falta la migración 114 */
function isMissingColumn(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null
  if (!e) return false
  // 42703 es el SQLSTATE de Postgres; PGRST204, el que devuelve PostgREST
  // cuando el cuerpo del insert trae una columna que no está en su esquema.
  if (e.code === '42703' || e.code === 'PGRST204') return true
  return typeof e.message === 'string' && e.message.includes('template_contributor_id')
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
  zeroed: number,
  filled: FilledTemplate | null,
  withChannel: boolean
): string {
  let resumen =
    `Por referencia exacta: ${byVia.ref_exacta}. Por EAN del ERP: ${byVia.ean_erp}. ` +
    `Por referencia sin ceros: ${byVia.ref_padding}. Por EAN del listing: ${byVia.ean_listing}. ` +
    `Sin casar: ${byVia.sin_casar}.`

  // Que se encendió el interruptor queda escrito: es el primer dato que hay
  // que mirar el día que un listing aparezca a cero en Amazon sin motivo.
  if (zeroed > 0) resumen += ` Enviados a 0 sin resolver: ${zeroed}.`

  // Y que se generó la plantilla, con qué versión, de qué cuenta era y si
  // llevaba canal. El día que un cliente diga que sus productos se le han
  // salido de FBA, esta línea es la que dice si fue este proceso o no.
  if (filled) {
    resumen +=
      ` Plantilla de Amazon rellenada: ${filled.rows} filas` +
      (filled.version ? ` (versión ${filled.version})` : '') +
      `, SKU en ${filled.colSku} y cantidad en ${filled.colCantidad}.` +
      (filled.contributorId ? ` Cuenta de vendedor: ${filled.contributorId}.` : '') +
      (withChannel && filled.canalEtiqueta
        ? ` Canal de logística escrito en ${filled.colCanal}: «${filled.canalEtiqueta}».`
        : ' Sin canal de logística.')
  }

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
