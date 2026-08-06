/**
 * Rellenado de la plantilla oficial de Amazon («Precio y cantidad» /
 * PriceAndQuantity, un .xlsm que se descarga de Seller Central).
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ CIRUGÍA DEL ZIP Y NO REESCRIBIR EL LIBRO CON xlsx
 * ---------------------------------------------------------------------------
 * Un .xlsx/.xlsm es un ZIP con XML dentro. Aquí se descomprime, se toca
 * ÚNICAMENTE la parte de la hoja «Plantilla» y se vuelve a comprimir dejando
 * todas las demás entradas byte a byte idénticas.
 *
 * La tentación es leer el libro con la librería `xlsx` (que ya está en el
 * proyecto) y volver a escribirlo. Está probado y NO sirve: el viaje de ida y
 * vuelta por su modelo de datos se lleva por delante las 64 validaciones de
 * datos de la hoja, los desplegables, el formato condicional, los estilos y el
 * agrupado de columnas. El fichero se sigue abriendo en Excel, así que el
 * destrozo no se ve; se ve cuando Amazon rechaza la carga o, peor, cuando la
 * acepta a medias. Y por encima de todo está la celda A1, que lleva una cadena
 * `settings=…` con el identificador de la cuenta de vendedor y el de la
 * plantilla: si esa celda se altera, Amazon deja de reconocer el fichero.
 *
 * Regla práctica: si algún día hay que tocar esto, se toca el XML de la hoja.
 * En cuanto alguien meta un `XLSX.read()` por en medio, se pierde todo lo
 * anterior sin un solo mensaje de error.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ EL FICHERO BASE LO SUBE EL USUARIO Y NO VIVE EN EL REPOSITORIO
 * ---------------------------------------------------------------------------
 * La cadena `settings=` de A1 lleva grabados el `contributorId` (UNA cuenta de
 * vendedor concreta), el `templateIdentifier`, el marketplace y una versión con
 * fecha. Liberty Seller es una agencia con varios clientes: una plantilla
 * empotrada en el repositorio le pondría a todos los clientes la cuenta del
 * primero, y además caducaría cuando Amazon publicase una versión nueva. Por
 * eso cada cliente sube la suya, descargada de SU Seller Central, junto al
 * volcado de stock.
 *
 * ---------------------------------------------------------------------------
 * POR QUÉ EL SKU VA COMO TEXTO Y NUNCA COMO NÚMERO
 * ---------------------------------------------------------------------------
 * Muchos SKU son solo dígitos y llevan ceros a la izquierda que forman parte
 * del código: «0050119247» y «50119247» son artículos DISTINTOS. Escrito como
 * número, Excel se come los ceros y el fichero apunta a otro producto o a
 * ninguno. Por eso cada SKU se escribe como celda de texto (`t="inlineStr"`),
 * que es además el motivo de que no se toque `xl/sharedStrings.xml`: ahí es
 * donde vive la cadena de A1, y no abrir ese fichero hace imposible dañarla.
 */

import { unzipSync, zipSync } from 'fflate'
// StockSyncError, y no un Error pelado, porque es lo que hace que las rutas
// contesten 400 con la frase en español en vez de un 500 sin explicación.
import { StockSyncError, type WorkbookInput } from './engine'

// =====================================================
// Constantes del formato de Amazon
// =====================================================

/** Hoja de la plantilla donde van los datos; las otras siete son ayuda y listas ocultas */
export const HOJA_PLANTILLA = 'Plantilla'

/**
 * Nombres técnicos de las columnas, tal y como Amazon los escribe en la fila de
 * atributos de la hoja.
 *
 * TODO el módulo localiza las columnas por estos nombres y NUNCA por su
 * posición. Amazon reordena las columnas según la cuenta y los segmentos que
 * tenga activados el vendedor: dar por hecho que el SKU está en la A y la
 * cantidad en la C funciona hoy con esta plantilla y escribe en la columna
 * equivocada, en silencio, el día que cambie.
 */
export const ATRIBUTO_SKU = 'contribution_sku#1.value'
export const ATRIBUTO_CANAL = 'fulfillment_availability#1.fulfillment_channel_code'
export const ATRIBUTO_CANTIDAD = 'fulfillment_availability#1.quantity'

/**
 * Canales de logística, por su CÓDIGO interno de Amazon.
 *
 * `DEFAULT` es «logística por parte del vendedor», o sea que envía el cliente.
 * `AMAZON_EU` es FBA. El módulo solo pide DEFAULT y solo si se lo piden: ver la
 * advertencia de `FillTemplateOptions.canal`.
 *
 * OJO: este código NO es lo que se escribe en la celda. Ver el bloque de abajo.
 */
export type CanalLogistica = 'DEFAULT' | 'AMAZON_EU'

/** El que rellena el interruptor de la pantalla: gestionado por el vendedor */
export const CANAL_VENDEDOR: CanalLogistica = 'DEFAULT'

/**
 * ---------------------------------------------------------------------------
 * EN LA CELDA DEL CANAL VA LA ETIQUETA TRADUCIDA, NO EL CÓDIGO
 * ---------------------------------------------------------------------------
 * La columna del canal es un desplegable y sus valores están en el idioma de
 * la plantilla. En la española son «Logística por parte del vendedor
 * (predeterminado)» y «Logística de Amazon (UE)»; es Amazon quien los traduce
 * a DEFAULT y AMAZON_EU al procesar el fichero, con el mapa que él mismo deja
 * escrito en `attributeSettings`, dentro de la cadena de A1.
 *
 * Escribir «DEFAULT» a pelo deja la celda con un valor que la propia hoja no
 * admite: la validación de datos de esa columna apunta a la lista de
 * 'Dropdown Lists' y ninguna de sus dos entradas es «DEFAULT». Peor todavía,
 * las fórmulas de validación del libro comparan esa celda contra el texto
 * traducido (CONDITION_LIST_0 = «Logística por parte del vendedor
 * (predeterminado)»), así que el fichero sale mal sin que nada se queje: el
 * problema aparece en el informe de procesamiento de Seller Central, y la hoja
 * de instrucciones avisa de que un valor no válido en un campo obligatorio
 * hace que el listing no se actualice.
 *
 * Por eso la etiqueta se LEE de la plantilla en vez de estar escrita aquí:
 * así funciona igual con la plantilla de un cliente que tenga Seller Central
 * en otro idioma, donde el texto es otro.
 */

/** Fila de datos por defecto si la plantilla no declara `dataRow` en su cadena de A1 */
const FILA_DATOS_POR_DEFECTO = 7

