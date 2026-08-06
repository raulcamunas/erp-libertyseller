import { APP_TIMEZONE } from '@/lib/timezone'

/**
 * Lo que comparten los paneles de sincronización de stock.
 *
 * Aquí NO se importa nada de lib/stock-sync/engine.ts, y es a propósito: el
 * motor arrastra la librería xlsx (cerca de un mega) y cualquier componente de
 * cliente que lo tocara se la llevaría entera al navegador de quien abra el
 * módulo. Lo poco que hace falta de allí está copiado abajo, señalado y con la
 * ruta del original.
 */

// ---------- Edición en línea ----------
// Mismo lenguaje que marketing y tesorería: la celda no parece un campo hasta
// que se pasa por encima, para que una tabla de seis columnas editables no se
// lea como un formulario.
const cellShell =
  'bg-transparent hover:bg-white/[0.05] focus:bg-white/[0.08] border border-transparent focus:border-[#FF6600] rounded px-1.5 py-1 outline-none transition-colors placeholder:text-white/20'

export const textInput = `w-full ${cellShell} text-[12px] text-white`
/** Códigos y EAN: tabulares para que las columnas de dígitos se puedan comparar de un vistazo */
export const codeInput = `w-full ${cellShell} text-[12px] text-white tabular-nums`

// ---------- Descargas ----------

/**
 * Baja un fichero que ya viaja dentro de la respuesta JSON del proceso.
 *
 * Llega en base64 porque en la misma petición vienen el Excel de Amazon, el de
 * los que no casaron y la tabla de sin resolver: separarlos en otra llamada
 * obligaría a volver a subir dos ficheros de 2 MB y a repetir el cruce, que
 * dejaría una segunda entrada falsa en el historial.
 */
export const MIME_XLSX =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * El .xlsm de la plantilla de Amazon. NO vale el MIME de .xlsx: declarado así,
 * algún navegador le cambia la extensión al guardarlo y Seller Central rechaza
 * el fichero sin decir por qué.
 */
export const MIME_XLSM = 'application/vnd.ms-excel.sheet.macroEnabled.12'

export function downloadBase64(base64: string, filename: string, mime = MIME_XLSX): void {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

  downloadBlob(new Blob([bytes], { type: mime }), filename)
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Sin esto el blob se queda en memoria hasta que se recarga la pestaña, y
  // aquí cada uno pesa lo que pese el volcado del cliente.
  window.URL.revokeObjectURL(url)
}

// ---------- Fechas ----------

/**
 * Fecha y hora en hora de España, sea cual sea el huso del navegador.
 *
 * Importa más de lo que parece: el proceso se lanza los lunes y los jueves, y
 * un run de las 00:30 visto desde otro huso saldría fechado el día anterior y
 * parecería el de la semana pasada.
 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('es-ES', {
    timeZone: APP_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Solo el día, para las tarjetas de cliente donde la hora no aporta */
export function formatDay(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('es-ES', {
    timeZone: APP_TIMEZONE,
    day: '2-digit',
    month: 'short',
  })
}

// ---------- Códigos ----------

/**
 * Espejo de cleanSku() de lib/stock-sync/engine.ts (ver la nota de arriba
 * sobre por qué está copiado y no importado).
 *
 * El SKU y el ASIN se dejan tal cual, solo sin el «.0» que mete Excel al leer
 * un código como número: la mitad son cadenas opacas («05-NDKE-740Z») y
 * tocarlas generaría un fichero con SKU que no existen en la cuenta de Amazon.
 */
export function cleanSkuText(value: string): string {
  return value.trim().replace(/\.0+$/, '')
}

// ---------- Listings sin resolver ----------

/**
 * Espejo de UnmatchedReason de lib/stock-sync/engine.ts.
 *
 * La respuesta del proceso trae ya el texto del motivo (`reasonLabel`), así
 * que si algún día el motor añade uno nuevo la pantalla lo seguirá enseñando
 * bien; lo único que se perdería es el consejo de abajo, que cae al genérico.
 */
export type UnmatchedReason =
  | 'sin_referencia'
  | 'sin_articulo'
  | 'ref_ambigua'
  | 'ean_ambiguo'
  | 'sku_vacio'

/**
 * QUÉ HACER con cada motivo, que es lo que de verdad hace falta.
 *
 * Saber que una línea «no casó» no sirve de nada: el trabajo de quien mira
 * esta tabla es dejarla casando la próxima vez, y cada motivo se arregla en un
 * sitio distinto. De ahí que el consejo sea una instrucción concreta y no una
 * descripción del fallo.
 */
export const UNMATCHED_ACTIONS: Record<UnmatchedReason, string> = {
  sin_referencia:
    'Busca este SKU en «Base de datos actual» y rellena su REF_ERP (o su EAN). Sin uno de los dos no hay por dónde buscarlo en el volcado.',
  sin_articulo:
    'La referencia existe en el mapeo pero no aparece en el volcado de hoy. O el cliente ha dado de baja el artículo —entonces toca retirar el listing— o el volcado llegó incompleto: míralo antes de dar el producto por agotado.',
  ref_ambigua:
    'Su referencia solo casa después de quitarle los ceros a la izquierda, y así vale para varios artículos del ERP con stock distinto. Lo que lo arregla es rellenar el EAN_FINAL de esta fila: el EAN identifica el artículo sin discusión y el cruce lo prueba antes de recurrir a los ceros. Si el artículo no tiene EAN, escribe la REF_ERP tal cual sale en el volcado, con los ceros incluidos.',
  ean_ambiguo:
    'Ese EAN está repetido en varios artículos del ERP con stock distinto, así que tampoco desempata. Escribe la REF_ERP de esta fila tal cual sale en el volcado, con sus ceros a la izquierda, para que el cruce no dependa del código de barras.',
  sku_vacio:
    'La fila del mapeo se quedó sin SKU de Amazon. Complétalo o desactiva la fila: sin SKU no hay listing que actualizar.',
}

