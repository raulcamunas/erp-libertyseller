/**
 * Sincronización de stock: del volcado del ERP del cliente al fichero que
 * se sube a Amazon.
 *
 * Lo importante de este fichero no son las interfaces, son las funciones
 * de códigos. El cruce entre los dos mundos se hace por códigos que vienen
 * escritos de forma distinta en cada fichero, y un cruce que falla no da
 * error: deja el SKU fuera del envío (Amazon se queda con el stock viejo)
 * o, peor, lo casa con el artículo equivocado. Por eso son puras y sin
 * dependencias: se pueden probar solas.
 *
 * Hay DOS formas de un código y no se pueden confundir:
 *   - exactCode()     es la IDENTIDAD del artículo, tal cual lo escribe el
 *                     cliente, con sus ceros a la izquierda;
 *   - normalizeCode() es solo una CLAVE DE BÚSQUEDA de respaldo, para poder
 *                     encontrar «0050119247» cuando el mapeo dice «50119247».
 * El porqué, con los datos que lo demuestran, está en crossStock()
 * (lib/stock-sync/engine.ts).
 */

export interface StockClient {
  id: string
  name: string
  /** Identificador estable en minúsculas; resuelve el cliente en las semillas y en la URL */
  slug: string
  is_active: boolean
  position: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface StockMapping {
  id: string
  client_id: string
  /**
   * Referencia del artículo en el ERP del cliente, tal cual se escribe allí.
   * Se guarda con sus ceros a la izquierda cuando se conocen: son parte del
   * código, no relleno (ver exactCode()).
   */
  ref_erp: string | null
  /** SKU del listing en Amazon; es la clave del fichero que se sube */
  sku_amazon: string
  asin: string | null
  /** EAN que publica Amazon en el listing */
  ean_amazon: string | null
  /** EAN del artículo en el ERP */
  ean_erp: string | null
  /** El que se da por bueno de los dos anteriores */
  ean_final: string | null
  /** De dónde salió ean_final: 'ERP', 'Helium 10', 'SIN DATO' */
  origen_ean: string | null
  /** Cómo se casó la fila en el Excel de origen: 'SKU = ref ERP', 'Cruce por EAN', 'SIN MATCH'… */
  metodo_match: string | null
  /** 'SI' / 'NO' / 'SOLO POR EAN' / 'REVISAR (SKU y EAN discrepan)' */
  sku_coincide: string | null
  /** Diagnóstico del EAN, texto libre */
  ean_coincide: string | null
  /**
   * Todos los códigos del artículo en el ERP separados por coma, tal cual
   * salen de allí: códigos de barras y también la referencia con sus ceros a
   * la izquierda. Se guarda sin tocar porque es lo único que conserva la
   * forma exacta de la referencia (ver parseCodeList()).
   */
  todos_ean_erp: string | null
  /** 'Normal' / 'Preferente' / 'Obsoleto' en el ERP */
  situacion_erp: string | null
  /** Título del listing, solo para reconocer la fila en pantalla */
  titulo_amazon: string | null
  is_active: boolean
  notes: string | null
  created_at: string
  updated_at: string
}

export interface StockRun {
  id: string
  client_id: string
  created_by: string | null
  /** Fichero de stock que mandó el cliente, tal cual */
  source_filename: string | null
  /** Fichero de EANs del ERP, si se usó */
  ean_filename: string | null
  /** null = no se calculó, 0 = cero de verdad */
  rows_input: number | null
  rows_matched: number | null
  rows_unmatched: number | null
  total_units: number | null
  notes: string | null
  created_at: string
}

/**
 * Por qué vía casó una fila en el último proceso, de más fiable a menos.
 * Se guarda para poder auditar un stock mal subido: sin esto, cuando un
 * producto sale con las unidades de otro no hay forma de saber si el fallo
 * fue de la referencia o de un EAN compartido entre dos artículos.
 *
 * No hay vía «por EAN habitual» a propósito. La hubo, y casaba CERO filas:
 * en el ERP de este cliente el código marcado como Habitual = «Si» no es el
 * EAN-13 sino un código interno de Tipo 2 («0080997933.01»), y todos los
 * EAN-13 buenos vienen con Habitual = «No». Un contador que siempre marca
 * cero no informa, engaña al leer las estadísticas.
 */
export type StockMatchMethod =
  | 'ref_exacta'
  | 'ean_erp'
  | 'ref_padding'
  | 'ean_listing'
  | 'sin_casar'

export const STOCK_MATCH_METHODS: StockMatchMethod[] = [
  'ref_exacta',
  'ean_erp',
  'ref_padding',
  'ean_listing',
  'sin_casar',
]

/** Las vías por las que una fila SÍ casa, en el mismo orden en que las prueba el motor */
export const STOCK_MATCH_VIAS: StockMatchMethod[] = [
  'ref_exacta',
  'ean_erp',
  'ref_padding',
  'ean_listing',
]

export const STOCK_MATCH_METHOD_LABELS: Record<StockMatchMethod, string> = {
  ref_exacta: 'Por referencia exacta',
  ean_erp: 'Por EAN del ERP',
  ref_padding: 'Por referencia sin ceros',
  ean_listing: 'Por EAN del listing',
  sin_casar: 'Sin casar',
}

export const STOCK_MATCH_METHOD_HINTS: Record<StockMatchMethod, string> = {
  ref_exacta:
    'El código del mapeo coincide letra por letra con el del volcado, ceros a la izquierda incluidos. No hay forma de que sea otro artículo',
  ean_erp:
    'Un EAN-13 sacado del propio ERP del cliente lleva a un único artículo. Es lo que desempata dos referencias que solo se diferencian en un cero',
  ref_padding:
    'La referencia solo casa después de quitarle los ceros a la izquierda, y así lleva a un único artículo del volcado',
  ean_listing:
    'El único vínculo es el EAN que figura en el listing de Amazon, no en el ERP. Suele ser correcto, pero identifica el producto del catálogo de Amazon, no necesariamente el artículo que el cliente tiene en su almacén',
  sin_casar: 'No se encontró el artículo; este SKU no se sube a Amazon',
}

/** Verde la identidad exacta, cian el EAN del ERP, ámbar lo que depende de la normalización, naranja el EAN del listing, rojo lo que se queda fuera */
export const STOCK_MATCH_METHOD_COLORS: Record<StockMatchMethod, string> = {
  ref_exacta: '#34D399',
  ean_erp: '#06B6D4',
  ref_padding: '#FBBF24',
  ean_listing: '#FB923C',
  sin_casar: '#EF4444',
}

/** Las columnas de diagnóstico son TEXT libre, así que puede llegar un valor que no esté en el mapa */
export function matchMethodLabel(m: string): string {
  return STOCK_MATCH_METHOD_LABELS[m as StockMatchMethod] ?? m
}

export function matchMethodColor(m: string): string {
  return STOCK_MATCH_METHOD_COLORS[m as StockMatchMethod] ?? '#94A3B8'
}

/**
 * Deja un código de artículo LISTO PARA COMPARAR SIN PERDER SU IDENTIDAD:
 * quita los espacios y el «.0» que mete Excel al leerlo como número, y nada
 * más. '0080997933' sigue siendo '0080997933'.
 *
 * Esta es la forma que identifica un artículo. Los ceros a la izquierda son
 * significativos en el ERP del cliente: '0080997933' (LED PLAFON 17W) y
 * '080997933' (LED PLS 2P G23) son dos productos distintos, con EAN distinto
 * y stock distinto. Cualquier cosa que se compare como IDENTIDAD —el índice
 * del volcado, el del fichero de EAN, la referencia del mapeo— se compara en
 * esta forma, nunca en la normalizada.
 *
 * Se pasa a mayúsculas porque hay artículos con letra ('0004000342.PZ') y el
 * mismo código escrito en minúscula tiene que casar; el punto y el guion se
 * respetan, que forman parte del código.
 */
export function exactCode(v: unknown): string {
  return toRawString(v)
    .replace(/\.0+$/, '')
    .replace(/\s+/g, '')
    .toUpperCase()
}

/**
 * Pasa cualquier código (referencia del ERP, SKU de Amazon) a la forma
 * canónica con la que se BUSCA. '0004000342', '4000342.0' y ' 4000342 '
 * dan los tres '4000342'.
 *
 * OJO, y esto es lo que alguien deshace sin querer dentro de seis meses:
 * esta forma es una CLAVE DE BÚSQUEDA DE RESPALDO, no la identidad del
 * artículo. Sirve para encontrar en el volcado ('0050119247') la referencia
 * que el mapeo escribe sin relleno ('50119247') —sin ella se quedarían sin
 * casar 281 de las 392 líneas—, pero dos códigos que dan la misma forma
 * normalizada pueden ser dos artículos completamente distintos. Para eso
 * está exactCode(), justo aquí arriba.
 *
 * Hace falta porque cada fichero escribe el mismo código de otra manera:
 *   - el volcado del cliente trae ceros a la izquierda ('0004000342'),
 *     porque en su ERP el código es un texto de longitud fija, y la tabla
 *     de mapeo no ('4000342');
 *   - Excel lee esos códigos como número, así que al exportarlos aparecen
 *     como '4000342.0', y comparar '4000342.0' con '4000342' falla sin
 *     avisar de nada;
 *   - por el camino se cuelan espacios, guiones y puntos.
 *
 * El orden de los pasos importa: el sufijo '.0' se quita ANTES de tirar los
 * caracteres no alfanuméricos. Al revés, '50119247.0' se convertiría en
 * '501192470' y el cruce fallaría en silencio.
 *
 * Nota: un código de solo ceros devuelve cadena vacía, igual que un código
 * ausente. Es lo que queremos: '0000' no identifica ningún artículo.
 *
 * Gemela de public.stock_normalize_code() (migración 106). Si cambia una,
 * cambia la otra y hay que hacer REINDEX de idx_stock_mappings_ref_norm.
 */
export function normalizeCode(v: unknown): string {
  return toRawString(v)
    .replace(/\.0+$/, '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/^0+/, '')
}

/**
 * Pasa un código de barras a su forma canónica, o devuelve cadena vacía si
 * no parece un EAN.
 *
 * Se quitan los ceros a la izquierda porque el mismo producto aparece como
 * GTIN-14 en Amazon ('05410288302409') y como EAN-13 en el ERP
 * ('5410288302409'): son el mismo código con relleno distinto.
 *
 * El corte por longitud es la primera criba entre los EAN de verdad y los
 * códigos internos: el fichero de EANs del ERP mezcla EAN-13 (Tipo 1) con
 * códigos como '0004000342.PZ' (Tipo 2), y esos, una vez quitados los ceros
 * y lo que no son dígitos, casi siempre se quedan en menos de 8. No es la
 * criba definitiva —un código interno largo la pasaría—, así que al leer el
 * fichero de EANs hay que quedarse además solo con los de Tipo 1.
 */
export function normalizeEan(v: unknown): string {
  const digits = toRawString(v)
    .replace(/\.0+$/, '')
    .replace(/\D/g, '')
    .replace(/^0+/, '')

  return digits.length >= 8 ? digits : ''
}

/**
 * Parte la lista 'TODOS_EAN_ERP' ('0050119247, 4050300646077, ') quedándose
 * solo con lo que parece un código de barras, ya normalizado, sin vacíos ni
 * repetidos.
 *
 * Un artículo del ERP puede tener varios códigos de barras y el que Amazon
 * publica no siempre es el primero. Los repetidos se quitan para que un
 * mismo EAN no cuente dos veces al decidir por qué vía casó la fila.
 */
export function parseEanList(v: unknown): string[] {
  const raw = toRawString(v)
  if (!raw) return []

  const out: string[] = []
  for (const part of raw.split(/[,;\n]/)) {
    const ean = normalizeEan(part)
    if (ean && !out.includes(ean)) out.push(ean)
  }
  return out
}

/**
 * Parte la misma lista 'TODOS_EAN_ERP' pero SIN normalizar nada: devuelve los
 * códigos tal cual, con sus ceros a la izquierda.
 *
 * La columna no trae solo EAN pese al nombre: mezcla los códigos de barras
 * del artículo con su referencia del ERP CON el relleno original
 * ('0008099793301, 0080997933, 5410288431161'). Esa referencia con ceros es,
 * en muchas filas, el único sitio del mapeo donde sobrevive la forma exacta:
 * la columna REF_ERP viene de un Excel que guardó el código como número y
 * llegó ya sin ellos ('80997933.0'). Por eso el motor prueba estos valores
 * como código exacto del volcado, y por eso la importación tiene que
 * guardarlos tal cual y no reescritos desde su forma normalizada.
 */
export function parseCodeList(v: unknown): string[] {
  const raw = toRawString(v)
  if (!raw) return []

  const out: string[] = []
  for (const part of raw.split(/[,;\n]/)) {
    const code = exactCode(part)
    if (code && !out.includes(code)) out.push(code)
  }
  return out
}

/**
 * Los valores llegan de tres sitios (Excel, Supabase y formularios), así que
 * pueden ser número, texto, null o undefined. Los enteros se pasan con
 * toFixed(0) y no con String(): un EAN de 13 dígitos leído como número por
 * Excel sale bien de las dos formas, pero así queda explícito que aquí nunca
 * queremos notación científica ni decimales.
 */
function toRawString(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return ''
    return Number.isInteger(v) ? v.toFixed(0) : String(v)
  }
  return String(v).trim()
}

/** Enteros en formato español; '—' cuando no hay dato, para no confundir un null con un cero */
export function formatInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return n.toLocaleString('es-ES', { maximumFractionDigits: 0 })
}
