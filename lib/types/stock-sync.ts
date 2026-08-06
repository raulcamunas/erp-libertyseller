/**
 * Sincronización de stock: del volcado del ERP del cliente al fichero que
 * se sube a Amazon.
 *
 * Lo importante de este fichero no son las interfaces, son las tres
 * funciones de normalización. El cruce entre los dos mundos se hace por
 * códigos que vienen escritos de forma distinta en cada fichero, y un
 * cruce que falla no da error: deja el SKU fuera del envío (Amazon lo
 * queda con el stock viejo) o, peor, lo casa con el artículo equivocado.
 * Por eso son puras y sin dependencias: se pueden probar solas.
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
  /** Referencia del artículo en el ERP del cliente, ya normalizada */
  ref_erp: string | null
  /** SKU del listing en Amazon; es la clave del fichero que se sube */
  sku_amazon: string
  asin: string | null
  /** EAN que publica Amazon en el listing */
  ean_amazon: string | null
  /** EAN habitual del artículo en el ERP */
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
  /** Todos los códigos de barras del artículo en el ERP, separados por coma */
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
 */
export type StockMatchMethod = 'ref' | 'ean_habitual' | 'ean_lista' | 'sin_casar'

export const STOCK_MATCH_METHODS: StockMatchMethod[] = [
  'ref',
  'ean_habitual',
  'ean_lista',
  'sin_casar',
]

export const STOCK_MATCH_METHOD_LABELS: Record<StockMatchMethod, string> = {
  ref: 'Por referencia',
  ean_habitual: 'Por EAN habitual',
  ean_lista: 'Por EAN secundario',
  sin_casar: 'Sin casar',
}

export const STOCK_MATCH_METHOD_HINTS: Record<StockMatchMethod, string> = {
  ref: 'La referencia del ERP coincide con el artículo del volcado',
  ean_habitual: 'Casó por el EAN marcado como habitual en el ERP',
  ean_lista: 'Casó por uno de los EAN secundarios del artículo; conviene revisarlo',
  sin_casar: 'No se encontró el artículo; este SKU no se sube a Amazon',
}

/** Verde lo que casó por referencia, ámbar lo que casó por un EAN dudoso, rojo lo que se queda fuera */
export const STOCK_MATCH_METHOD_COLORS: Record<StockMatchMethod, string> = {
  ref: '#34D399',
  ean_habitual: '#06B6D4',
  ean_lista: '#FBBF24',
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
 * Pasa cualquier código (referencia del ERP, SKU de Amazon) a la forma
 * canónica con la que se compara. '0004000342', '4000342.0' y ' 4000342 '
 * dan los tres '4000342'.
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
 * Parte la lista 'TODOS_EAN_ERP' ('0050119247, 4050300646077, ') en códigos
 * ya normalizados, sin vacíos ni repetidos.
 *
 * Es la última vía del cruce: un artículo del ERP puede tener varios
 * códigos de barras y el que Amazon publica no siempre es el habitual. Los
 * repetidos se quitan para que un mismo EAN no cuente dos veces al decidir
 * por qué vía casó la fila.
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