/** Fila de nombres técnicos por defecto, mismo caso */
const FILA_ATRIBUTOS_POR_DEFECTO = 5

/** Última fila que admite el formato de Excel; pasarse genera un fichero ilegible */
const MAX_FILAS_EXCEL = 1_048_576

/** Tipo MIME del .xlsm. El de .xlsx hace que algunos navegadores le cambien la extensión */
export const MIME_XLSM = 'application/vnd.ms-excel.sheet.macroEnabled.12'

// =====================================================
// Tipos
// =====================================================

/** Una línea de la plantilla: el SKU de Amazon y las unidades que se van a publicar */
export interface AmazonTemplateRow {
  sku: string
  stock: number
}

export interface FillTemplateOptions {
  /** Nombre del fichero que ha subido la persona, solo para los mensajes de error */
  filename?: string | null
  /** Por si algún día Amazon renombra la hoja; por defecto «Plantilla» */
  sheetName?: string
  /**
   * Canal de logística para la columna correspondiente, por su CÓDIGO.
   *
   * `null` (lo normal) deja la columna vacía, que es lo que pidió el usuario.
   * Con un código, en la celda se escribe la ETIQUETA que esa plantilla usa
   * para él, leída de la propia plantilla: ver el bloque «EN LA CELDA DEL CANAL
   * VA LA ETIQUETA TRADUCIDA».
   *
   * Rellenarlo no es lo que saca un producto de FBA —eso lo hace la columna de
   * cantidad, que se escribe siempre— pero sí declara explícitamente que el
   * SKU lo envía el vendedor. La pantalla explica las dos cosas.
   */
  canal?: CanalLogistica | null
}

export interface FilledTemplate {
  /** El .xlsm ya rellenado */
  buffer: Buffer
  /** Ruta de la hoja dentro del ZIP, p. ej. `xl/worksheets/sheet5.xml`; útil para depurar */
  sheetPath: string
  /** Nombre de la hoja de datos; casi siempre «Plantilla», pero está traducido */
  sheetName: string
  /** Primera fila de datos que declara la plantilla */
  dataRow: number
  /** Columnas donde se ha escrito de verdad, resueltas por nombre técnico */
  colSku: string
  colCantidad: string
  colCanal: string | null
  /** El texto que se ha escrito en la columna del canal, ya traducido */
  canalEtiqueta: string | null
  /** Filas escritas */
  rows: number
  /** Filas de datos de una carga anterior que se han borrado antes de escribir */
  clearedRows: number
  /** Versión de la plantilla según su cadena de A1 (p. ej. «2026.0806») */
  version: string | null
  /**
   * La cuenta de vendedor y el marketplace para los que Amazon generó esta
   * plantilla. Van fuera porque son lo único que distingue la plantilla de un
   * cliente de la de otro: las columnas técnicas son idénticas en todas las
   * cuentas, así que sin comparar esto no hay forma de detectar que se ha
   * subido la plantilla equivocada hasta que Seller Central devuelve un error
   * por SKU.
   */
  contributorId: string | null
  marketplaceId: string | null
  /** Avisos para enseñar en pantalla; ninguno impide subir el fichero */
  warnings: string[]
}

// =====================================================
// Entrada
// =====================================================

/**
 * Rellena la plantilla de Amazon con las filas del cruce y devuelve el .xlsm.
 *
 * Comprueba ANTES de escribir nada que el fichero es la plantilla que toca. Si
 * no lo es, lanza un StockSyncError con una frase que dice qué se ha subido y
 * qué se esperaba: descubrirlo por un fichero rechazado en Seller Central, dos
 * horas después, no le sirve a nadie.
 */
