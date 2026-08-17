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

  /**
   * CUÁNDO SE DECIDIÓ QUE A ESTE CLIENTE NO SE LE SINCRONIZA EL STOCK.
   *
   * `null` = nadie lo ha decidido. Si además no tiene perfil de lectura, está
   * PENDIENTE DE CONFIGURAR, que es trabajo por hacer y no una decisión.
   *
   * Es una fecha y no un booleano a propósito: con `false` no se distingue
   * «hemos decidido que sí» de «nadie ha mirado esto nunca», que es justo la
   * ambigüedad que esta columna viene a matar. Y la fecha contesta la pregunta
   * que se hace de verdad medio año después: ¿desde cuándo no le mandamos stock?
   *
   * Opcional en el tipo (`?`) y no solo anulable porque la migración 127 se
   * lanza a mano en el editor de Supabase: hasta que alguien la pegue, estas
   * tres claves no vienen en la fila. `undefined` y `null` significan lo mismo
   * aquí —nadie lo ha decidido— y quien lo lea tiene que tratarlos igual.
   */
  no_sincroniza_desde?: string | null
  /** Por qué no. Opcional: obligarlo llevaría a que se rellenara con un punto */
  no_sincroniza_motivo?: string | null
  /** Quién lo decidió (profiles.id). El nombre se resuelve aparte */
  no_sincroniza_por?: string | null
}

/**
 * En qué situación está un cliente respecto a la sincronización de stock.
 *
 * SON TRES Y NO DOS, y esa es toda la idea:
 *
 *   · `sincroniza`   — tiene al menos un perfil de stock activo. Entra en el
 *                      ciclo automático.
 *   · `no_sincroniza`— alguien decidió expresamente que no. Deja de contar como
 *                      pendiente.
 *   · `pendiente`    — ni lo uno ni lo otro: nadie lo ha configurado y nadie ha
 *                      dicho que no haga falta. ESTO es lo que hay que atender.
 *
 * Hasta ahora los dos últimos se veían igual —cero perfiles— y por eso la lista
 * de «clientes sin perfil» no se podía usar para nada.
 */
export type EstadoSincronizacion = 'sincroniza' | 'no_sincroniza' | 'pendiente'

/**
 * El estado de un cliente, a partir de la fila y de sus perfiles.
 *
 * Una sola función para que la pantalla, el ciclo y cualquier informe futuro
 * contesten lo mismo. `perfilesDeStockActivos` es el recuento de perfiles de
 * `tipo: 'stock'` con `is_active`, que son los únicos que mandan algo a Amazon:
 * el de códigos de barras alimenta el cruce y no sincroniza nada por su cuenta.
 *
 * EL ORDEN DE LAS PREGUNTAS IMPORTA. La decisión explícita gana sobre tener
 * perfiles: un cliente al que se le ha dicho que no, no sincroniza aunque su
 * configuración siga guardada. Al revés, un cliente marcado se leería como
 * activo por el simple hecho de conservar su configuración, que es justo lo que
 * la migración 127 evita destruir.
 */
export function estadoSincronizacion(
  cliente: Pick<StockClient, 'no_sincroniza_desde'>,
  perfilesDeStockActivos: number
): EstadoSincronizacion {
  if (cliente.no_sincroniza_desde) return 'no_sincroniza'
  return perfilesDeStockActivos > 0 ? 'sincroniza' : 'pendiente'
}

