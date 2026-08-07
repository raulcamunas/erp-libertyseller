/**
 * Motor de sincronización de stock: del volcado del ERP del cliente al
 * fichero de tres columnas que se sube a Amazon.
 *
 * Aquí no hay Supabase ni React a propósito. Todo lo que decide qué unidades
 * acaban publicadas en cada listing vive en este fichero, es puro y se puede
 * ejecutar con dos buffers y una lista de mapeos, que es la única forma de
 * comprobar un cruce sin montar media aplicación.
 *
 * Lo que hay que tener en la cabeza al tocar esto: un cruce que falla NO da
 * error. O deja el SKU fuera del envío (Amazon se queda con el stock viejo y
 * el cliente vende lo que no tiene) o lo casa con el artículo equivocado
 * (Amazon publica las unidades de otro producto). Por eso cada fila lleva
 * anotada la vía por la que casó y por eso las ambigüedades se descartan en
 * vez de resolverse a ojo.
 *
 * REGLA QUE NO SE PUEDE DESHACER SIN ROMPER EL MÓDULO: la identidad de un
 * artículo es su código EXACTO, tal cual viene en el fichero del cliente. La
 * forma normalizada (sin ceros a la izquierda) es solo una clave de búsqueda
 * de respaldo. El porqué, con los cuatro artículos que lo demuestran, está
 * escrito en crossStock().
 */

import * as XLSX from 'xlsx'
import {
  StockMatchMethod,
  exactCode,
  normalizeCode,
  normalizeEan,
  parseCodeList,
  parseEanList,
} from '@/lib/types/stock-sync'

// =====================================================
// Tipos
// =====================================================

/** Los buffers llegan de `File.arrayBuffer()` en las rutas y de `readFileSync` en las pruebas */
export type WorkbookInput = ArrayBuffer | Uint8Array | Buffer

/** Una línea del volcado de stock del cliente (fichero ARTICULOS_STOCK_COSTE PROMEDIO) */
export interface StockLine {
  /**
   * IDENTIDAD del artículo: el código tal cual viene, con sus ceros a la
   * izquierda. Es lo que se enseña al auditar y la clave del índice del cruce.
   */
  articulo: string
  /**
   * El mismo código pasado por normalizeCode(). NO identifica al artículo:
   * es solo la clave de búsqueda de respaldo con la que se encuentra un
   * código que el mapeo escribe sin relleno.
   */
  articuloNorm: string
  descripcion: string
  /** «St. Real» ya saneado: entero y nunca negativo */
  stock: number
}

/**
 * Códigos de barras que el ERP tiene para cada artículo (fichero
 * ARTICULOS_EAN), indexados por el código EXACTO del artículo.
 *
 * Que la clave sea la forma exacta es la mitad del arreglo: indexando por la
 * forma normalizada, dos artículos distintos que solo se diferencian en un
 * cero acababan compartiendo entrada y sus listas de EAN se fusionaban. El
 * EAN es justo el dato que los distingue sin discusión, y se perdía al
 * indexar, así que el desempate por EAN no podía funcionar.
 */
export type EanIndex = Map<string, string[]>

/**
 * Lo que el motor necesita de una fila de mapeo. Es un subconjunto de
 * StockMapping (lib/types/stock-sync.ts) para que se pueda cruzar con filas
 * recién leídas de un Excel, que todavía no tienen id ni client_id.
 */
export interface CrossMapping {
  sku_amazon: string
  ref_erp?: string | null
  asin?: string | null
  ean_amazon?: string | null
  ean_erp?: string | null
  ean_final?: string | null
  todos_ean_erp?: string | null
  /** De dónde salió EAN_FINAL: «ERP» o «Helium 10». Decide si ese EAN vale como prueba del almacén o solo del listing */
  origen_ean?: string | null
}

/** Una fila del fichero que se sube a Amazon, con el rastro de cómo se obtuvo */
export interface AmazonStockRow {
  sku: string
  asin: string | null
  stock: number
  /** Referencia del ERP que traía el mapeo, para poder rehacer el cruce a mano */
  refErp: string | null
  /** Artículo del volcado del que salió el stock; con ceros, tal cual lo escribe el cliente */
  articulo: string
  via: StockMatchMethod
}

/**
 * Por qué se quedó fuera un SKU. Son motivos distintos con arreglos
 * distintos: `sin_referencia` se arregla completando el mapeo, `sin_articulo`
 * es un artículo que ya no está en el ERP (listing a retirar) y los dos
 * ambiguos son códigos que el ERP reparte entre varios artículos y hay que
 * decidir a mano cuál es.
 */
export type UnmatchedReason =
  | 'sin_referencia'
  | 'sin_articulo'
  | 'ref_ambigua'
  | 'ean_ambiguo'
  | 'sku_vacio'

export const UNMATCHED_REASON_LABELS: Record<UnmatchedReason, string> = {
  sin_referencia: 'El mapeo no trae ni referencia del ERP ni EAN con el que buscar',
  sin_articulo: 'La referencia o el EAN no aparecen en el volcado del cliente',
  ref_ambigua:
    'La referencia solo casa quitándole los ceros a la izquierda y así lleva a varios artículos con stock distinto; ningún EAN los desempata',
  ean_ambiguo: 'El EAN pertenece a varios artículos del ERP con stock distinto',
  sku_vacio: 'La fila de mapeo no tiene SKU de Amazon',
}

export interface UnmatchedRow {
  sku: string
  asin: string | null
  refErp: string | null
  reason: UnmatchedReason
  /** Frase lista para enseñar en pantalla, con el dato concreto que falló */
  detail: string
}