export function fillAmazonTemplate(
  template: WorkbookInput,
  rows: AmazonTemplateRow[],
  options: FillTemplateOptions = {}
): FilledTemplate {
  const etiqueta = fileLabel(options.filename)
  const nombreBuscado = options.sheetName || HOJA_PLANTILLA
  const warnings: string[] = []

  if (rows.length === 0) {
    // Defensivo: la ruta ya corta antes. Una plantilla sin filas subida a
    // Amazon no hace nada, pero da la falsa sensación de que sí.
    throw new StockSyncError(
      'No hay ninguna fila que escribir en la plantilla de Amazon: el cruce no ha resuelto ningún SKU'
    )
  }

  // Igual de defensivo, y por el mismo motivo: una fila con el SKU vacío es una
  // línea que Amazon devuelve como error, y aquí todavía se puede decir cuál.
  const vacia = rows.findIndex((row) => !String(row?.sku ?? '').trim())
  if (vacia >= 0) {
    throw new StockSyncError(
      `La fila ${vacia + 1} de las que iban a la plantilla de Amazon no tiene SKU, y sin SKU no hay ` +
        'listing que actualizar. Revisa la tabla de mapeo del cliente'
    )
  }

  // ---------- Abrir el paquete ----------
  const files = unzip(template, etiqueta)
  // El orden de las entradas se guarda ANTES de tocar nada y se respeta al
  // recomprimir: un ZIP reordenado sigue siendo válido, pero cuanto menos se
  // parezca el fichero al que genera Amazon, más papeletas para un rechazo raro.
  const orden = Object.keys(files)

  if (!files['xl/workbook.xml']) {
    throw new StockSyncError(
      `${etiqueta} es un archivo comprimido, pero no un libro de Excel: no tiene dentro ` +
        'xl/workbook.xml. Sube la plantilla «Precio y cantidad» tal cual la descargas de ' +
        'Seller Central, sin volver a guardarla con otro programa'
    )
  }

  // ---------- Localizar la hoja de datos ----------
  // Las cadenas de texto se leen antes porque hacen falta para reconocer la
  // hoja cuando la plantilla viene en otro idioma y no se llama «Plantilla».
  const shared = readSharedStrings(files)
  const hoja = resolveSheetPath(files, nombreBuscado, etiqueta, shared)
  const sheetPath = hoja.path
  const sheetName = hoja.name
  const sheetXmlRaw = files[sheetPath]
  if (!sheetXmlRaw) {
    throw new StockSyncError(
      `${etiqueta} dice tener una hoja «${sheetName}» pero el fichero que la contiene ` +
        `(${sheetPath}) no está dentro del paquete. La plantilla ha llegado incompleta: vuelve a ` +
        'descargarla de Seller Central'
    )
  }
  if (sheetName !== nombreBuscado) {
    warnings.push(
      `La hoja de datos de ${etiqueta} no se llama «${nombreBuscado}» sino «${sheetName}»: la ` +
        'plantilla está descargada de un Seller Central en otro idioma. Se ha rellenado esa, que ' +
        'es la que lleva la configuración de Amazon; las columnas se han buscado por su nombre ' +
        'técnico, que no está traducido'
    )
  }

  let xml = decode(sheetXmlRaw)

  // ---------- Leer la configuración que Amazon esconde en A1 ----------
  const settings = readSettings(xml, shared)
  const dataRow = positiveInt(settings.dataRow) ?? FILA_DATOS_POR_DEFECTO
  const attributeRow = positiveInt(settings.attributeRow) ?? FILA_ATRIBUTOS_POR_DEFECTO
  const labelRow = positiveInt(settings.labelRow)

  if (Object.keys(settings).length === 0) {
    warnings.push(
      `La celda A1 de la hoja «${sheetName}» no trae la configuración que Amazon escribe en sus ` +
        `plantillas. Se han usado las filas de siempre (nombres técnicos en la ${attributeRow}, ` +
        `datos a partir de la ${dataRow}). Revisa el fichero antes de subirlo`
    )
  }
  if (dataRow <= attributeRow) {
    throw new StockSyncError(
      `${etiqueta} declara que los datos empiezan en la fila ${dataRow} y que los nombres de ` +
        `columna están en la ${attributeRow}, que es imposible. El fichero está corrupto o no es ` +
        'una plantilla de Amazon: vuelve a descargarla de Seller Central'
    )
  }

  // ---------- Qué columna es cada cosa (por NOMBRE, nunca por posición) ----------
  const columnaPorAtributo = readAttributeColumns(xml, attributeRow, shared)
  const colSku = columnaPorAtributo.get(ATRIBUTO_SKU) ?? null
  const colCantidad = columnaPorAtributo.get(ATRIBUTO_CANTIDAD) ?? null
  const colCanal = columnaPorAtributo.get(ATRIBUTO_CANAL) ?? null

  const faltan: string[] = []
  if (!colSku) faltan.push(`la del SKU («${ATRIBUTO_SKU}»)`)
  if (!colCantidad) faltan.push(`la de la cantidad («${ATRIBUTO_CANTIDAD}»)`)

  if (faltan.length > 0 || !colSku || !colCantidad) {
    throw new StockSyncError(
      wrongTemplateMessage({
        etiqueta,
        sheetName,
        attributeRow,
        faltan,
        settings,
        columnas: describeColumns(xml, labelRow, attributeRow, shared),
      })
    )
  }

  if (options.canal && !colCanal) {
    // Preferible parar aquí que rellenar «la de al lado del SKU» y esperar a
    // ver qué pasa: escribir un canal de logística en la columna equivocada le
    // cambia a Amazon un atributo distinto del que se pretendía.
    throw new StockSyncError(
      `La hoja «${sheetName}» de ${etiqueta} no tiene la columna del canal de logística ` +
        `(«${ATRIBUTO_CANAL}»), así que no se puede rellenar. Apaga el interruptor del canal de ` +
        'logística y vuelve a procesar: el fichero saldrá con el SKU y la cantidad, que es lo ' +
        'que Amazon necesita para actualizar el stock'
    )
  }

  // Que las columnas no estén donde siempre no es un error —el módulo escribe
  // donde toca— pero sí algo que la persona tiene que saber antes de subirlo.
  if (colSku !== 'A' || colCantidad !== 'C') {
    warnings.push(
      `En esta plantilla el SKU no está en la columna A y la cantidad en la C, sino en la ` +
        `${colSku} y la ${colCantidad}. El fichero se ha rellenado ahí, que es donde Amazon las ` +
        `declara en la fila ${attributeRow}`
    )
  }

  const ultimaFila = dataRow + rows.length - 1
  if (ultimaFila > MAX_FILAS_EXCEL) {
    throw new StockSyncError(
      `Son ${rows.length} filas y la plantilla empieza en la ${dataRow}: no caben en una hoja de ` +
        'Excel. Divide el envío en varias plantillas'
    )
  }

  // ---------- Cómo se llama aquí el canal que nos han pedido ----------
  // Se resuelve ANTES de tocar nada: si la plantilla no dice cómo se traduce,
  // es preferible parar que escribir 395 celdas con un valor que su propia
  // validación rechaza (ver el bloque «EN LA CELDA DEL CANAL VA LA ETIQUETA»).
  const canalEtiqueta =
    options.canal && colCanal
      ? resolveChannelLabel({
          files,
          xml,
          shared,
          settings,
          codigo: options.canal,
          colCanal,
          dataRow,
          etiqueta,
          sheetName,
        })
      : null

  // ---------- Escribir ----------
  const estiloPorColumna = readColumnStyles(xml)
  const cuerpo = buildRows(rows, {
    dataRow,
    colSku,
    colCantidad,
    colCanal,
    canal: canalEtiqueta,
    estiloPorColumna,
  })

  const { xml: conFilas, cleared } = replaceDataRows(xml, cuerpo, dataRow, etiqueta, sheetName)
  xml = conFilas

  if (cleared > 0) {
    warnings.push(
      `La plantilla ya traía ${cleared} ${cleared === 1 ? 'fila' : 'filas'} de datos de una carga ` +
        'anterior. Se han borrado antes de escribir para que los SKU de hoy no se mezclen con los ' +
        'de la vez pasada'
    )
  }

  xml = updateDimension(xml, dataRow - 1, ultimaFila, [colSku, colCantidad, colCanal])

  files[sheetPath] = encode(xml)

  // ---------- Recomprimir ----------
  // Nivel 6: el mismo equilibrio que usa Excel. Con nivel 0 (sin comprimir) el
  // fichero también es válido, pero pasa de 30 KB a 160 KB por nada.
  const salida: Record<string, Uint8Array> = {}
  for (const nombre of orden) salida[nombre] = files[nombre]

  return {
    buffer: Buffer.from(zipSync(salida, { level: 6 })),
    sheetPath,
    sheetName,
    dataRow,
    colSku,
    colCantidad,
    colCanal: canalEtiqueta ? colCanal : null,
    canalEtiqueta,
    rows: rows.length,
    clearedRows: cleared,
    version: settings.Version ?? settings.version ?? null,
    contributorId: settings.contributorId || null,
    marketplaceId: settings.primaryMarketplaceId || null,
    warnings,
  }
}

// =====================================================
// Apertura del paquete
// =====================================================

