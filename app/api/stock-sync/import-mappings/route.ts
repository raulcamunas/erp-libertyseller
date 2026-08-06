import { NextRequest, NextResponse } from 'next/server'
import {
  Table,
  cleanSku,
  findColumn,
  plainText,
  readTable,
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
} from '@/lib/stock-sync/api'
import { exactCode, normalizeEan, parseCodeList } from '@/lib/types/stock-sync'

/**
 * Cómo se nutre la tabla de mapeo con producto nuevo.
 *
 * El cliente da de alta listings en Amazon todas las semanas y alguien casa a
 * mano la referencia de su ERP con el SKU. Esta ruta se come ese trabajo
 * —venga en el Excel de siempre o en un CSV de tres columnas— y lo mete en
 * stock_mappings normalizando por el camino, que es lo que hace que el cruce
 * de los lunes encuentre el artículo.
 *
 * Es un upsert por (client_id, sku_amazon) y no un borrar-e-insertar: las
 * correcciones que se hacen desde la pantalla del módulo (una referencia
 * arreglada a mano después de mirar por qué no casaba) no se pueden perder
 * porque alguien vuelva a subir el Excel viejo. Solo se pisan las columnas
 * que el fichero trae de verdad.
 */

// readTable usa el parser de xlsx, que no funciona en el runtime edge.
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * Tope de filas. El mapeo real son 481 líneas; 50.000 es una barbaridad que
 * solo se alcanza subiendo por error el volcado de artículos del ERP en vez
 * de la tabla de mapeo, y es justo eso lo que se quiere frenar antes de
 * escribir nada.
 */
const MAX_ROWS = 50_000

/** Filas por sentencia. Un upsert de 481 filas cabe de sobra; el troceado es para el día que no quepa */
const UPSERT_CHUNK = 500

/**
 * Las columnas que se leen del fichero, con los nombres que puede traer cada
 * una. La cabecera se compara sin tildes, sin mayúsculas y sin puntuación
 * (normalizeHeader), así que «EAN_AMAZON», «ean amazon» y «EAN Amazon» son la
 * misma. Lo que sobra del fichero se ignora en silencio.
 *
 * El ORDEN de las claves es significativo: se resuelven de arriba abajo y una
 * columna que ya se ha llevado un campo no se la puede llevar otro. Por eso
 * los tres EAN concretos van antes que `ean_final`, cuyo alias corto «EAN»
 * se comería «EAN_AMAZON» en un fichero que no traiga la columna EAN_FINAL.
 */
const COLUMNS = {
  sku_amazon: ['SKU_AMAZON', 'SKU AMAZON', 'Seller SKU', 'SKU'],
  ref_erp: ['REF_ERP', 'REF ERP', 'Referencia', 'Cod.Articulo', 'Articulo'],
  asin: ['ASIN'],
  ean_amazon: ['EAN_AMAZON', 'EAN AMAZON'],
  ean_erp: ['EAN_ERP', 'EAN ERP'],
  todos_ean_erp: ['TODOS_EAN_ERP', 'TODOS EAN ERP', 'Todos los EAN'],
  ean_coincide: ['EAN_COINCIDE', 'EAN COINCIDE'],
  origen_ean: ['ORIGEN_EAN', 'ORIGEN EAN'],
  ean_final: ['EAN_FINAL', 'EAN FINAL', 'EAN'],
  metodo_match: ['METODO_MATCH', 'METODO MATCH', 'Metodo'],
  sku_coincide: ['SKU_COINCIDE', 'SKU COINCIDE'],
  situacion_erp: ['SITUACION_ERP', 'SITUACION ERP', 'Situacion'],
  titulo_amazon: ['TITULO_AMAZON', 'TITULO AMAZON', 'Titulo', 'Nombre del producto'],
  notes: ['notes', 'Notas', 'Observaciones'],
} as const

type ColumnKey = keyof typeof COLUMNS

type ColumnIndex = Record<ColumnKey, number>

/**
 * A qué columna del fichero corresponde cada campo, o -1 si no viene.
 *
 * Se resuelve una sola vez y con exclusión mutua: dos campos no pueden acabar
 * leyendo la misma columna, que es el fallo que llenaría `ean_final` con el
 * EAN que publica Amazon y haría que el cruce se fiara de un dato que el
 * cliente no ha validado.
 */
function resolveColumns(table: Table): ColumnIndex {
  const index = {} as ColumnIndex
  const taken = new Set<number>()

  for (const key of Object.keys(COLUMNS) as ColumnKey[]) {
    const found = findColumn(table.headers, [...COLUMNS[key]], taken)
    index[key] = found
    if (found !== -1) taken.add(found)
  }

  return index
}

/** Motivos por los que una fila del fichero no llega a la base de datos */
type SkipReason = 'sin_sku' | 'vacia' | 'repetida'

const SKIP_LABELS: Record<SkipReason, string> = {
  sin_sku: 'Sin SKU de Amazon: no hay listing al que asociar la referencia',
  vacia: 'Fila vacía',
  repetida: 'SKU repetido dentro del fichero; se ha quedado la última aparición',
}