export interface CrossStats {
  /**
   * Filas de mapeo que se han cruzado, ya sin los SKU repetidos.
   * Se cumple siempre `mappings === matched + unmatched`: es lo que permite
   * leer un stock_runs viejo y saber que no falta nada por el camino.
   */
  mappings: number
  /** SKU que venían más de una vez en el mapeo; gana la última fila */
  duplicatedSkus: number
  /** Líneas leídas del volcado del cliente */
  stockLines: number
  /** Artículos distintos del volcado; difiere de stockLines si el cliente repite alguno */
  stockArticles: number
  matched: number
  unmatched: number
  /** Suma de unidades que se van a publicar; un total sospechosamente bajo delata un volcado a medias */
  totalUnits: number
  /** SKU que casaron pero con cero unidades. No es un error, pero conviene verlo antes de subirlo */
  zeroStock: number
  byVia: Record<StockMatchMethod, number>
  /** Avisos en español para enseñar tal cual; no impiden generar el fichero */
  warnings: string[]
}

export interface CrossInput {
  mappings: CrossMapping[]
  stockLines: StockLine[]
  /**
   * Opcional: sin él se pierde la vía por EAN entera, que es la que desempata
   * las referencias que solo se diferencian en los ceros. Las dos vías por
   * referencia siguen funcionando.
   */
  eanIndex?: EanIndex | null
}

export interface CrossResult {
  rows: AmazonStockRow[]
  unmatched: UnmatchedRow[]
  stats: CrossStats
}

/** Una tabla ya leída de un Excel o un CSV: cabeceras y filas como arrays */
export interface Table {
  /** Hoja de la que salió; en un CSV, «CSV» */
  sheet: string
  headers: string[]
  rows: unknown[][]
}

// =====================================================
// Lectura de ficheros
// =====================================================

/**
 * El cliente exporta siempre desde la misma pantalla de su ERP y la hoja se
 * llama «Browser», pero el nombre no se da por hecho: si algún día exporta
 * desde otro sitio, readTable cae al reconocimiento por columnas y el
 * proceso sigue funcionando.
 */
const ERP_SHEET = 'Browser'

/** Cabecera plausible en las primeras filas; más abajo ya es data y no cabecera */
const HEADER_SCAN_ROWS = 20

/**
 * Deja una cabecera en la forma con la que se compara: sin tildes, sin
 * mayúsculas y sin puntuación.
 *
 * Es imprescindible, no cosmético. El ERP escribe «Artículo» y
 * «Cód.Artículo» con tilde y con punto, mientras que la documentación del
 * módulo y los CSV que se importan a mano hablan de «Articulo» y
 * «Cod.Articulo». Comparar los literales deja el fichero sin reconocer y el
 * proceso entero se cae por una tilde.
 */
export function normalizeHeader(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Índice de la primera columna cuya cabecera case con alguno de los
 * candidatos, o -1.
 *
 * Primero busca coincidencia exacta y solo después «empieza por». El orden
 * importa: buscando «EAN_FINAL» en un fichero que no la trae, el candidato
 * corto «EAN» se llevaría por delante la columna «EAN_AMAZON», y a partir de
 * ahí el cruce usaría el EAN de Amazon creyendo que es el bueno. La pasada
 * exacta resuelve todos los nombres completos antes de que ningún prefijo
 * tenga ocasión de equivocarse.
 *
 * `taken` son las columnas que ya se ha llevado otro campo. Es la segunda
 * mitad de la misma protección: sin ella, dos campos distintos pueden acabar
 * leyendo la misma columna y nadie se entera.
 */
export function findColumn(
  headers: string[],
  candidates: string[],
  taken?: ReadonlySet<number>
): number {
  const normalized = headers.map(normalizeHeader)
  const wanted = candidates.map(normalizeHeader).filter(Boolean)
  const free = (index: number): boolean => index !== -1 && !taken?.has(index)

  for (const candidate of wanted) {
    const exact = normalized.findIndex((h, i) => h === candidate && free(i))
    if (exact !== -1) return exact
  }
  for (const candidate of wanted) {
    const prefix = normalized.findIndex((h, i) => h.startsWith(candidate) && free(i))
    if (prefix !== -1) return prefix
  }
  return -1
}

/**
 * Lee un .xlsx, un .xls o un .csv y devuelve la primera tabla que encaje.
 *
 * `required` son cabeceras que la hoja tiene que traer para darla por buena.
 * Con eso se reconoce el fichero por su contenido y no por el nombre de la
 * hoja ni por la posición de las columnas, que es lo que permite que el
 * cliente añada una columna nueva a su exportación sin romper el proceso.
 *
 * La cabecera se busca en las primeras filas en vez de asumir la 1 porque
 * los Excel de trabajo llevan a menudo un título o una fila en blanco
 * delante (la tabla de mapeo, sin ir más lejos, empieza en la columna B).
 */
export function readTable(
  input: WorkbookInput,
  options: { sheet?: string; required?: string[] } = {}
): Table {
  const workbook = readWorkbook(input)
  if (workbook.SheetNames.length === 0) {
    throw new StockSyncError('El fichero no tiene ninguna hoja con datos')
  }

  const required = (options.required ?? []).map(normalizeHeader).filter(Boolean)

  // La hoja preferida primero, luego el resto en el orden del libro: así el
  // fichero de siempre se lee por el camino rápido y uno raro aún tiene
  // oportunidad de reconocerse por columnas.
  const preferred = options.sheet
    ? workbook.SheetNames.filter(
        (name) => normalizeHeader(name) === normalizeHeader(options.sheet)
      )
    : []
  const order = [...preferred, ...workbook.SheetNames.filter((n) => !preferred.includes(n))]

  let firstNonEmpty: Table | null = null

  for (const name of order) {
    const sheet = workbook.Sheets[name]
    if (!sheet) continue

    const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      blankrows: false,
      raw: true,
    })
    if (grid.length === 0) continue

    const limit = Math.min(grid.length, HEADER_SCAN_ROWS)
    for (let i = 0; i < limit; i++) {
      const candidate = (grid[i] ?? []).map((cell) => (cell === null || cell === undefined ? '' : String(cell).trim()))
      const filled = candidate.filter(Boolean).length
      if (filled < 2) continue

      const table: Table = { sheet: name, headers: candidate, rows: grid.slice(i + 1) }
      if (required.length === 0) return table

      const normalized = candidate.map(normalizeHeader)
      const hasAll = required.every((req) => normalized.some((h) => h === req || h.startsWith(req)))
      if (hasAll) return table

      // Se guarda por si NINGUNA hoja trae las columnas pedidas: el error que
      // se lanza al final enseña las cabeceras que sí había, que es lo que
      // permite a quien sube el fichero entender qué mandó.
      if (!firstNonEmpty) firstNonEmpty = table
      break
    }
  }

  if (required.length > 0) {
    const seen = firstNonEmpty?.headers.filter(Boolean).join(', ') || 'ninguna'
    throw new StockSyncError(
      `No se encontró una hoja con las columnas ${options.required!.join(', ')}. ` +
        `Las columnas del fichero son: ${seen}`
    )
  }
  if (firstNonEmpty) return firstNonEmpty

  throw new StockSyncError('El fichero no tiene ninguna fila con datos')
}