/** Colores del motivo: rojo lo que está roto en el mapeo, ámbar lo que hay que decidir a mano */
export const UNMATCHED_COLORS: Record<UnmatchedReason, string> = {
  sin_referencia: '#EF4444',
  sin_articulo: '#FBBF24',
  ref_ambigua: '#F97316',
  ean_ambiguo: '#F97316',
  sku_vacio: '#EF4444',
}

const FALLBACK_ACTION =
  'Revisa la fila en «Base de datos actual»: con la referencia del ERP rellenada y correcta, el cruce la resuelve.'

export function unmatchedAction(reason: string): string {
  return UNMATCHED_ACTIONS[reason as UnmatchedReason] ?? FALLBACK_ACTION
}

export function unmatchedColor(reason: string): string {
  return UNMATCHED_COLORS[reason as UnmatchedReason] ?? '#94A3B8'
}

/** Etiqueta corta para la píldora de la tabla; la frase larga va en el consejo */
export const UNMATCHED_SHORT: Record<UnmatchedReason, string> = {
  sin_referencia: 'Sin referencia',
  sin_articulo: 'No está en el volcado',
  ref_ambigua: 'Referencia sin desempatar',
  ean_ambiguo: 'EAN ambiguo',
  sku_vacio: 'Sin SKU',
}

export function unmatchedShort(reason: string): string {
  return UNMATCHED_SHORT[reason as UnmatchedReason] ?? reason
}

// ---------- Respuesta del proceso ----------

/** Una fila de la tabla de trabajo pendiente, tal y como la manda /api/stock-sync/process */
export interface UnmatchedItem {
  sku: string
  asin: string | null
  refErp: string | null
  reason: string
  /** Frase del motivo, ya resuelta en el servidor */
  reasonLabel: string
  /** El dato concreto que falló: la referencia que se buscó, el EAN que no llevó a nada... */
  detail: string
}

export interface ProcessStats {
  mappings: number
  duplicatedSkus: number
  stockLines: number
  stockArticles: number
  matched: number
  unmatched: number
  totalUnits: number
  zeroStock: number
  byVia: Record<string, number>
  warnings: string[]
}

export interface ProcessFile {
  name: string
  base64: string
}

/** La plantilla de Amazon rellenada, cuando se ha subido una */
export interface ProcessTemplateFile extends ProcessFile {
  /** Va explícito porque es .xlsm y no .xlsx (ver MIME_XLSM) */
  mime: string
  rows: number
  /**
   * Las columnas donde se ha escrito de verdad, resueltas por el nombre técnico
   * de la fila de atributos. Se enseñan en pantalla porque son la prueba de que
   * el stock no ha ido a parar a la columna de al lado.
   */
  colSku: string
  colCantidad: string
  colCanal: string | null
  /**
   * El texto que se ha escrito en la columna del canal, en el idioma de la
   * plantilla («Logística por parte del vendedor (predeterminado)»). En la
   * celda va la etiqueta y no el código: es Amazon quien la traduce.
   */
  canalEtiqueta: string | null
  /** Versión de la plantilla según su propia configuración, p. ej. «2026.0806» */
  version: string | null
  /**
   * La cuenta de vendedor para la que Amazon generó la plantilla
   * («amzn1.cr.o.…»). Es lo único que distingue la plantilla de un cliente de
   * la de otro, así que es lo que hay que mirar cuando se sospecha que se ha
   * subido la equivocada.
   */
  contributorId: string | null
}

/** Lo que devuelve /api/stock-sync/process con format=json */
export interface ProcessResult {
  runId: string | null
  client: { id: string; name: string }
  stockFilename: string | null
  eanFilename: string | null
  templateFilename: string | null
  includeZero: boolean
  withChannel: boolean
  zeroedRows: number
  stats: ProcessStats
  warnings: string[]
  unmatched: UnmatchedItem[]
  file: ProcessFile
  unmatchedFile: ProcessFile | null
  templateFile: ProcessTemplateFile | null
}

/** Resultado de /api/stock-sync/import-mappings */
export interface ImportResult {
  client: string
  sheet: string
  rowsRead: number
  inserted: number
  updated: number
  discarded: number
  discardedReasons: { reason: string; rows: number; examples: string[] }[]
  missingColumns: string[]
}

/**
 * Mensaje de error de una respuesta que ha fallado.
 *
 * Las rutas del módulo contestan `{ error }` con una frase en español pensada
 * para leerse tal cual («la hoja no tiene la columna St. Real»), así que se
 * intenta sacar de ahí. Si el cuerpo no es JSON —un 502 del proxy, por
 * ejemplo— se cae a un texto genérico en vez de enseñar HTML crudo.
 */
export async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const data = await res.json()
    if (data && typeof data.error === 'string' && data.error) return data.error
  } catch {
    // Cuerpo vacío o no-JSON: no hay nada que rescatar.
  }
  return `${fallback} (error ${res.status})`
}