interface MappingRow {
  client_id: string
  ref_erp: string | null
  sku_amazon: string
  asin: string | null
  ean_amazon: string | null
  ean_erp: string | null
  ean_final: string | null
  origen_ean: string | null
  metodo_match: string | null
  sku_coincide: string | null
  ean_coincide: string | null
  todos_ean_erp: string | null
  situacion_erp: string | null
  titulo_amazon: string | null
  notes: string | null
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireStockTeam()
    if (session instanceof NextResponse) return session
    const { supabase } = session

    let form: FormData
    try {
      form = await request.formData()
    } catch {
      return fail(400, 'No se ha recibido ningún fichero. Envía el formulario con la tabla de mapeo')
    }

    const client = await requireClient(supabase, form.get('client_id'))
    if (client instanceof NextResponse) return client

    const file = fileFromForm(form, ['file', 'mappings', 'mapeo'])
    if (!file) return fail(400, 'Falta el fichero con la tabla de mapeo (CSV o Excel)')

    // La hoja se reconoce por traer una columna de SKU: en el Excel de trabajo
    // hay dos («Ahora» y «Antes») y también una fila de título por encima de
    // la cabecera, así que ni el nombre ni la posición sirven de referencia.
    // Se pide «sku» y no «sku_amazon» porque un CSV de alta rápida trae la
    // columna llamada solo «SKU»; cuál es exactamente lo decide resolveColumns.
    const sheet = plainText(form.get('sheet')) || undefined
    const table = readTable(await readUpload(file, 'El fichero de mapeo'), {
      sheet,
      required: ['sku'],
    })

    if (table.rows.length > MAX_ROWS) {
      return fail(
        413,
        `El fichero trae ${table.rows.length} filas y el máximo son ${MAX_ROWS}. ` +
          '¿Seguro que es la tabla de mapeo y no el volcado de artículos del ERP?'
      )
    }

    const index = resolveColumns(table)
    if (index.sku_amazon === -1) {
      return fail(
        422,
        'El fichero no trae una columna SKU_AMAZON. Columnas encontradas: ' +
          (table.headers.filter(Boolean).join(', ') || 'ninguna')
      )
    }

    const { rows, skipped } = buildRows(table, index, client.id)

    if (rows.length === 0) {
      return fail(422, 'El fichero no trae ninguna fila con SKU de Amazon')
    }

    // Qué SKU existían ANTES de escribir: es la única forma de contar cuántos
    // son altas y cuántos actualizaciones, porque el upsert de Postgres no lo
    // dice. Se lee entero (son cientos de filas) y una sola vez.
    const existing = await fetchExistingSkus(supabase, client.id)
    const inserted = rows.filter((row) => !existing.has(row.sku_amazon)).length

    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      const { error } = await supabase
        .from('stock_mappings')
        .upsert(rows.slice(i, i + UPSERT_CHUNK), { onConflict: 'client_id,sku_amazon' })
      if (error) throw error
    }

    return NextResponse.json({
      client: client.name,
      sheet: table.sheet,
      rowsRead: table.rows.length,
      inserted,
      updated: rows.length - inserted,
      discarded: skipped.reduce((sum, group) => sum + group.rows, 0),
      discardedReasons: skipped,
      // Las columnas que el fichero NO traía. Sin esto, subir un CSV al que le
      // falta EAN_FINAL parece que ha ido bien y el cruce empeora a la semana
      // siguiente sin que nadie sepa por qué.
      missingColumns: missingColumns(index),
    })
  } catch (error) {
    return errorResponse(error, 'Error importando la tabla de mapeo')
  }
}

interface SkipGroup {
  reason: string
  rows: number
  /** Un par de ejemplos para poder encontrarlos en el fichero */
  examples: string[]
}

/**
 * Pasa la tabla leída a filas listas para stock_mappings.
 *
 * Lo que se toca y lo que no decide si el cruce de los lunes va a encontrar
 * el artículo o no:
 *   - la referencia del ERP se guarda TAL CUAL, con sus ceros a la izquierda
 *     y solo sin el «.0» que mete Excel. Los ceros son parte del código: en
 *     el volcado del cliente «0080997933» y «080997933» son dos artículos
 *     distintos. El cruce sigue encontrando las referencias que llegan sin
 *     relleno, pero por su vía de respaldo (ver crossStock);
 *   - la lista TODOS_EAN_ERP, por lo mismo, se guarda con sus códigos tal
 *     cual y no reescrita desde su forma normalizada: es el único sitio del
 *     mapeo donde sobrevive la referencia con el relleno original, porque la
 *     columna REF_ERP viene de un Excel que la guardó como número;
 *   - los EAN sí se normalizan: se quedan solo con los dígitos y sin el
 *     relleno del GTIN-14, porque ahí el cero de más es formato y no código;
 *   - el SKU y el ASIN se guardan tal cual, solo sin el «.0». Son cadenas
 *     opacas («05-NDKE-740Z») y normalizarlas generaría un fichero que Amazon
 *     rechaza porque ese SKU no existiría en la cuenta.
 */