/**
 * Lee el volcado de stock del cliente (hoja «Browser», ~21.000 filas).
 *
 * Solo se queda con lo que hace falta para cruzar y para auditar: el resto de
 * columnas del volcado (coste medio, tarifas, ubicación) son datos internos
 * del cliente que no pintan nada en un proceso que acaba en Amazon.
 */
export function parseStockWorkbook(input: WorkbookInput): StockLine[] {
  const table = readTable(input, { sheet: ERP_SHEET, required: ['articulo', 'st real'] })

  const iArticulo = findColumn(table.headers, ['Articulo', 'Cod.Articulo', 'Codigo articulo'])
  const iDesc = findColumn(table.headers, ['Descrip.Propia', 'Descripcion', 'Descripcion propia'])
  const iStock = findColumn(table.headers, ['St. Real', 'St.Real', 'Stock real', 'Stock'])

  if (iArticulo === -1 || iStock === -1) {
    throw new StockSyncError(
      'El fichero de stock no trae las columnas «Artículo» y «St. Real». ' +
        `Columnas encontradas: ${table.headers.filter(Boolean).join(', ') || 'ninguna'}`
    )
  }

  const out: StockLine[] = []

  for (const row of table.rows) {
    // exactCode() y no plainText(): el código se guarda con sus ceros a la
    // izquierda porque son parte de la identidad del artículo, y solo se le
    // quita el «.0» que mete Excel al leerlo como número.
    const articulo = exactCode(row[iArticulo])
    const articuloNorm = normalizeCode(articulo)
    // Una fila sin código no identifica nada; suele ser el pie de página que
    // el ERP añade al exportar (totales, fecha de la extracción). Se mira la
    // forma normalizada porque un código de solo ceros («0000») tampoco
    // identifica a nadie y ahí es donde se cae.
    if (!articuloNorm) continue

    const units = parseUnits(row[iStock])

    out.push({
      articulo,
      articuloNorm,
      descripcion: iDesc === -1 ? '' : plainText(row[iDesc]),
      // Un stock ilegible se trata como cero y no se descarta la línea: el
      // artículo existe, y publicar 0 es correcto y prudente. Descartarlo
      // dejaría en Amazon el stock del envío anterior, que es lo que provoca
      // ventas de lo que no hay.
      stock: units === null ? 0 : sanitizeUnits(units),
    })
  }

  if (out.length === 0) {
    throw new StockSyncError('El fichero de stock no trae ninguna línea con código de artículo')
  }

  return out
}

/**
 * Lee el fichero de códigos de barras del ERP (~36.000 filas) y devuelve el
 * índice código exacto de artículo -> sus EAN-13.
 *
 * Solo entran los de Tipo 1 (EAN-13). El fichero mezcla tres tipos y los
 * demás son códigos internos del ERP («0004000342.PZ»), que no identifican el
 * producto fuera de casa del cliente: si se colaran, dos artículos distintos
 * podrían casar por un código interno parecido y el stock acabaría en el
 * listing equivocado.
 *
 * La columna «Habitual» NO se lee, y no es un olvido. En este ERP el código
 * marcado como Habitual = «Si» es un código interno de Tipo 2
 * («0080997933.01»); los EAN-13 de verdad vienen todos con Habitual = «No».
 * Distinguir un EAN «habitual» de otro «secundario» aquí era inventarse una
 * jerarquía que el fichero no tiene: se quedan todos al mismo nivel.
 */
export function parseEanWorkbook(input: WorkbookInput): EanIndex {
  const table = readTable(input, {
    sheet: ERP_SHEET,
    required: ['cod articulo', 'codigo de barras'],
  })

  const iArticulo = findColumn(table.headers, [
    'Cod.Articulo',
    'Codigo articulo',
    'Articulo',
  ])
  const iBarcode = findColumn(table.headers, ['Codigo de Barras', 'Codigo barras', 'EAN'])
  const iTipo = findColumn(table.headers, ['Tipo'])

  if (iArticulo === -1 || iBarcode === -1) {
    throw new StockSyncError(
      'El fichero de EAN no trae las columnas «Cód.Artículo» y «Código de Barras». ' +
        `Columnas encontradas: ${table.headers.filter(Boolean).join(', ') || 'ninguna'}`
    )
  }

  const index: EanIndex = new Map()

  for (const row of table.rows) {
    // Por el código EXACTO. Con la forma normalizada, «0080997933» y
    // «080997933» —dos artículos distintos— compartían entrada y sus EAN se
    // fusionaban, que es lo que dejaba sin munición al desempate por EAN.
    const articulo = exactCode(row[iArticulo])
    if (!normalizeCode(articulo)) continue

    // Sin columna Tipo se acepta todo lo que normalizeEan dé por bueno: es
    // peor no poder leer el fichero que fiarse de la criba por longitud.
    if (iTipo !== -1 && parseUnits(row[iTipo]) !== 1) continue

    const ean = normalizeEan(row[iBarcode])
    if (!ean) continue

    push(index, articulo, ean)
  }

  return index
}

// =====================================================
// El cruce
// =====================================================