function unzip(template: WorkbookInput, etiqueta: string): Record<string, Uint8Array> {
  const bytes =
    template instanceof Uint8Array ? template : new Uint8Array(template as ArrayBuffer)

  // Un .xlsm siempre empieza por «PK». Comprobarlo antes de descomprimir separa
  // «has subido un .xls antiguo o un CSV» de «el fichero está corrupto», que se
  // arreglan de formas distintas.
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new StockSyncError(
      `${etiqueta} no es un Excel moderno (.xlsm/.xlsx). La plantilla de Amazon se descarga en ` +
        'Seller Central, en la carga de inventario, eligiendo «Precio y cantidad», y llega como .xlsm'
    )
  }

  try {
    return unzipSync(bytes) as Record<string, Uint8Array>
  } catch {
    throw new StockSyncError(
      `${etiqueta} no se puede abrir: el fichero está dañado o incompleto. Vuelve a descargar la ` +
        'plantilla de Seller Central y súbela sin abrirla con otro programa'
    )
  }
}

/** Una hoja del libro con el fichero XML al que apunta */
export interface HojaLibro {
  name: string
  /** Vacío si la relación no resuelve a ningún fichero del paquete */
  path: string
}

/**
 * Las hojas del libro, en orden, con el fichero que contiene cada una.
 *
 * NUNCA por posición: el orden de `<sheets>` en workbook.xml y la numeración
 * `sheetN.xml` no tienen por qué coincidir, y en la plantilla de otro cliente
 * la hoja de datos puede no ser la quinta. El camino correcto es
 * workbook.xml → el r:id de la hoja → workbook.xml.rels → el Target.
 */
function listSheets(files: Record<string, Uint8Array>): HojaLibro[] {
  const workbookPath = 'xl/workbook.xml'
  const wb = decode(files[workbookPath])
  const relsPath = 'xl/_rels/workbook.xml.rels'
  const rels = files[relsPath] ? decode(files[relsPath]) : ''

  const destinos = new Map<string, string>()
  for (const tag of rels.match(/<Relationship\b[^>]*\/?>/g) ?? []) {
    const id = tag.match(/\sId="([^"]*)"/)
    const target = tag.match(/\sTarget="([^"]*)"/)
    if (id && target) destinos.set(id[1], resolvePackagePath(workbookPath, unescapeXml(target[1])))
  }

  const hojas: HojaLibro[] = []
  for (const tag of wb.match(/<(?:\w+:)?sheet\b[^>]*\/?>/g) ?? []) {
    const name = tag.match(/\sname="([^"]*)"/)
    if (!name) continue
    const rid = tag.match(/\sr:id="([^"]*)"/) ?? tag.match(/\sid="([^"]*)"/)
    // El atributo viene escapado en XML: una hoja llamada «A&B» aparece como
    // «A&amp;B» y compararla sin desescapar no casaría nunca.
    hojas.push({
      name: unescapeXml(name[1]),
      path: (rid && destinos.get(rid[1])) || '',
    })
  }
  return hojas
}

/**
 * De «Plantilla» al fichero XML que la contiene.
 *
 * Si no hay ninguna hoja con ese nombre se busca por contenido: los nombres de
 * las ocho hojas están TRADUCIDOS al idioma del Seller Central del que se
 * descarga la plantilla («Template» en inglés, «Modèle» en francés), y la hoja
 * de instrucciones prohíbe expresamente renombrarlas, así que el usuario no
 * podría arreglarlo por su cuenta. La hoja de datos se reconoce sin depender
 * del idioma: es la única que lleva en A1 la cadena `settings=` de Amazon.
 */
export function resolveSheetPath(
  files: Record<string, Uint8Array>,
  sheetName: string,
  etiqueta = 'el fichero',
  shared: string[] = []
): HojaLibro {
  const hojas = listSheets(files)

  const porNombre = hojas.find((h) => h.name === sheetName)
  if (porNombre?.path) return porNombre
  if (porNombre && !porNombre.path) {
    throw new StockSyncError(
      `En ${etiqueta}, la hoja «${sheetName}» no apunta a ningún fichero dentro del paquete. La ` +
        'plantilla ha llegado corrupta: vuelve a descargarla de Seller Central'
    )
  }

  // Respaldo por contenido, para las plantillas en otro idioma.
  const conSettings = hojas
    .filter((h) => h.path && files[h.path])
    .map((h) => ({ hoja: h, settings: readSettings(decode(files[h.path]), shared) }))
    .filter((h) => Object.keys(h.settings).length > 0)

  const dePrecioYCantidad = conSettings.filter(
    (h) => h.settings.flavor === 'seller-price-quantity'
  )
  if (dePrecioYCantidad.length === 1) return dePrecioYCantidad[0].hoja
  // Una sola hoja con configuración y de otro tipo: se rellena igual y es la
  // comprobación de columnas la que dirá que la plantilla no es la que toca,
  // que es un mensaje mucho más útil que «no encuentro la hoja».
  if (dePrecioYCantidad.length === 0 && conSettings.length === 1) return conSettings[0].hoja

  const nombres = hojas.map((h) => `«${h.name}»`).join(', ') || 'ninguna'
  throw new StockSyncError(
    `${etiqueta} no tiene ninguna hoja llamada «${sheetName}» ni ninguna con la configuración que ` +
      `Amazon escribe en sus plantillas. Las hojas que trae son: ${nombres}. La plantilla «Precio ` +
      'y cantidad» de Amazon trae ocho hojas y los SKU van en la que se llama «Plantilla». ' +
      'Comprueba que no has subido el volcado del ERP ni una plantilla de otro tipo'
  )
}

/**
 * Resuelve el Target de una relación contra el fichero que la declara.
 *
 * A mano y no con `path.posix` porque este módulo no necesita ningún built-in
 * de Node y así no arrastra ninguno a quien lo importe.
 */
function resolvePackagePath(basePath: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)

  const dir = basePath.includes('/') ? basePath.slice(0, basePath.lastIndexOf('/')) : ''
  const partes = (dir ? `${dir}/${target}` : target).split('/')
  const out: string[] = []
  for (const parte of partes) {
    if (!parte || parte === '.') continue
    if (parte === '..') {
      out.pop()
      continue
    }
    out.push(parte)
  }
  return out.join('/')
}

// =====================================================
// Lectura de la hoja
// =====================================================