function buildRows(
  table: Table,
  index: ColumnIndex,
  clientId: string
): { rows: MappingRow[]; skipped: SkipGroup[] } {
  const cell = (row: unknown[], key: ColumnKey): unknown =>
    index[key] === -1 ? null : row[index[key]]

  const counts: Record<SkipReason, { rows: number; examples: string[] }> = {
    sin_sku: { rows: 0, examples: [] },
    vacia: { rows: 0, examples: [] },
    repetida: { rows: 0, examples: [] },
  }

  const note = (reason: SkipReason, example: string) => {
    counts[reason].rows++
    if (example && counts[reason].examples.length < 5) counts[reason].examples.push(example)
  }

  // Map y no array: un SKU repetido dentro del mismo fichero reventaría el
  // upsert entero con «ON CONFLICT DO UPDATE command cannot affect row a
  // second time», que es un error de Postgres que no dice absolutamente nada
  // a quien ha subido el fichero. Gana la última aparición.
  const bySku = new Map<string, MappingRow>()

  for (const row of table.rows) {
    if (row.every((value) => value === null || value === undefined || String(value).trim() === '')) {
      note('vacia', '')
      continue
    }

    const sku = cleanSku(cell(row, 'sku_amazon'))
    if (!sku) {
      note('sin_sku', plainText(cell(row, 'ref_erp')) || plainText(cell(row, 'asin')))
      continue
    }

    if (bySku.has(sku)) note('repetida', sku)

    // La lista se vuelve a montar solo para dejarla con un separador
    // uniforme y sin huecos («0050119247, 4050300646077, » y
    // «0050119247,4050300646077» decían lo mismo), pero cada código se queda
    // con la forma que traía. Normalizarlos aquí, como se hacía antes,
    // borraba las referencias con ceros que esta columna arrastra, que son
    // justo lo que permite al cruce distinguir dos artículos que solo se
    // diferencian en el relleno.
    const todos = parseCodeList(cell(row, 'todos_ean_erp'))

    bySku.set(sku, {
      client_id: clientId,
      sku_amazon: sku,
      ref_erp: exactCode(cell(row, 'ref_erp')) || null,
      asin: cleanSku(cell(row, 'asin')).toUpperCase() || null,
      ean_amazon: normalizeEan(cell(row, 'ean_amazon')) || null,
      ean_erp: normalizeEan(cell(row, 'ean_erp')) || null,
      ean_final: normalizeEan(cell(row, 'ean_final')) || null,
      origen_ean: text(cell(row, 'origen_ean')),
      metodo_match: text(cell(row, 'metodo_match')),
      sku_coincide: text(cell(row, 'sku_coincide')),
      ean_coincide: text(cell(row, 'ean_coincide')),
      todos_ean_erp: todos.length > 0 ? todos.join(', ') : null,
      situacion_erp: text(cell(row, 'situacion_erp')),
      titulo_amazon: text(cell(row, 'titulo_amazon')),
      notes: text(cell(row, 'notes')),
    })
  }

  const skipped: SkipGroup[] = (Object.keys(counts) as SkipReason[])
    .filter((reason) => counts[reason].rows > 0)
    .map((reason) => ({
      reason: SKIP_LABELS[reason],
      rows: counts[reason].rows,
      examples: counts[reason].examples,
    }))

  return { rows: [...bySku.values()], skipped }
}

/** Todos los SKU que el cliente ya tiene, para distinguir un alta de una actualización */
async function fetchExistingSkus(
  supabase: StockSupabase,
  clientId: string
): Promise<Set<string>> {
  const rows = await fetchAll<{ sku_amazon: string }>((from, to) =>
    supabase
      .from('stock_mappings')
      .select('sku_amazon')
      .eq('client_id', clientId)
      .order('id', { ascending: true })
      .range(from, to)
  )

  return new Set(rows.map((row) => row.sku_amazon))
}

/**
 * Columnas de las importantes que el fichero no traía.
 *
 * Solo se avisa de las que participan en el cruce; que falte TITULO_AMAZON no
 * cambia nada porque es para reconocer la fila en pantalla.
 */
function missingColumns(index: ColumnIndex): string[] {
  const relevant: ColumnKey[] = ['ref_erp', 'asin', 'ean_amazon', 'ean_erp', 'ean_final']
  return relevant.filter((key) => index[key] === -1).map((key) => COLUMNS[key][0])
}

/**
 * Texto libre saneado. Se corta a 500 caracteres porque las columnas de
 * diagnóstico son TEXT sin límite y un fichero mal formado (una celda con un
 * salto de línea que se come el resto de la tabla) metería un párrafo entero
 * en una columna que se enseña en una celda de la pantalla.
 */
function text(value: unknown): string | null {
  const clean = plainText(value).slice(0, 500)
  return clean || null
}