/**
 * Cruza la tabla de mapeo con el volcado del cliente y devuelve lo que se
 * sube a Amazon, lo que se queda fuera y las estadísticas del proceso.
 *
 * El orden de las vías va de más fiable a menos y la primera que acierta
 * manda:
 *   1. 'ref_exacta'  — el código del mapeo coincide EXACTAMENTE, ceros
 *      incluidos, con un código del volcado. Es una igualdad entre dos
 *      códigos del mismo sistema escritos igual: no hay forma de que sea
 *      otro artículo. Se prueban la REF_ERP y también los códigos que
 *      arrastra TODOS_EAN_ERP, que es donde sobrevive la referencia con su
 *      relleno original cuando la columna REF_ERP ya lo perdió.
 *   2. 'ean_erp'     — un EAN sacado del propio ERP del cliente (EAN_ERP,
 *      TODOS_EAN_ERP, y EAN_FINAL cuando ORIGEN_EAN dice que vino del ERP)
 *      lleva a un único artículo. Necesita el fichero de EAN. Va por delante
 *      de cualquier apaño con los ceros porque un EAN-13 identifica el
 *      producto sin discusión: es el desempate bueno cuando dos referencias
 *      se pisan.
 *   3. 'ref_padding' — la referencia solo casa después de quitarle los ceros
 *      a la izquierda, y esa forma lleva a UN único código del volcado. Es
 *      la vía que hace falta porque el mapeo guarda «50119247» y el volcado
 *      escribe «0050119247»; sin ella casarían 111 de las 392 líneas. Es la
 *      que recoge todo lo que el EAN no haya resuelto antes, así que si el
 *      proceso se lanza sin el fichero de EAN se lleva casi todas.
 *   4. 'ean_listing' — el EAN que figura en la ficha de Amazon (EAN_AMAZON, o
 *      EAN_FINAL si salió de Helium 10). Va el último porque describe el
 *      producto del catálogo de Amazon, no el artículo del almacén del
 *      cliente, y en 5 filas de este mapeo se sabe que discrepan. Cuando la
 *      referencia del cliente dice una cosa y este EAN otra, manda el
 *      cliente; aquí abajo solo recoge lo que nadie más ha sabido casar.
 *   Si la forma normalizada lleva a VARIOS códigos y ningún EAN ha
 *   desempatado, el SKU se descarta ('ref_ambigua'). Entre dejar el listing
 *   con el stock de ayer y publicarle las unidades de otro artículo, lo
 *   primero se arregla mañana y lo segundo se vende hoy.
 *
 * Registrar por qué vía casó cada fila es la razón de ser de todo esto: sin
 * ese dato, cuando un producto sale en Amazon con las unidades de otro no hay
 * forma de saber si el fallo estaba en la referencia o en un EAN compartido.
 */