/** Texto de una celda, resolviendo la tabla de cadenas compartidas si hace falta */
function cellText(cellXml: string, shared: string[]): string {
  const t = cellXml.match(/\st="([^"]*)"/)?.[1]

  if (t === 'inlineStr') {
    const m = cellXml.match(/<is>[\s\S]*?<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/)
    return m ? unescapeXml(m[1]) : ''
  }

  const v = cellXml.match(/<v>([\s\S]*?)<\/v>/)
  if (!v) return ''
  if (t === 's') return shared[Number(v[1])] ?? ''
  return unescapeXml(v[1])
}

/** El contenido de `xl/sharedStrings.xml`, que es donde vive el texto de las celdas */
function readSharedStrings(files: Record<string, Uint8Array>): string[] {
  const raw = files['xl/sharedStrings.xml']
  if (!raw) return []

  const xml = decode(raw)
  return (xml.match(/<si>[\s\S]*?<\/si>/g) ?? []).map((si) =>
    // Se concatenan todos los <t> del <si>: una cadena con formato mezclado
    // viene partida en varios <r><t>…</t></r>.
    (si.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) ?? [])
      .map((t) => unescapeXml(t.replace(/^<t(?:\s[^>]*)?>/, '').replace(/<\/t>$/, '')))
      .join('')
  )
}

/** El XML de una fila concreta de la hoja, o cadena vacía si no existe */
function rowXml(xml: string, n: number): string {
  // La alternativa de la fila autocerrada va PRIMERO y es obligatoria: sin ella,
  // un `<row r="5"/>` sin celdas haría que el `</row>` que cierra el patrón
  // fuera el de la fila siguiente y devolveríamos las celdas de otra fila.
  const abre = `<row\\s[^>]*\\br="${n}"`
  return xml.match(new RegExp(`${abre}[^>]*?/>|${abre}[^>]*>[\\s\\S]*?</row>`))?.[0] ?? ''
}

/** Las celdas de una fila, con su letra de columna */
function cellsOf(row: string): { col: string; xml: string }[] {
  const out: { col: string; xml: string }[] = []
  for (const c of row.match(/<c\b[^>]*\/>|<c\b[^>]*>[\s\S]*?<\/c>/g) ?? []) {
    const ref = c.match(/\sr="([A-Z]+)\d+"/)
    if (ref) out.push({ col: ref[1], xml: c })
  }
  return out
}

/**
 * La configuración que Amazon guarda en A1 (`settings=clave=valor&clave=valor`).
 *
 * De ahí salen `dataRow`, `attributeRow` y `labelRow`. Leerlos en vez de dar por
 * hecho «los datos empiezan en la 7» es lo que hace que el módulo siga
 * funcionando con la plantilla de la temporada que viene.
 */
function readSettings(xml: string, shared: string[]): Record<string, string> {
  const a1 = cellsOf(rowXml(xml, 1)).find((c) => c.col === 'A')
  const crudo = a1 ? cellText(a1.xml, shared) : ''
  if (!crudo.startsWith('settings=')) return {}

  const settings: Record<string, string> = {}
  for (const par of crudo.replace(/^settings=/, '').split('&')) {
    const i = par.indexOf('=')
    if (i <= 0) continue
    const clave = par.slice(0, i)
    const valor = par.slice(i + 1)
    try {
      settings[clave] = decodeURIComponent(valor)
    } catch {
      // Un %-suelto en el valor rompe decodeURIComponent; el crudo vale igual.
      settings[clave] = valor
    }
  }
  return settings
}

/** Nombre técnico de cada columna → su letra, leído de la fila de atributos */
function readAttributeColumns(
  xml: string,
  attributeRow: number,
  shared: string[]
): Map<string, string> {
  const out = new Map<string, string>()
  for (const c of cellsOf(rowXml(xml, attributeRow))) {
    const nombre = cellText(c.xml, shared).trim()
    // La primera gana: si Amazon repitiera un atributo, escribir en la de más a
    // la izquierda es lo mismo que hace su propia plantilla.
    if (nombre && !out.has(nombre)) out.set(nombre, c.col)
  }
  return out
}

/**
 * El estilo por defecto de cada columna, sacado de `<cols>`.
 *
 * Importa: en esta plantilla la columna del SKU lleva un estilo con formato de
 * texto («@») y la de la cantidad uno de entero. Sin copiar ese `s=`, la celda
 * cae al estilo General y el SKU se ve alineado a la derecha como si fuera un
 * número, que es justo la duda que no queremos sembrar.
 */
function readColumnStyles(xml: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const col of xml.match(/<col\b[^>]*\/?>/g) ?? []) {
    const min = Number(col.match(/\smin="(\d+)"/)?.[1])
    const max = Number(col.match(/\smax="(\d+)"/)?.[1])
    const style = col.match(/\sstyle="(\d+)"/)?.[1]
    if (!min || !max || style === undefined) continue
    // Tope de 64 columnas: algunas plantillas declaran el estilo hasta la 16384
    // y recorrerlas todas es tiempo tirado, no hay atributos ahí.
    for (let i = min; i <= Math.min(max, 64); i++) out.set(colLetter(i), style)
  }
  return out
}

// =====================================================
// El canal de logística y su traducción
// =====================================================

interface ChannelLabelInput {
  files: Record<string, Uint8Array>
  xml: string
  shared: string[]
  settings: Record<string, string>
  codigo: CanalLogistica
  colCanal: string
  dataRow: number
  etiqueta: string
  sheetName: string
}

/**
 * Cómo se llama en ESTA plantilla el canal cuyo código es `codigo`.
 *
 * Sale del mapa de traducciones que Amazon guarda en `attributeSettings` y,
 * cuando se puede, se comprueba contra el desplegable de la propia columna
 * antes de escribir nada. Si no hay forma de averiguarlo se corta con un error
 * en vez de escribir el código a secas: una plantilla con 395 celdas fuera de
 * la lista permitida se sube sin protestar y falla dos horas después, en el
 * informe de procesamiento de Seller Central.
 */