export const ESTADO_SINCRONIZACION_LABELS: Record<EstadoSincronizacion, string> = {
  sincroniza: 'Sincroniza',
  no_sincroniza: 'No sincroniza',
  pendiente: 'Sin configurar',
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

// =====================================================
// Perfiles de lectura (migración 120)
// =====================================================

/**
 * De dónde sale el fichero. 'sftp' y 'correo' están declarados sin estar
 * construidos a propósito: todavía no se sabe qué podrá dar cada cliente, y
 * descubrirlo no puede obligar a una migración ni a cambiar este tipo.
 */
export type StockProfileOrigin = 'manual' | 'drive' | 'sftp' | 'ftps' | 'correo' | 'api'

export const STOCK_PROFILE_ORIGIN_LABELS: Record<StockProfileOrigin, string> = {
  manual: 'Subida a mano',
  drive: 'Carpeta de Google Drive',
  sftp: 'SFTP',
  ftps: 'FTPS',
  correo: 'Correo',
  api: 'API del proveedor',
}

/** 'stock' es el volcado principal; 'ean' el índice de códigos de barras del ERP */
export type StockProfileKind = 'stock' | 'ean'

export type StockProfileFormat = 'auto' | 'xlsx' | 'xls' | 'csv'

/** De dónde sale el precio que se publica */
export type StockPriceMode = 'ninguno' | 'columna' | 'margen'

export const STOCK_PRICE_MODE_LABELS: Record<StockPriceMode, string> = {
  ninguno: 'No se manda precio',
  columna: 'De una columna del fichero',
  margen: 'Del coste, aplicando margen',
}

/**
 * Los frenos que pueden detener un envío. El código es el mismo aquí, en el
 * CHECK de stock_profile_runs.freno y en lib/stock-sync/frenos.ts: si baila en
 * uno de los tres, la fila no se puede guardar y el envío se pierde entero.
 */
export type StockBrakeCode =
  | 'pct_a_cero'
  | 'variacion_precio'
  | 'caida_lineas'
  | 'caida_unidades'
  | 'max_cambios'

export const STOCK_BRAKE_LABELS: Record<StockBrakeCode, string> = {
  pct_a_cero: 'Demasiadas referencias se irían a cero',
  variacion_precio: 'Un precio cambia demasiado de golpe',
  caida_lineas: 'El fichero trae muchas menos líneas de lo habitual',
  caida_unidades: 'Se hunden las unidades publicadas',
  max_cambios: 'Demasiados SKU cambian a la vez',
}

/** Cómo acabó una ejecución */
export type StockProfileRunState = 'sin_cambios' | 'simulacro' | 'frenado' | 'enviado' | 'error'

export const STOCK_RUN_STATE_LABELS: Record<StockProfileRunState, string> = {
  sin_cambios: 'Sin cambios',
  simulacro: 'Simulacro',
  frenado: 'Frenado',
  enviado: 'Enviado',
  error: 'Error',
}

/**
 * El color de cada estado, con las clases completas del dominio.
 *
 * 'simulacro' va en gris y no en verde a conciencia: es el estado de un cliente
 * que NO está mandando nada, y pintarlo de «todo bien» es cómo se pasan tres
 * semanas creyendo que la automatización está en marcha. Las mismas clases que
 * usa el módulo de Amazon, que son las que el tema claro sabe reinterpretar.
 */
export const STOCK_RUN_STATE_COLORS: Record<StockProfileRunState, string> = {
  sin_cambios: 'bg-zinc-600/25 text-zinc-300 border-zinc-500/30',
  simulacro: 'bg-zinc-600/25 text-zinc-300 border-zinc-500/30',
  frenado: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  enviado: 'bg-green-500/20 text-green-300 border-green-500/30',
  error: 'bg-red-500/20 text-red-300 border-red-500/30',
}

/**
 * La fila de public.stock_read_profiles: cómo se lee e interpreta el fichero de
 * UN cliente. Es la única pieza del proceso que cambia de un cliente a otro.
 */
export interface StockReadProfile {
  id: string
  client_id: string
  name: string
  slug: string
  tipo: StockProfileKind

  origen: StockProfileOrigin
  /** Configuración propia del conector. Nunca contraseñas ni tokens */
  origen_config: Record<string, unknown>

  formato: StockProfileFormat
  csv_separador: string | null
  csv_codificacion: string | null

  hoja: string | null
  /** 1-based */
  hoja_indice: number | null
  fila_cabecera: number | null
  fila_datos: number | null

  /** Nombres aceptados para cada columna, en orden de preferencia */
  col_referencia: string[]
  col_stock: string[]
  col_precio: string[]
  col_precio_respaldo: string[]
  col_coste: string[]
  col_ean: string[]
  col_descripcion: string[]
  col_familia: string[]
  col_tipo: string[]
  ean_solo_tipo: number | null

  reserva_unidades: number
  stock_minimo: number
  /** Tope de unidades por producto. null = sin tope (migración 146) */
  max_unidades: number | null
  /**
   * true = el fichero trae SOLO lo que ha cambiado, no el catálogo entero.
   * Apaga los tres frenos de volumen (migración 147). Ver frenos.ts.
   */
  fichero_parcial: boolean
  precio_modo: StockPriceMode
  margen_porcentaje: number | null
  iva_porcentaje: number | null
  precio_minimo: number | null
  precio_maximo: number | null
  moneda: string
  familias_excluidas: string[]
  referencias_excluidas: string[]
  enviar_stock: boolean
  enviar_precio: boolean

  connection_id: string | null
  marketplace_id: string | null

  freno_pct_a_cero: number | null
  freno_variacion_precio_pct: number | null
  freno_caida_lineas_pct: number | null
  freno_caida_unidades_pct: number | null
  freno_max_cambios: number | null
  lineas_referencia: number | null

  /** Nace apagado y hay que encenderlo a conciencia */
  envio_automatico: boolean
  cadencia_minutos: number

  last_run_at: string | null
  last_ok_at: string | null
  last_error: string | null
  /**
   * Huella DEL CONTENIDO del último fichero que procesó el ciclo automático.
   * La escribe solo el ciclo: un simulacro lanzado a mano no la toca, porque si
   * no, probar un fichero desde la pantalla haría que el ciclo se lo saltara y
   * ese fichero no llegaría nunca a Amazon.
   */
  last_file_fingerprint: string | null

  /** Cerrojo del ciclo: cuándo empezó la ejecución que lo tiene tomado. NULL = libre */
  running_since: string | null
  /** Quién lo tiene tomado, para que solo su dueño lo suelte */
  running_token: string | null
  /** Última pasada del ciclo que miró el origen y no tuvo nada que hacer */
  last_skipped_at: string | null
  /** Por qué no hizo nada, en español: «el fichero no ha cambiado desde la última vez» */
  last_skip_reason: string | null

  is_active: boolean
  position: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

/** La fila de public.stock_profile_runs: una por lectura de fichero, se mande o no */
export interface StockProfileRun {
  id: string
  profile_id: string
  client_id: string
  created_by: string | null

  origen: StockProfileOrigin
  fichero_nombre: string | null
  fichero_id_externo: string | null
  fichero_huella: string | null
  fichero_bytes: number | null
  fichero_modificado_at: string | null

  estado: StockProfileRunState

  /** null = no se calculó, 0 = cero de verdad */
  lineas_leidas: number | null
  lineas_utiles: number | null
  lineas_excluidas: number | null
  sku_casados: number | null
  sku_sin_casar: number | null
  unidades_total: number | null
  cambios_stock: number | null
  cambios_precio: number | null
  sku_a_cero: number | null
  sku_suben: number | null
  sku_bajan: number | null

  reglas_detalle: Record<string, unknown> | null

  freno: StockBrakeCode | null
  /** La frase entera, ya redactada, tal cual se le enseña a una persona */
  freno_detalle: string | null
  frenos: unknown[] | null
  /**
   * Los avisos del simulacro, ya redactados en español.
   *
   * Se guardan porque son la única constancia de cosas que no frenan pero
   * explican un resultado raro: el espejo del catálogo vacío, el fichero de
   * códigos de barras que no se pudo leer, una columna que casó por parecido.
   * Sin esta columna se redactaban, se enseñaban una vez en la pantalla del
   * simulacro y se perdían — y en el ciclo automático, que no tiene a nadie
   * delante, se perdían siempre.
   */
  avisos: string[] | null

  batch_id: string | null
  /** Cambios que Amazon aceptó. null = no se llegó a enviar; 0 = no entró ninguno */
  enviados_ok: number | null
  enviados_error: number | null
  /** Por qué se cortó el lote antes de terminar (autorización revocada, permisos) */
  envio_abortado: string | null
  duracion_ms: number | null
  error_message: string | null
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