export function crossStock({ mappings, stockLines, eanIndex }: CrossInput): CrossResult {
  const warnings: string[] = []

  // ---------- Índices del volcado ----------
  //
  // LA IDENTIDAD DE UN ARTÍCULO ES SU CÓDIGO EXACTO, y esto conviene dejarlo
  // por escrito porque es la clase de decisión que alguien deshace sin querer
  // dentro de seis meses. En el ERP del cliente los ceros a la izquierda son
  // significativos: en el mismo volcado conviven
  //
  //   0080997933  EAN 5410288431161  «LED PLAFON 17W 830 IP44»   stock 1
  //   080997933   EAN 5410288302201  «LED PLS 2P G23 4,5W»       stock 0
  //
  // que son dos productos distintos, con su propio código de barras y su
  // propio stock. Indexar por la forma normalizada los colapsaba en una sola
  // clave: el motor detectaba el choque, no podía elegir y dejaba fuera del
  // fichero los SKU que dependían de ellos.
  //
  // La forma normalizada sigue haciendo falta, pero como CLAVE DE BÚSQUEDA y
  // nunca como identidad: el mapeo guarda «50119247» y el volcado escribe
  // «0050119247», y sin ese segundo índice casarían 111 de 392 líneas en vez
  // de 392 de 392. De ahí los dos índices: el exacto dice QUIÉN es cada
  // artículo, el normalizado sirve para ENCONTRARLO.
  const stockByExact = new Map<string, StockLine[]>()
  const exactByNorm = new Map<string, string[]>()
  for (const line of stockLines) {
    push(stockByExact, line.articulo, line)
    push(exactByNorm, line.articuloNorm, line.articulo)
  }

  // Códigos que solo se diferencian en los ceros y que además tienen stock
  // distinto. Los que coinciden en stock no son problema: da igual por cuál
  // se resuelva. Se guardan para poder nombrarlos en el aviso, que solo se
  // escribe si al final algún SKU se ha quedado fuera por su culpa.
  const collisions = new Map<string, StockLine[]>()
  for (const [norm, codes] of exactByNorm) {
    if (codes.length < 2) continue
    const lines = codes.flatMap((code) => stockByExact.get(code) ?? [])
    if (new Set(lines.map((line) => line.stock)).size > 1) collisions.set(norm, lines)
  }

  // ---------- Índice por EAN ----------
  // Uno solo, y con el código EXACTO del artículo como valor. Antes había dos
  // («habitual» y «cualquiera») y el del habitual casaba CERO filas en la
  // ejecución real: en este ERP el código marcado como Habitual = «Si» es un
  // código interno de Tipo 2 y los EAN-13 buenos vienen todos con «No», así
  // que aquella jerarquía no existía en los datos.
  const articlesByEan = new Map<string, string[]>()
  if (eanIndex) {
    for (const [articulo, eans] of eanIndex) {
      for (const ean of eans) push(articlesByEan, ean, articulo)
    }
  }

  // ---------- SKU repetidos en el mapeo ----------
  // La base de datos lo impide con UNIQUE (client_id, sku_amazon), pero esto
  // también se ejecuta sobre filas recién leídas de un Excel, donde sí pasa.
  // Gana la última, que es la convención de la importación.
  const bySku = new Map<string, CrossMapping>()
  const emptySku: UnmatchedRow[] = []
  let duplicatedSkus = 0

  for (const mapping of mappings) {
    const sku = cleanSku(mapping.sku_amazon)
    if (!sku) {
      emptySku.push({
        sku: '',
        asin: cleanSku(mapping.asin) || null,
        refErp: plainText(mapping.ref_erp) || null,
        reason: 'sku_vacio',
        detail: UNMATCHED_REASON_LABELS.sku_vacio,
      })
      continue
    }
    if (bySku.has(sku)) duplicatedSkus++
    bySku.set(sku, mapping)
  }

  if (duplicatedSkus > 0) {
    warnings.push(
      `${duplicatedSkus} SKU venían repetidos en el mapeo; se ha usado la última fila de cada uno`
    )
  }

  // ---------- Cruce ----------
  const rows: AmazonStockRow[] = []
  const unmatched: UnmatchedRow[] = [...emptySku]
  const byVia: Record<StockMatchMethod, number> = {
    ref_exacta: 0,
    ean_erp: 0,
    ref_padding: 0,
    ean_listing: 0,
    sin_casar: 0,
  }

  for (const [sku, mapping] of bySku) {
    const refErp = plainText(mapping.ref_erp) || null
    const asin = cleanSku(mapping.asin) || null

    const refExact = exactCode(mapping.ref_erp)
    const refNorm = normalizeCode(mapping.ref_erp)

    // ---------- Vía 1: código exacto ----------
    // La referencia del mapeo primero y, si no está, los códigos que arrastra
    // TODOS_EAN_ERP: esa columna mezcla los EAN del artículo con su
    // referencia CON el relleno original («0008099793301, 0080997933,
    // 5410288431161»), y esa referencia con ceros suele ser el único sitio
    // del mapeo donde la forma exacta ha sobrevivido, porque la columna
    // REF_ERP venía de un Excel que guardó el código como número.
    //
    // Un EAN-13 de esa lista nunca va a coincidir con un código de artículo
    // (13 dígitos frente a los 8-10 del ERP), así que no hace falta cribarlos
    // antes: los que no son referencias simplemente no encuentran nada.
    const exactCandidates = uniqueStrings([refExact, ...parseCodeList(mapping.todos_ean_erp)])
    const exact = resolveExact(exactCandidates, stockByExact)
    if (exact.line) {
      rows.push({
        sku,
        asin,
        stock: exact.line.stock,
        refErp,
        articulo: exact.line.articulo,
        via: 'ref_exacta',
      })
      byVia.ref_exacta++
      continue
    }

    // De dónde salió cada EAN importa, y mucho. Un EAN del ERP del cliente
    // dice qué artículo tiene en el almacén; un EAN sacado del listing de
    // Amazon (columna EAN_AMAZON, o EAN_FINAL cuando ORIGEN_EAN dice «Helium
    // 10») dice qué producto cree Amazon que se vende en esa ficha, que no
    // siempre es lo mismo. En este mapeo hay 5 filas donde justamente
    // discrepan — el propio cliente las marcó «REVISAR (SKU y EAN discrepan)»:
    // son artículos de importación suyos publicados sobre ASIN de OSRAM, así
    // que el EAN del listing lleva al artículo de OSRAM y no al suyo.
    //
    // Todos los EAN-13 van al mismo nivel dentro de su grupo, sin distinguir
    // «habitual» de «secundario»: en este ERP el habitual no es un EAN (ver
    // parseEanWorkbook).
    const eanFromErp = (mapping.origen_ean ?? '').toUpperCase().includes('ERP')
    const erpEans = uniqueStrings([
      eanFromErp ? normalizeEan(mapping.ean_final) : null,
      normalizeEan(mapping.ean_erp),
      ...parseEanList(mapping.todos_ean_erp),
    ])
    const listingEans = uniqueStrings([
      normalizeEan(mapping.ean_amazon),
      eanFromErp ? null : normalizeEan(mapping.ean_final),
    ]).filter((ean) => !erpEans.includes(ean))

    // ---------- Vía 2: EAN del ERP ----------
    // Va por delante de cualquier apaño con los ceros a propósito: el EAN es
    // el desempate bueno. Si resuelve, gana sobre cualquier ambigüedad de la
    // referencia, que es exactamente lo que salva a los artículos que solo se
    // diferencian en un cero.
    const byErpEan = resolveByEan(erpEans, articlesByEan, stockByExact, exactByNorm)
    if (byErpEan.line) {
      rows.push({
        sku,
        asin,
        stock: byErpEan.line.stock,
        refErp,
        articulo: byErpEan.line.articulo,
        via: 'ean_erp',
      })
      byVia.ean_erp++
      continue
    }

    // ---------- Vía 3: referencia sin ceros ----------
    // El respaldo que hace que el mapeo («50119247») encuentre el volcado
    // («0050119247»). Solo vale si la forma normalizada lleva a UN código
    // exacto: si lleva a varios, ya no se sabe cuál es y se descarta.
    const paddedCodes = refNorm ? (exactByNorm.get(refNorm) ?? []) : []
    const padded = pickLine(paddedCodes.flatMap((code) => stockByExact.get(code) ?? []))
    if (padded.line) {
      rows.push({
        sku,
        asin,
        stock: padded.line.stock,
        refErp,
        articulo: padded.line.articulo,
        via: 'ref_padding',
      })
      byVia.ref_padding++
      continue
    }

    // ---------- Vía 4: EAN del listing ----------
    // Después de la referencia a propósito: cuando la referencia del cliente
    // dice una cosa y el EAN del listing otra, manda el cliente, que es quien
    // sabe lo que tiene en el almacén. Aquí abajo ya no compite con nada — o
    // el mapeo no trae referencia (53 filas del mapeo actual solo tienen el
    // EAN de Amazon) o esa referencia no ha encontrado nada. Peor sería
    // dejar el SKU fuera.
    const byListingEan = resolveByEan(listingEans, articlesByEan, stockByExact, exactByNorm)
    if (byListingEan.line) {
      rows.push({
        sku,
        asin,
        stock: byListingEan.line.stock,
        refErp,
        articulo: byListingEan.line.articulo,
        via: 'ean_listing',
      })
      byVia.ean_listing++
      continue
    }

    // ---------- Sin casar ----------
    // Una ambigüedad se descarta a conciencia: entre dejar el listing con el
    // stock de ayer y publicarle las unidades de otro artículo, lo primero se
    // arregla mañana y lo segundo se vende hoy.
    const conflict = padded.conflict ?? exact.conflict
    if (conflict) {
      const candidatos = conflict.map((line) => `${line.articulo} = ${line.stock}`).join(', ')

      unmatched.push({
        sku,
        asin,
        refErp,
        reason: 'ref_ambigua',
        detail: padded.conflict
          ? // El caso corriente: la referencia solo casa sin sus ceros, y así
            // vale para varios artículos distintos.
            `La referencia ${refErp} lleva a ${conflict.length} artículos del volcado con stock ` +
            `distinto (${candidatos}) y esta fila no trae ningún EAN que los desempate. ` +
            'Rellena su EAN_FINAL en el mapeo, o escribe la REF_ERP tal cual sale en el volcado, ' +
            'con sus ceros a la izquierda'
          : // El raro: el mismo código exacto aparece repetido en el volcado.
            // Aquí no hay nada que afinar en el mapeo, el fichero del cliente
            // trae el artículo dos veces con cantidades distintas.
            `El código ${refErp} aparece repetido en el volcado con stock distinto (${candidatos}). ` +
            'Pregunta al cliente cuál de las dos líneas es la buena: no es algo que se arregle ' +
            'desde el mapeo',
      })
      continue
    }

    const eanAmbiguous = byErpEan.ambiguous ?? byListingEan.ambiguous
    if (eanAmbiguous) {
      unmatched.push({
        sku,
        asin,
        refErp,
        reason: 'ean_ambiguo',
        detail: `El EAN ${eanAmbiguous.ean} está en ${eanAmbiguous.articulos.length} artículos del ERP con stock distinto (${eanAmbiguous.articulos.slice(0, 3).join(', ')})`,
      })
      continue
    }

    if (!refNorm && erpEans.length === 0 && listingEans.length === 0) {
      unmatched.push({
        sku,
        asin,
        refErp,
        reason: 'sin_referencia',
        detail: UNMATCHED_REASON_LABELS.sin_referencia,
      })
      continue
    }

    unmatched.push({
      sku,
      asin,
      refErp,
      reason: 'sin_articulo',
      detail: refNorm
        ? `La referencia ${refErp} no está en el volcado del cliente`
        : `Ninguno de sus EAN (${[...erpEans, ...listingEans].slice(0, 3).join(', ')}) está en el ERP del cliente`,
    })
  }

  // El aviso de los códigos que chocan al normalizar solo se escribe si ha
  // costado algún SKU. Que el volcado traiga «0080997933» y «080997933» es
  // normal y lo habitual es que el EAN los resuelva sin que nadie tenga que
  // hacer nada: avisar siempre sería ruido que enseña a ignorar los avisos.
  const refAmbiguas = unmatched.filter((row) => row.reason === 'ref_ambigua').length
  if (refAmbiguas > 0) {
    const ejemplos = [...collisions.values()]
      .slice(0, 2)
      .map((lines) => lines.map((line) => line.articulo).join(' / '))
      .join('; ')

    warnings.push(
      `${refAmbiguas} SKU se han quedado fuera porque su referencia, una vez quitados los ceros a la ` +
        'izquierda, lleva a varios artículos del volcado con stock distinto y no traen ningún EAN del ' +
        `ERP que los desempate${ejemplos ? ` (${ejemplos})` : ''}. Lo que los arregla es rellenar el ` +
        'EAN_FINAL de esas filas del mapeo; si el artículo no tiene EAN, escribe su REF_ERP tal cual ' +
        'sale en el volcado, con los ceros incluidos, que el cruce la usa antes de intentar nada más'
    )
  }

  // Orden por SKU: el fichero de un lunes y el del jueves siguiente se pueden
  // comparar línea a línea, que es como se detecta un volcado raro antes de
  // subirlo. Comparación por punto de código, no localeCompare: tiene que dar
  // el mismo orden en el servidor y en cualquier máquina, sin depender del
  // locale instalado.
  rows.sort((a, b) => (a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0))

  // Se cuenta al final y no dentro del bucle para que incluya también las
  // filas sin SKU, que se apartan antes de cruzar. Así se mantiene la
  // igualdad matched + sin_casar = mappings, que es lo que se comprueba de un
  // vistazo al mirar un proceso que salió raro.
  byVia.sin_casar = unmatched.length

  const totalUnits = rows.reduce((sum, row) => sum + row.stock, 0)

  if (rows.length > 0 && totalUnits === 0) {
    warnings.push(
      'Todos los SKU que casaron salen con 0 unidades: revisa que el volcado sea el del día y no una plantilla vacía'
    )
  }

  return {
    rows,
    unmatched,
    stats: {
      mappings: bySku.size + emptySku.length,
      duplicatedSkus,
      stockLines: stockLines.length,
      // Artículos distintos de verdad, contados por código exacto: contarlos
      // por la forma normalizada escondía justo los que este módulo tiene que
      // saber distinguir.
      stockArticles: stockByExact.size,
      matched: rows.length,
      unmatched: unmatched.length,
      totalUnits,
      zeroStock: rows.filter((row) => row.stock === 0).length,
      byVia,
      warnings,
    },
  }
}

