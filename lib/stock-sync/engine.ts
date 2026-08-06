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
 */

import * as XLSX from 'xlsx'
import {
  StockMatchMethod,
  normalizeCode,
  normalizeEan,
  parseEanList,
} from '@/lib/types/stock-sync'

// =====================================================
// Tipos
// =====================================================

/** Los buffers llegan de `File.arrayBuffer()` en las rutas y de `readFileSync` en las pruebas */
export type WorkbookInput = ArrayBuffer | Uint8Array | Buffer

/** Una línea del volcado de stock del cliente (fichero ARTICULOS_STOCK_COSTE PROMEDIO) */
export interface StockLine {
  /** Código tal cual viene, con sus ceros a la izquierda: es lo que se enseña al auditar */
  articulo: string
  /** El mismo código pasado por normalizeCode(); es la clave con la que se cruza */
  articuloNorm: string
  descripcion: string
  /** «St. Real» ya saneado: entero y nunca negativo */
  stock: number
}

/** Códigos de barras que el ERP tiene para un artículo (fichero ARTICULOS_EAN) */
export interface ArticleEans {
  /** El marcado como Habitual = «Si»; null si el artículo no tiene ninguno de tipo EAN-13 */
  habitual: string | null
  /** Todos los EAN-13 del artículo, el habitual incluido, sin repetidos */
  todos: string[]
}