function resolveChannelLabel(input: ChannelLabelInput): string {
  const { files, xml, shared, settings, codigo, colCanal, dataRow, etiqueta, sheetName } = input

  const aliases = readAttributeAliases(settings, ATRIBUTO_CANAL)
  const label = aliases
    ? Object.keys(aliases).find((texto) => aliases[texto] === codigo) ?? null
    : null

  const admitidos = readAllowedValues(files, xml, shared, colCanal, dataRow)

  if (!label) {
    const lista = admitidos && admitidos.length > 0 ? ` Admite ${quoteList(admitidos)}.` : ''
    throw new StockSyncError(
      `${etiqueta} no dice cómo se llama en su idioma el canal «gestionado por el vendedor», así ` +
        `que no se puede rellenar la columna ${colCanal} de la hoja «${sheetName}» sin arriesgarse ` +
        `a escribir un valor que Amazon rechace.${lista} Apaga el interruptor del canal de ` +
        'logística y vuelve a procesar: el fichero saldrá con el SKU y la cantidad. Si necesitas ' +
        'el canal, vuelve a descargar la plantilla de Seller Central'
    )
  }

  if (admitidos && admitidos.length > 0 && !admitidos.some((v) => sameText(v, label))) {
    throw new StockSyncError(
      `En ${etiqueta}, el canal «gestionado por el vendedor» se llama «${label}», pero la columna ` +
        `${colCanal} de la hoja «${sheetName}» solo admite ${quoteList(admitidos)}. La plantilla se ` +
        'contradice a sí misma, así que está manipulada o corrupta: vuelve a descargarla de Seller ' +
        'Central, o apaga el interruptor del canal de logística para generar el fichero solo con ' +
        'el SKU y la cantidad'
    )
  }

  return label
}

/**
 * El mapa ETIQUETA → CÓDIGO de un atributo, sacado de `attributeSettings`.
 *
 * Viaja dentro de la cadena de A1 como JSON en base64, con esta forma:
 *   [{ "attribute": "…fulfillment_channel_code",
 *      "aliases": { "Logística por parte del vendedor (predeterminado)": "DEFAULT", … } }]
 */
function readAttributeAliases(
  settings: Record<string, string>,
  atributo: string
): Record<string, string> | null {
  const crudo = settings.attributeSettings
  if (!crudo) return null

  let data: unknown
  try {
    data = JSON.parse(Buffer.from(crudo, 'base64').toString('utf8'))
  } catch {
    // base64 truncado o JSON de otra versión: se trata como «no se sabe».
    return null
  }
  if (!Array.isArray(data)) return null

  for (const entrada of data) {
    if (!entrada || typeof entrada !== 'object') continue
    const { attribute, aliases } = entrada as { attribute?: unknown; aliases?: unknown }
    if (attribute !== atributo) continue
    if (!aliases || typeof aliases !== 'object') return null

    const out: Record<string, string> = {}
    for (const [texto, codigo] of Object.entries(aliases as Record<string, unknown>)) {
      if (typeof codigo === 'string') out[texto] = codigo
    }
    return Object.keys(out).length > 0 ? out : null
  }
  return null
}

/** Cuántas celdas se leen como mucho de un desplegable; de sobra para los de Amazon */
const MAX_VALORES_DESPLEGABLE = 200

/**
 * Los valores que admite el desplegable de una columna, o null si no hay forma
 * de resolverlos.
 *
 * El camino es: validación de datos de la celda → `formula1` → nombre definido
 * del libro → rango de la hoja oculta «Dropdown Lists» → texto de las celdas.
 */
function readAllowedValues(
  files: Record<string, Uint8Array>,
  xml: string,
  shared: string[],
  col: string,
  fila: number
): string[] | null {
  const formula = findListFormula(xml, col, fila)
  if (!formula) return null

  // Lista escrita a mano dentro de la propia validación: "uno,dos,tres".
  if (formula.startsWith('"')) {
    return formula
      .replace(/^"|"$/g, '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
  }

  const rango = formula.includes('!') ? formula : lookupDefinedName(files, formula)
  if (!rango || !rango.includes('!')) return null
  return readRangeTexts(files, shared, rango)
}

/** La fórmula del desplegable que cubre una celda concreta */
function findListFormula(xml: string, col: string, fila: number): string | null {
  // La alternativa autocerrada va primero, como en rowXml: al revés, un
  // `<dataValidation … />` se tragaría hasta el `</dataValidation>` siguiente.
  const bloques =
    xml.match(/<dataValidation\b[^>]*\/>|<dataValidation\b[^>]*>[\s\S]*?<\/dataValidation>/g) ?? []

  for (const dv of bloques) {
    if (!/\stype="list"/.test(dv)) continue
    const sqref = dv.match(/\ssqref="([^"]*)"/)?.[1]
    if (!sqref || !sqrefCovers(sqref, col, fila)) continue
    const formula = dv.match(/<formula1(?:\s[^>]*)?>([\s\S]*?)<\/formula1>/)
    if (formula) return unescapeXml(formula[1]).trim()
  }
  return null
}

/** Si un `sqref` («B7:B1048576 D4») incluye la celda pedida */
function sqrefCovers(sqref: string, col: string, fila: number): boolean {
  const objetivo = colIndex(col)

  for (const rango of sqref.trim().split(/\s+/)) {
    const m = rango.match(/^\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/)
    if (!m) continue
    const c1 = colIndex(m[1])
    const f1 = Number(m[2])
    const c2 = m[3] ? colIndex(m[3]) : c1
    const f2 = m[4] ? Number(m[4]) : f1
    if (
      objetivo >= Math.min(c1, c2) &&
      objetivo <= Math.max(c1, c2) &&
      fila >= Math.min(f1, f2) &&
      fila <= Math.max(f1, f2)
    ) {
      return true
    }
  }
  return false
}

/** El rango al que apunta un nombre definido del libro */
function lookupDefinedName(files: Record<string, Uint8Array>, nombre: string): string | null {
  const wb = decode(files['xl/workbook.xml'])

  for (const tag of wb.match(/<definedName\b[^>]*>[\s\S]*?<\/definedName>/g) ?? []) {
    const name = tag.match(/\sname="([^"]*)"/)
    if (!name || unescapeXml(name[1]) !== nombre) continue
    const valor = unescapeXml(tag.replace(/^<definedName\b[^>]*>/, '').replace(/<\/definedName>$/, ''))
    // El libro arrastra nombres rotos («#REF!») de plantillas anteriores.
    if (valor && !valor.includes('#REF!')) return valor.trim()
  }
  return null
}