/** Un EAN que apunta a varios artículos del volcado con stock distinto */
interface AmbiguousEan {
  ean: string
  articulos: string[]
}

/**
 * Elige la línea de stock de un grupo de candidatos, o se niega a elegir.
 *
 * Varios candidatos solo son un problema cuando el stock difiere. El ERP del
 * cliente tiene 60 códigos de barras repartidos entre dos artículos (el mismo
 * producto dado de alta dos veces) y siete códigos que chocan al normalizar:
 * cuando todos los implicados van a cero, da igual por cuál se resuelva y
 * negarse a subir el SKU sería quedarse corto sin ganar nada.
 */
function pickLine(lines: StockLine[] | undefined): {
  line: StockLine | null
  conflict: StockLine[] | null
} {
  if (!lines || lines.length === 0) return { line: null, conflict: null }
  if (lines.length === 1) return { line: lines[0], conflict: null }

  const distinct = new Set(lines.map((line) => line.stock))
  if (distinct.size === 1) return { line: lines[0], conflict: null }

  return { line: null, conflict: lines }
}

/**
 * Primer código de `codes` que aparezca TAL CUAL en el volcado.
 *
 * Comparación de cadenas y nada más: sin quitar ceros, sin quitar guiones y
 * sin buscarle parecidos. Si el mapeo dice «0080997933» y el volcado dice
 * «0080997933», es ese artículo y no hay nada que interpretar. Es la única
 * vía del cruce que no puede equivocarse de producto.
 */