/** articuloNorm -> sus códigos de barras */
export type EanIndex = Map<string, ArticleEans>

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
  ref_ambigua: 'La referencia coincide con varios artículos del ERP con stock distinto',
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
  /** Opcional: sin él solo funcionan la vía 1 y la parte del cruce por EAN que no necesita el ERP */
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
    const articulo = plainText(row[iArticulo])
    const articuloNorm = normalizeCode(articulo)
    // Una fila sin código no identifica nada; suele ser el pie de página que
    // el ERP añade al exportar (totales, fecha de la extracción).
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
 * índice artículo -> EAN.
 *
 * Solo entran los de Tipo 1 (EAN-13). El fichero mezcla tres tipos y los
 * demás son códigos internos del ERP («0004000342.PZ»), que no identifican el
 * producto fuera de casa del cliente: si se colaran, dos artículos distintos
 * podrían casar por un código interno parecido y el stock acabaría en el
 * listing equivocado.
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
  const iHabitual = findColumn(table.headers, ['Habitual'])

  if (iArticulo === -1 || iBarcode === -1) {
    throw new StockSyncError(
      'El fichero de EAN no trae las columnas «Cód.Artículo» y «Código de Barras». ' +
        `Columnas encontradas: ${table.headers.filter(Boolean).join(', ') || 'ninguna'}`
    )
  }

  const index: EanIndex = new Map()

  for (const row of table.rows) {
    const articuloNorm = normalizeCode(row[iArticulo])
    if (!articuloNorm) continue

    // Sin columna Tipo se acepta todo lo que normalizeEan dé por bueno: es
    // peor no poder leer el fichero que fiarse de la criba por longitud.
    if (iTipo !== -1 && parseUnits(row[iTipo]) !== 1) continue

    const ean = normalizeEan(row[iBarcode])
    if (!ean) continue

    const entry = index.get(articuloNorm) ?? { habitual: null, todos: [] }
    if (!entry.todos.includes(ean)) entry.todos.push(ean)

    // «Si» con o sin tilde, y en cualquier caja: lo escribe el ERP del
    // cliente y no hay garantía de que no cambie de un volcado a otro.
    // El primero gana: hay artículos con dos códigos marcados como habitual
    // y elegir el primero al menos es estable entre ejecuciones.
    if (iHabitual !== -1 && entry.habitual === null && isYes(row[iHabitual])) {
      entry.habitual = ean
    }

    index.set(articuloNorm, entry)
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
 *   1. la referencia del ERP del mapeo contra el artículo del volcado. Es
 *      una igualdad entre dos códigos del mismo sistema: si casa, casa.
 *   2. EAN_FINAL / EAN_ERP / EAN_AMAZON contra el EAN habitual del artículo.
 *      Necesita el fichero de EAN. El habitual es el que el cliente
 *      considera el código bueno del artículo, así que un acierto aquí vale
 *      casi tanto como el de la vía 1.
 *   3. cualquier EAN del mapeo (los tres de arriba más la lista
 *      TODOS_EAN_ERP) contra cualquier EAN del artículo. Es la vía de
 *      rescate: los EAN secundarios se reutilizan entre variantes y packs,
 *      así que lo que casa por aquí conviene revisarlo a mano.
 *
 * Registrar por qué vía casó cada fila es la razón de ser de todo esto: sin
 * ese dato, cuando un producto sale en Amazon con las unidades de otro no hay
 * forma de saber si el fallo estaba en la referencia o en un EAN compartido.
 */
export function crossStock({ mappings, stockLines, eanIndex }: CrossInput): CrossResult {
  const warnings: string[] = []

  // ---------- Índice del volcado ----------
  // El valor es una LISTA y no una línea suelta porque el código normalizado
  // no siempre identifica un artículo. El ERP del cliente no rellena todos
  // los códigos a la misma longitud: en el volcado conviven «0080997933»
  // (LED PLAFON) y «080997933» (LED PLS), que son productos distintos y que
  // al quitarles los ceros de la izquierda quedan iguales. Guardando las dos
  // líneas se puede detectar el choque y negarse a elegir, en vez de publicar
  // en Amazon las unidades de cualquiera de los dos.
  const stockByArticulo = new Map<string, StockLine[]>()
  for (const line of stockLines) push(stockByArticulo, line.articuloNorm, line)

  const collisions: string[] = []
  for (const lines of stockByArticulo.values()) {
    if (lines.length > 1 && new Set(lines.map((l) => l.stock)).size > 1) {
      collisions.push(lines.map((l) => l.articulo).join(' / '))
    }
  }

  if (collisions.length > 0) {
    warnings.push(
      `${collisions.length} código(s) del volcado se quedan iguales al normalizar pero son artículos ` +
        `distintos con stock distinto (${collisions.slice(0, 3).join('; ')}). Los SKU que dependan de ` +
        'ellos no se han subido: para arreglarlo, escribe la referencia completa con sus ceros en el mapeo'
    )
  }

  // ---------- Índices por EAN ----------
  // Se construyen los dos por separado porque distinguen dos niveles de
  // confianza: casar contra el habitual es la vía 2 y casar contra cualquier
  // código del artículo es la 3.
  const byHabitual = new Map<string, string[]>()
  const byAnyEan = new Map<string, string[]>()

  if (eanIndex) {
    for (const [articuloNorm, eans] of eanIndex) {
      if (eans.habitual) push(byHabitual, eans.habitual, articuloNorm)
      for (const ean of eans.todos) push(byAnyEan, ean, articuloNorm)
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
    ref: 0,
    ean_habitual: 0,
    ean_lista: 0,
    sin_casar: 0,
  }

  for (const [sku, mapping] of bySku) {
    const refErp = plainText(mapping.ref_erp) || null
    const asin = cleanSku(mapping.asin) || null

    // Vía 1: referencia contra artículo.
    const refNorm = normalizeCode(mapping.ref_erp)
    const direct = pickLine(refNorm ? stockByArticulo.get(refNorm) : undefined)
    if (direct.line) {
      rows.push({
        sku,
        asin,
        stock: direct.line.stock,
        refErp,
        articulo: direct.line.articulo,
        via: 'ref',
      })
      byVia.ref++
      continue
    }

    // Los EAN del mapeo, en orden de confianza. EAN_FINAL es el que el
    // cliente ya dio por bueno al montar la tabla, así que va primero.
    const mappingEans = uniqueStrings([
      normalizeEan(mapping.ean_final),
      normalizeEan(mapping.ean_erp),
      normalizeEan(mapping.ean_amazon),
    ])

    // Vía 2: contra el EAN habitual del artículo.
    const habitual = resolveByEan(mappingEans, byHabitual, stockByArticulo)
    if (habitual.line) {
      rows.push({
        sku,
        asin,
        stock: habitual.line.stock,
        refErp,
        articulo: habitual.line.articulo,
        via: 'ean_habitual',
      })
      byVia.ean_habitual++
      continue
    }

    // Vía 3: contra cualquier código de barras del artículo, incluyendo los
    // de la lista TODOS_EAN_ERP que arrastra el mapeo.
    const allEans = uniqueStrings([...mappingEans, ...parseEanList(mapping.todos_ean_erp)])
    const loose = resolveByEan(allEans, byAnyEan, stockByArticulo)
    if (loose.line) {
      rows.push({
        sku,
        asin,
        stock: loose.line.stock,
        refErp,
        articulo: loose.line.articulo,
        via: 'ean_lista',
      })
      byVia.ean_lista++
      continue
    }

    // ---------- Sin casar ----------
    // Una ambigüedad se descarta a conciencia: entre dejar el listing con el
    // stock de ayer y publicarle las unidades de otro artículo, lo primero se
    // arregla mañana y lo segundo se vende hoy.
    //
    // El choque de referencias se mira DESPUÉS de haber intentado las vías por
    // EAN: un código de barras identifica el artículo sin lugar a dudas, así
    // que si alguna de las dos vías lo ha resuelto, la ambigüedad de la
    // referencia ya no importa y el SKU se sube igual.
    if (direct.conflict) {
      unmatched.push({
        sku,
        asin,
        refErp,
        reason: 'ref_ambigua',
        detail:
          `La referencia ${refErp} coincide con ${direct.conflict.length} artículos del volcado ` +
          `(${direct.conflict.map((l) => `${l.articulo} = ${l.stock}`).join(', ')}). ` +
          'Escribe la referencia completa, con sus ceros a la izquierda, para desempatar',
      })
      continue
    }

    const ambiguous = habitual.ambiguous || loose.ambiguous
    if (ambiguous) {
      unmatched.push({
        sku,
        asin,
        refErp,
        reason: 'ean_ambiguo',
        detail: `El EAN ${ambiguous.ean} está en ${ambiguous.articulos.length} artículos del ERP con stock distinto (${ambiguous.articulos.slice(0, 3).join(', ')})`,
      })
      continue
    }

    if (!refNorm && allEans.length === 0) {
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
        : `Ninguno de sus EAN (${allEans.slice(0, 3).join(', ')}) está en el ERP del cliente`,
    })
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
      stockArticles: stockByArticulo.size,
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

/** Primer EAN de `eans` que lleve a un artículo con stock sin lugar a dudas */
function resolveByEan(
  eans: string[],
  index: Map<string, string[]>,
  stockByArticulo: Map<string, StockLine[]>
): { line: StockLine | null; ambiguous: AmbiguousEan | null } {
  let ambiguous: AmbiguousEan | null = null

  for (const ean of eans) {
    const candidates = (index.get(ean) ?? []).flatMap(
      (articuloNorm) => stockByArticulo.get(articuloNorm) ?? []
    )

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

/** «Si», «SÍ», «S», «true», 1... lo escribe el ERP del cliente y cambia entre volcados */
function isYes(value: unknown): boolean {
  const text = plainText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
  return text === 'si' || text === 's' || text === 'true' || text === '1' || text === 'x'
}

function uniqueStrings(values: string[]): string[] {
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

function readWorkbook(input: WorkbookInput): XLSX.WorkBook {
  const bytes = toUint8Array(input)
  if (bytes.length === 0) throw new StockSyncError('El fichero está vacío')

  try {
    // cellDates false y raw a la hora de volcar: aquí no hay ninguna columna
    // de fecha y sí muchos códigos que Excel guarda como número; convertirlos
    // a Date por si acaso solo puede estropearlos.
    return XLSX.read(bytes, { type: 'array', cellDates: false, codepage: 65001 })
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