/** El texto de las celdas de un rango del tipo `'Dropdown Lists'!$C$4:$C$5` */
function readRangeTexts(
  files: Record<string, Uint8Array>,
  shared: string[],
  rango: string
): string[] | null {
  const m = rango.match(/^'?(.+?)'?!\$?([A-Z]+)\$?(\d+)(?::\$?([A-Z]+)\$?(\d+))?$/)
  if (!m) return null

  // Dentro de una referencia, una comilla del nombre de la hoja va doblada.
  const nombreHoja = m[1].replace(/''/g, "'")
  const hoja = listSheets(files).find((h) => h.name === nombreHoja)
  if (!hoja?.path || !files[hoja.path]) return null

  const c1 = colIndex(m[2])
  const f1 = Number(m[3])
  const c2 = m[4] ? colIndex(m[4]) : c1
  const f2 = m[5] ? Number(m[5]) : f1

  const xml = decode(files[hoja.path])
  const out: string[] = []
  for (let fila = Math.min(f1, f2); fila <= Math.max(f1, f2); fila++) {
    for (const c of cellsOf(rowXml(xml, fila))) {
      const i = colIndex(c.col)
      if (i < Math.min(c1, c2) || i > Math.max(c1, c2)) continue
      const texto = cellText(c.xml, shared).trim()
      if (texto) out.push(texto)
      if (out.length >= MAX_VALORES_DESPLEGABLE) return out
    }
  }
  return out
}

/**
 * Compara dos textos de Excel como los compararía una persona.
 *
 * `normalize('NFC')` no es cosmético: «Logística» se puede guardar con la í
 * como un solo carácter o como i + tilde combinante, y las dos cadenas se ven
 * idénticas en pantalla pero no son iguales para `===`.
 */
function sameText(a: string, b: string): boolean {
  return a.trim().normalize('NFC') === b.trim().normalize('NFC')
}

/** «"uno", "dos" y "tres"», para los mensajes de error */
function quoteList(valores: string[]): string {
  const entrecomillados = valores.map((v) => `«${v}»`)
  if (entrecomillados.length <= 1) return entrecomillados.join('')
  return `${entrecomillados.slice(0, -1).join(', ')} y ${entrecomillados[entrecomillados.length - 1]}`
}

// =====================================================
// Escritura
// =====================================================

interface BuildRowsContext {
  dataRow: number
  colSku: string
  colCantidad: string
  colCanal: string | null
  /** El texto que va en la celda del canal, ya traducido al idioma de la plantilla */
  canal: string | null
  estiloPorColumna: Map<string, string>
}

/** El XML de las filas de datos, listo para meter dentro de `<sheetData>` */
function buildRows(rows: AmazonTemplateRow[], ctx: BuildRowsContext): string {
  const { dataRow, colSku, colCantidad, colCanal, canal, estiloPorColumna } = ctx
  const estilo = (col: string) => {
    const s = estiloPorColumna.get(col)
    return s === undefined ? '' : ` s="${s}"`
  }

  const celdaTexto = (col: string, fila: number, valor: string) =>
    // `xml:space="preserve"`: sin él, un SKU con un espacio delante o detrás lo
    // pierde al abrirlo, y ese SKU ya no existe en la cuenta de Amazon.
    `<c r="${col}${fila}"${estilo(col)} t="inlineStr">` +
    `<is><t xml:space="preserve">${escapeXml(valor)}</t></is></c>`

  const bloques: string[] = []

  for (let i = 0; i < rows.length; i++) {
    const fila = dataRow + i
    const celdas: { col: string; xml: string }[] = []

    celdas.push({ col: colSku, xml: celdaTexto(colSku, fila, rows[i].sku) })

    if (canal && colCanal) {
      celdas.push({ col: colCanal, xml: celdaTexto(colCanal, fila, canal) })
    }

    // Entero y nunca negativo: Amazon rechaza el fichero entero por una sola
    // cantidad con decimales o en negativo.
    const unidades = Math.max(0, Math.trunc(Number(rows[i].stock) || 0))
    celdas.push({
      col: colCantidad,
      xml: `<c r="${colCantidad}${fila}"${estilo(colCantidad)}><v>${unidades}</v></c>`,
    })

    // Las celdas de una fila TIENEN que ir en orden ascendente de columna; con
    // ellas desordenadas Excel da el fichero por dañado y ni lo abre.
    celdas.sort((a, b) => colIndex(a.col) - colIndex(b.col))

    const min = colIndex(celdas[0].col)
    const max = colIndex(celdas[celdas.length - 1].col)
    bloques.push(`<row r="${fila}" spans="${min}:${max}">${celdas.map((c) => c.xml).join('')}</row>`)
  }

  return bloques.join('')
}

/**
 * Mete las filas nuevas dentro de `<sheetData>` y borra las que hubiera de una
 * vez anterior.
 *
 * Lo de borrar no es cosmético: si alguien reutiliza la plantilla que se bajó el
 * lunes, sin limpiar quedarían las 395 filas viejas debajo de las nuevas y
 * Amazon aplicaría las dos, con lo que el stock de la semana pasada pisaría al
 * de hoy en los SKU que aparecieran dos veces.
 *
 * Solo se tocan las filas a partir de `dataRow`. Las de arriba —incluida la 6,
 * que es el ejemplo «ABC123» de Amazon— se dejan intactas: están por encima de
 * la primera fila de datos y su propio cargador las ignora.
 */
function replaceDataRows(
  xml: string,
  cuerpo: string,
  dataRow: number,
  etiqueta: string,
  sheetName: string
): { xml: string; cleared: number } {
  const autocerrado = /<sheetData\s*\/>/.exec(xml)
  if (autocerrado) {
    return {
      xml:
        xml.slice(0, autocerrado.index) +
        `<sheetData>${cuerpo}</sheetData>` +
        xml.slice(autocerrado.index + autocerrado[0].length),
      cleared: 0,
    }
  }

  const bloque = /(<sheetData(?:\s[^>]*)?>)([\s\S]*?)(<\/sheetData>)/.exec(xml)
  if (!bloque) {
    throw new StockSyncError(
      `La hoja «${sheetName}» de ${etiqueta} no tiene datos donde debería (<sheetData>). El ` +
        'fichero no es una plantilla de Amazon válida: vuelve a descargarla de Seller Central'
    )
  }

  const conservadas: string[] = []
  let cleared = 0
  for (const row of bloque[2].match(/<row\b[^>]*\/>|<row\b[^>]*>[\s\S]*?<\/row>/g) ?? []) {
    const r = Number(row.match(/\sr="(\d+)"/)?.[1])
    // Sin número de fila se conserva: son las de cabecera de plantillas raras y
    // tirarlas sería perder formato por una suposición.
    if (Number.isFinite(r) && r >= dataRow) {
      cleared++
      continue
    }
    conservadas.push(row)
  }

  return {
    xml:
      xml.slice(0, bloque.index) +
      bloque[1] +
      conservadas.join('') +
      cuerpo +
      bloque[3] +
      xml.slice(bloque.index + bloque[0].length),
    cleared,
  }
}