function resolveExact(
  codes: string[],
  stockByExact: Map<string, StockLine[]>
): { line: StockLine | null; conflict: StockLine[] | null } {
  let conflict: StockLine[] | null = null

  for (const code of codes) {
    const picked = pickLine(stockByExact.get(code))
    if (picked.line) return { line: picked.line, conflict: null }
    // El choque se guarda pero no corta el bucle: puede que el siguiente
    // código de la lista resuelva limpiamente, y eso es mejor que descartar.
    if (picked.conflict && !conflict) conflict = picked.conflict
  }

  return { line: null, conflict }
}

/**
 * Primer EAN de `eans` que lleve a un artículo con stock sin lugar a dudas.
 *
 * El artículo se busca primero por su código EXACTO, que es como lo guarda el
 * índice de EAN, y solo si el fichero de EAN escribe el código con un relleno
 * distinto al del volcado se cae a la clave normalizada. Ese orden importa:
 * al revés, un EAN que apunta a «0080997933» podría acabar resolviéndose
 * contra «080997933», que es otro producto.
 */
function resolveByEan(
  eans: string[],
  articlesByEan: Map<string, string[]>,
  stockByExact: Map<string, StockLine[]>,
  exactByNorm: Map<string, string[]>
): { line: StockLine | null; ambiguous: AmbiguousEan | null } {
  let ambiguous: AmbiguousEan | null = null

  for (const ean of eans) {
    const articulos = articlesByEan.get(ean) ?? []
    if (articulos.length === 0) continue

    let candidates = uniqueLines(articulos.flatMap((code) => stockByExact.get(code) ?? []))

    if (candidates.length === 0) {
      candidates = uniqueLines(
        articulos.flatMap((code) =>
          (exactByNorm.get(normalizeCode(code)) ?? []).flatMap(
            (exact) => stockByExact.get(exact) ?? []
          )
        )
      )
    }

    const picked = pickLine(candidates)
    if (picked.line) return { line: picked.line, ambiguous: null }

    // No se corta el bucle: puede que el siguiente EAN de la lista resuelva
    // sin ambigüedad, y eso es mejor que descartar el SKU.
    if (picked.conflict && !ambiguous) {
      ambiguous = { ean, articulos: picked.conflict.map((line) => line.articulo) }
    }
  }

  return { line: null, ambiguous }
}

/**
 * Quita líneas repetidas conservando el orden.
 *
 * Hace falta porque un mismo artículo puede llegar por dos caminos (dos
 * códigos del fichero de EAN que normalizan igual) y pickLine() vería dos
 * candidatos donde solo hay uno.
 */
function uniqueLines(lines: StockLine[]): StockLine[] {
  const seen = new Set<StockLine>()
  const out: StockLine[] = []
  for (const line of lines) {
    if (seen.has(line)) continue
    seen.add(line)
    out.push(line)
  }
  return out
}

// =====================================================
// Salida
// =====================================================

/** Las tres columnas del fichero de Amazon, en minúscula y en este orden */
const AMAZON_HEADERS = ['sku', 'asin', 'stock'] as const

/**
 * Genera el .xlsx que se sube a Amazon: tres columnas y nada más.
 *
 * Sin cabecera en negrita, sin panel congelado y sin hojas de apoyo, al
 * revés que el resto de exportaciones del ERP. Este fichero no lo lee una
 * persona, lo lee el cargador de inventario de Amazon, y cualquier columna
 * de más o cualquier adorno es motivo de rechazo del envío.
 *
 * El SKU se escribe como texto a propósito: muchos son solo dígitos y si
 * Excel los guardara como número, un SKU con ceros a la izquierda llegaría a
 * Amazon sin ellos y no casaría con ningún listing.
 */
export function buildAmazonWorkbook(rows: AmazonStockRow[]): Buffer {
  const data = rows.map((row) => ({
    sku: row.sku,
    // Celda vacía y no la palabra «null»: el cargador de Amazon identifica el
    // listing por el SKU, el ASIN es solo apoyo cuando existe.
    asin: row.asin ?? '',
    stock: row.stock,
  }))

  const sheet = XLSX.utils.json_to_sheet(data, { header: [...AMAZON_HEADERS] })
  sheet['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 8 }]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Stock')

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

/** El fichero de los que se quedan fuera. Este SÍ lo lee una persona, así que lleva el porqué */
const UNMATCHED_HEADERS = ['sku', 'asin', 'ref_erp', 'motivo', 'detalle'] as const

/**
 * Genera el .xlsx de listings sin resolver: los que NO se han subido a Amazon.
 *
 * Es la lista de trabajo pendiente, no un informe de errores. Cada fila lleva
 * el motivo y el dato concreto que falló porque quien la abre tiene que poder
 * arreglar el mapeo sin volver a lanzar el proceso para averiguar qué pasaba.
 *
 * Va aparte del fichero de Amazon a propósito y nunca mezclado con él: una
 * sola fila de estas colada en el fichero de inventario pondría un listing a
 * cero por un fallo de cruce, que es justo lo que el módulo evita.
 */
export function buildUnmatchedWorkbook(rows: UnmatchedRow[]): Buffer {
  const data = rows.map((row) => ({
    sku: row.sku,
    asin: row.asin ?? '',
    ref_erp: row.refErp ?? '',
    motivo: UNMATCHED_REASON_LABELS[row.reason] ?? row.reason,
    detalle: row.detail,
  }))

  const sheet = XLSX.utils.json_to_sheet(data, { header: [...UNMATCHED_HEADERS] })
  sheet['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 16 }, { wch: 52 }, { wch: 72 }]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sin casar')

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

/**
 * Pasa los listings sin resolver a filas de salida con cero unidades.
 *
 * Solo se usa cuando alguien enciende el interruptor de la pantalla, que está
 * apagado por defecto: «no sé cuánto stock tiene» y «no tiene stock» no son lo
 * mismo, y un volcado que llegue a medias tumbaría listings con producto.
 *
 * Los que no traen SKU se caen aquí: sin SKU no hay listing que actualizar y
 * la fila sería una línea vacía en el fichero que Amazon rechaza.
 */
export function unmatchedAsZeroRows(rows: UnmatchedRow[]): AmazonStockRow[] {
  return rows
    .filter((row) => row.sku)
    .map((row) => ({
      sku: row.sku,
      asin: row.asin,
      stock: 0,
      refErp: row.refErp,
      articulo: '',
      via: 'sin_casar' as StockMatchMethod,
    }))
}

// =====================================================
// Utilidades
// =====================================================

/**
 * Error con mensaje pensado para enseñárselo a quien sube el fichero.
 *
 * Las rutas lo distinguen de un fallo inesperado para responder 400 con la
 * frase en español en vez de un 500 pelado: «la hoja Browser no tiene la
 * columna St. Real» se arregla solo, «Internal Server Error» acaba en una
 * llamada de teléfono.
 */
export class StockSyncError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StockSyncError'
  }
}