/**
 * Deja `<dimension>` cubriendo hasta la última fila escrita.
 *
 * Excel usa ese rango como pista para reservar memoria y para el «ir a la última
 * celda». Dejarlo en A1:AF6 con 395 filas debajo no impide que Amazon lea el
 * fichero, pero hace que al abrirlo parezca vacío, y quien lo abre para revisar
 * antes de subirlo concluye —con razón aparente— que el proceso ha fallado.
 */
function updateDimension(
  xml: string,
  filaMinima: number,
  ultimaFila: number,
  columnas: (string | null)[]
): string {
  return xml.replace(
    // La fila final del rango original no se captura: se recalcula entera, así
    // que leerla solo serviría para tener la tentación de conservarla.
    /<dimension\s+ref="([A-Z]+)(\d+)(?::([A-Z]+)\d+)?"\s*\/>/,
    (_m, c1: string, r1: string, c2: string | undefined) => {
      const colFinal = c2 ?? c1
      // La columna declarada manda salvo que hayamos escrito más a la derecha,
      // que pasaría con una plantilla que moviera la cantidad al final.
      const maxCol = Math.max(
        colIndex(colFinal),
        ...columnas.filter((c): c is string => Boolean(c)).map(colIndex)
      )
      // La fila final se recalcula, NO se amplía sobre la que hubiera: las
      // filas de datos anteriores acaban de borrarse, así que un rango heredado
      // dejaría a Excel buscando 400 filas que ya no existen.
      const filaFinal = Math.max(filaMinima, ultimaFila)
      return `<dimension ref="${c1}${r1}:${colLetter(maxCol)}${filaFinal}" />`
    }
  )
}

// =====================================================
// Mensajes de error
// =====================================================

/** Las etiquetas legibles de la fila 4 junto al nombre técnico de la 5, para el error */
function describeColumns(
  xml: string,
  labelRow: number | null,
  attributeRow: number,
  shared: string[]
): string[] {
  const etiquetas = new Map<string, string>()
  if (labelRow) {
    for (const c of cellsOf(rowXml(xml, labelRow))) {
      const texto = cellText(c.xml, shared).trim()
      if (texto) etiquetas.set(c.col, texto)
    }
  }

  const out: string[] = []
  for (const c of cellsOf(rowXml(xml, attributeRow))) {
    const tecnico = cellText(c.xml, shared).trim()
    if (!tecnico) continue
    const legible = etiquetas.get(c.col)
    out.push(legible ? `${c.col}: ${legible} («${tecnico}»)` : `${c.col}: «${tecnico}»`)
  }
  return out
}

/**
 * La frase que ve quien ha subido el fichero equivocado.
 *
 * Dice tres cosas, en este orden: qué fichero ha subido, qué le falta y de dónde
 * sacar el bueno. Un «cannot read property of undefined» aquí significa una
 * llamada de teléfono; esta frase significa una segunda descarga y seguir.
 */
function wrongTemplateMessage(input: {
  etiqueta: string
  sheetName: string
  attributeRow: number
  faltan: string[]
  settings: Record<string, string>
  columnas: string[]
}): string {
  const { etiqueta, sheetName, attributeRow, faltan, settings, columnas } = input

  const flavor = settings.flavor || settings.TemplateType || ''
  const tipo =
    flavor && flavor !== 'seller-price-quantity'
      ? `, y esta parece la plantilla «${flavor}»`
      : ''

  const muestra =
    columnas.length > 0
      ? ` La fila ${attributeRow} de esa hoja trae ${columnas.slice(0, 6).join(' · ')}` +
        (columnas.length > 6 ? ` y ${columnas.length - 6} columnas más.` : '.')
      : ` La fila ${attributeRow} de esa hoja está vacía.`

  return (
    `La hoja «${sheetName}» de ${etiqueta} no tiene ${faltan.join(' ni ')}, así que no es la ` +
    `plantilla de precio y cantidad${tipo}.${muestra} Descarga en Seller Central del cliente la ` +
    'plantilla «Precio y cantidad» (PriceAndQuantity) y súbela sin modificarla: las columnas se ' +
    'buscan por su nombre técnico, no por su posición, para no escribir el stock en la columna ' +
    'equivocada'
  )
}

function fileLabel(filename: string | null | undefined): string {
  const nombre = (filename ?? '').trim()
  return nombre ? `«${nombre}»` : 'el fichero que has subido como plantilla'
}

// =====================================================
// Utilidades de XML y de columnas
// =====================================================

const decoder = new TextDecoder('utf-8')

function decode(bytes: Uint8Array | undefined): string {
  return bytes ? decoder.decode(bytes) : ''
}

function encode(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'utf8'))
}

/**
 * Escapa un valor para meterlo como texto dentro de un elemento XML.
 *
 * El `&` va PRIMERO: al revés se volvería a escapar el `&` de las entidades que
 * acabamos de escribir y saldría «&amp;lt;».
 */
export function escapeXml(value: string): string {
  return stripControlChars(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Quita los caracteres de control que XML 1.0 prohíbe.
 *
 * No es teoría: los volcados del ERP del cliente traen de vez en cuando un
 * carácter de control (un 0x00 o un 0x1F) pegado a una referencia, y uno solo
 * de esos deja el fichero ilegible para Excel y para Amazon. Se conservan
 * tabulador, salto de línea y retorno de carro, que sí son legales.
 */
function stripControlChars(value: string): string {
  // `String(value)` y no `value` a secas: el módulo se exporta y se llama desde
  // dos sitios, y un SKU que llegara nulo reventaría aquí con un TypeError que
  // la ruta contestaría como un 500 sin explicación, en vez de con la frase en
  // español de StockSyncError.
  let out = ''
  for (const ch of value == null ? '' : String(value)) {
    const code = ch.codePointAt(0) ?? 0
    if (code === 0x09 || code === 0x0a || code === 0x0d) {
      out += ch
      continue
    }
    if (code < 0x20 || code === 0xfffe || code === 0xffff) continue
    out += ch
  }
  return out
}

export function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    // El `&amp;` al final, por el mismo motivo que en escapeXml pero al revés.
    .replace(/&amp;/g, '&')
}

/** 1 → A, 3 → C, 27 → AA */
export function colLetter(n: number): string {
  let out = ''
  let resto = n
  while (resto > 0) {
    const r = (resto - 1) % 26
    out = String.fromCharCode(65 + r) + out
    resto = Math.floor((resto - 1) / 26)
  }
  return out
}

/** «AF» → 32 */
export function colIndex(letters: string): number {
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

function positiveInt(value: string | undefined): number | null {
  if (!value) return null
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}