/**
 * Texto tal cual, sin el «.0» que mete Excel al leer un código como número.
 *
 * A diferencia de normalizeCode(), esto NO quita ceros a la izquierda ni
 * guiones: se usa para el SKU de Amazon y para el ASIN, que son cadenas
 * opacas («05-NDKE-740Z»). Normalizarlos generaría un fichero que Amazon
 * rechaza porque el SKU ya no existiría en la cuenta.
 */
export function cleanSku(value: unknown): string {
  return plainText(value).replace(/\.0+$/, '')
}

/** Convierte a texto sin sorpresas de notación científica ni decimales inventados */
export function plainText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return ''
    return Number.isInteger(value) ? value.toFixed(0) : String(value)
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value).trim()
}

/**
 * Número de una celda, o null si no hay forma de leerlo.
 *
 * Devuelve null y no 0 porque quien llama tiene que poder distinguir «la
 * celda dice 0» de «la celda dice ND»: el primero es un stock real y el
 * segundo un fichero que hay que mirar.
 *
 * Acepta el formato español («1.234,50») porque el volcado a veces llega
 * como CSV, y ahí los números vienen ya formateados como texto.
 */
export function parseUnits(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value === null || value === undefined) return null

  let text = String(value).trim()
  if (!text) return null

  text = text.replace(/[^\d.,-]/g, '')
  if (!text) return null

  const comma = text.lastIndexOf(',')
  const dot = text.lastIndexOf('.')
  if (comma !== -1 && dot !== -1) {
    // El separador decimal es el que está más a la derecha; el otro es de miles
    text = comma > dot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '')
  } else if (comma !== -1) {
    text = text.replace(',', '.')
  }

  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Unidades listas para Amazon: entero y nunca negativo.
 *
 * Se redondea HACIA ABAJO porque el ERP guarda decimales en los artículos
 * que se venden a granel (0,73 metros de cable) y prometer una unidad que no
 * está completa acaba en un pedido que no se puede servir.
 *
 * El negativo se convierte en 0 porque Amazon no acepta stock negativo y
 * porque un negativo en el ERP significa que se ha servido más de lo que
 * había: físicamente no queda nada, que es exactamente 0.
 */
export function sanitizeUnits(units: number): number {
  if (!Number.isFinite(units)) return 0
  return Math.max(0, Math.floor(units))
}

function uniqueStrings(values: (string | null | undefined)[]): string[] {
  const out: string[] = []
  for (const value of values) {
    if (value && !out.includes(value)) out.push(value)
  }
  return out
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key)
  if (list) {
    if (!list.includes(value)) list.push(value)
  } else {
    map.set(key, [value])
  }
}

/**
 * Exportada para que el lector configurable (lib/stock-sync/lector.ts) abra
 * los ficheros EXACTAMENTE igual que los parsers de aquí. Si cada uno los
 * abriera a su manera, un mismo Excel podría leerse distinto según por qué
 * camino entrara, y esa clase de diferencia no se ve hasta que un cliente
 * publica el stock de otro artículo.
 */
export function readWorkbook(input: WorkbookInput): XLSX.WorkBook {
  const bytes = toUint8Array(input)
  if (bytes.length === 0) throw new StockSyncError('El fichero está vacío')

  try {
    // cellDates false y raw a la hora de volcar: aquí no hay ninguna columna
    // de fecha y sí muchos códigos que Excel guarda como número; convertirlos
    // a Date por si acaso solo puede estropearlos.
    //
    // raw:true ES LO QUE SALVA LOS CSV, y no es un detalle de rendimiento.
    // En un .xlsx cada celda ya viene tipada del fichero y esta opción no
    // cambia nada. En un CSV no hay tipos, así que la librería los adivina CON
    // CRITERIO ANGLOSAJÓN: «62,72» lo lee como 6272 y «0001» como 1. Los
    // números salen multiplicados por cien y las referencias pierden sus ceros
    // a la izquierda, todo sin dar un solo error. Con raw:true las celdas del
    // CSV llegan como TEXTO y las interpreta parseUnits(), que sí sabe leer el
    // formato español, que es la única pieza que debe decidirlo.
    return XLSX.read(bytes, { type: 'array', cellDates: false, codepage: 65001, raw: true })
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'formato no reconocido'
    throw new StockSyncError(
      `No se ha podido leer el fichero (${detail}). Tiene que ser un .xlsx, .xls o .csv`
    )
  }
}

function toUint8Array(input: WorkbookInput): Uint8Array {
  if (input instanceof Uint8Array) return input
  return new Uint8Array(input)
}
