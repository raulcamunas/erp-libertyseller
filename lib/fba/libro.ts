/**
 * CIRUGÍA SOBRE LAS PLANTILLAS DE EXCEL QUE DESCARGA EL CLIENTE DE AMAZON.
 * =======================================================================
 *
 * Las dos plantillas del flujo de envíos —el manifiesto y la de embalaje de
 * cajas— se descargan de Seller Central, se rellenan y se vuelven a subir allí.
 * Aquí está lo común a las dos: abrir el ZIP, encontrar la hoja, leer celdas,
 * escribir filas y volver a cerrar el ZIP.
 *
 *
 * ============ POR QUÉ CIRUGÍA DEL ZIP Y NO REESCRIBIR EL LIBRO ============
 *
 * Esta pelea ya está dada en lib/stock-sync/amazon-template.ts y aquí se repite
 * la conclusión, no el experimento. Un .xlsx es un ZIP con XML dentro: se
 * descomprime, se toca ÚNICAMENTE la hoja que hace falta y se vuelve a comprimir
 * dejando todas las demás entradas byte a byte idénticas.
 *
 * La tentación es leer el libro con `xlsx` —que está en el proyecto— y volver a
 * escribirlo. Está probado y NO sirve: el viaje de ida y vuelta por su modelo de
 * datos se lleva por delante las validaciones de datos, los desplegables, el
 * formato condicional y los estilos. Medido sobre la plantilla de embalaje real:
 * las validaciones pasan de 3 a 0. El fichero se sigue abriendo en Excel, así
 * que el destrozo NO SE VE; se ve cuando Seller Central rechaza la carga o, peor,
 * cuando la acepta a medias.
 *
 * Y la de embalaje trae fórmulas que tienen que sobrevivir intactas:
 * `SUM(M6:INDEX(M6:XFD6,1,M3))` en la columna del total e
 * `IF(M3>=1,"P1 - B1","")` en la fila de los nombres de caja.
 *
 *
 * ============ NADA SE LOCALIZA POR SU POSICIÓN ============
 *
 * Es la regla del módulo y tiene una razón medida. La hoja de embalaje la genera
 * Amazon con UNA FILA POR SKU del envío, así que el bloque de peso y medidas SE
 * MUEVE: comprobado sobre 32 plantillas reales de esta misma cuenta, la fila del
 * peso es siempre `nSKU + 8` —fila 9 con 1 referencia, 31 con 23, 58 con 50, 91
 * con 83—. El procedimiento que se sigue hoy a mano escribe en la 31 a pelo, así
 * que solo funciona para envíos de exactamente 23 referencias; con 50 escribiría
 * los pesos encima de las filas de tres SKU, sin dar ningún error.
 *
 * Por eso todo se busca por su etiqueta y, si no aparece, NO SE ESCRIBE NADA.
 * Negarse es el fallo correcto; escribir «por si acaso» es el silencioso.
 */

import { unzipSync, zipSync } from 'fflate'

/** Lo que entra: los bytes del fichero que ha subido el usuario */
export type Plantilla = Uint8Array | ArrayBuffer

export class LibroError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LibroError'
  }
}

const decoder = new TextDecoder('utf-8')
const encoder = new TextEncoder()

export function decode(bytes: Uint8Array | undefined): string {
  return bytes ? decoder.decode(bytes) : ''
}
export function encode(texto: string): Uint8Array {
  return encoder.encode(texto)
}

export function escapeXml(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Excel no admite caracteres de control en el XML y un SKU copiado de otro
    // sitio puede traerlos. Un fichero con uno dentro no abre: Excel dice que el
    // contenido es ilegible y ofrece repararlo, y ahí ya nadie sabe qué pasó.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
}

export function unescapeXml(valor: string): string {
  return valor
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    // El & va EL ÚLTIMO: al revés, «&amp;lt;» se convertiría en «<» en vez de
    // en «&lt;», que es justo el texto que había.
    .replace(/&amp;/g, '&')
}

/** 1 → «A», 13 → «M», 27 → «AA» */
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

/** «AM» → 39 */
export function colIndex(letras: string): number {
  let n = 0
  for (const ch of letras.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

/* ------------------------------------------------------------------ */
/* Abrir y cerrar el paquete                                           */
/* ------------------------------------------------------------------ */

export type Paquete = Record<string, Uint8Array>

export function abrir(plantilla: Plantilla, etiqueta: string): Paquete {
  const bytes = plantilla instanceof Uint8Array ? plantilla : new Uint8Array(plantilla)

  // Un .xlsx siempre empieza por «PK». Comprobarlo antes de descomprimir separa
  // «has subido un CSV o un .xls viejo» de «el fichero está corrupto», que se
  // arreglan de formas distintas.
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new LibroError(
      `${etiqueta} no es un Excel moderno (.xlsx). Las plantillas se descargan de Seller Central ` +
        'y llegan ya en ese formato: si la has abierto y guardado con otro programa, vuelve a bajarla.'
    )
  }

  try {
    return unzipSync(bytes) as Paquete
  } catch {
    throw new LibroError(
      `${etiqueta} no se puede abrir: está dañado o incompleto. Vuelve a descargarlo de Seller ` +
        'Central y súbelo sin abrirlo.'
    )
  }
}

export function cerrar(paquete: Paquete): Uint8Array {
  // `level: 0` —sin comprimir— iría más rápido pero multiplicaría por tres el
  // tamaño del adjunto. 6 es el equilibrio de siempre y es lo que usa Excel.
  return zipSync(paquete, { level: 6 })
}

/* ------------------------------------------------------------------ */
/* Encontrar la hoja                                                   */
/* ------------------------------------------------------------------ */

export interface Hoja {
  nombre: string
  /** La ruta del XML dentro del paquete */
  ruta: string
}

/** Resuelve un Target de una relación, que puede venir absoluto o relativo */
function rutaDeDestino(target: string): string {
  const limpio = unescapeXml(target)
  // Amazon genera las dos plantillas con Target ABSOLUTO («/xl/worksheets/
  // sheet1.xml»), que es legal y poco común: casi toda la documentación enseña
  // el relativo. Tratar solo el relativo deja la hoja sin encontrar y el
  // fichero «sin la hoja esperada», que es un diagnóstico falso.
  if (limpio.startsWith('/')) return limpio.slice(1)
  return limpio.startsWith('xl/') ? limpio : `xl/${limpio}`
}

/**
 * Las hojas del libro con el fichero que contiene cada una.
 *
 * NUNCA por posición: el orden de `<sheets>` en workbook.xml y la numeración
 * `sheetN.xml` no tienen por qué coincidir. El camino correcto es
 * workbook.xml → el r:id de la hoja → workbook.xml.rels → el Target.
 */
export function hojasDe(paquete: Paquete): Hoja[] {
  const wb = decode(paquete['xl/workbook.xml'])
  const rels = decode(paquete['xl/_rels/workbook.xml.rels'])

  const destinos = new Map<string, string>()
  for (const tag of rels.match(/<Relationship\b[^>]*\/?>/g) ?? []) {
    const id = tag.match(/\sId="([^"]*)"/)
    const target = tag.match(/\sTarget="([^"]*)"/)
    if (id && target) destinos.set(id[1], rutaDeDestino(target[1]))
  }

  const hojas: Hoja[] = []
  for (const tag of wb.match(/<(?:\w+:)?sheet\b[^>]*\/?>/g) ?? []) {
    const nombre = tag.match(/\sname="([^"]*)"/)
    if (!nombre) continue
    const rid = tag.match(/\sr:id="([^"]*)"/) ?? tag.match(/\sid="([^"]*)"/)
    hojas.push({
      // El atributo viene escapado: una hoja «A&B» aparece como «A&amp;B» y
      // compararla sin desescapar no casaría nunca.
      nombre: unescapeXml(nombre[1]),
      ruta: (rid && destinos.get(rid[1])) || '',
    })
  }
  return hojas
}

/**
 * La hoja cuyo nombre EMPIEZA por un prefijo, sin acentos ni mayúsculas.
 *
 * Por prefijo porque Excel trunca los nombres largos: la hoja de embalaje se
 * llama literalmente «Información de embalaje de la c». Y sin acentos porque el
 * nombre viene traducido al idioma del Seller Central del que se descargó.
 */
export function buscarHoja(paquete: Paquete, prefijos: string[]): Hoja | null {
  const normal = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
  const hojas = hojasDe(paquete)
  for (const p of prefijos) {
    const encontrada = hojas.find((h) => normal(h.nombre).startsWith(normal(p)))
    if (encontrada?.ruta && paquete[encontrada.ruta]) return encontrada
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Leer                                                                */
/* ------------------------------------------------------------------ */

/** Las cadenas compartidas, si el libro las usa. Puede no haberlas */
export function cadenasCompartidas(paquete: Paquete): string[] {
  const xml = decode(paquete['xl/sharedStrings.xml'])
  if (!xml) return []
  return (xml.match(/<si>[\s\S]*?<\/si>/g) ?? []).map((si) =>
    unescapeXml(
      (si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? [])
        .map((t) => t.replace(/<[^>]+>/g, ''))
        .join('')
    )
  )
}

/** El texto de una celda, venga como cadena compartida, inline o número */
export function leerCelda(hojaXml: string, ref: string, compartidas: string[]): string {
  const m = hojaXml.match(
    new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>([\\s\\S]*?)</c>)`)
  )
  if (!m) return ''
  const attrs = m[1] ?? ''
  const cuerpo = m[2] ?? ''
  const tipo = attrs.match(/\st="(\w+)"/)?.[1]

  if (tipo === 'inlineStr') {
    return unescapeXml(
      (cuerpo.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? [])
        .map((t) => t.replace(/<[^>]+>/g, ''))
        .join('')
    )
  }
  const v = cuerpo.match(/<v>([\s\S]*?)<\/v>/)?.[1]
  if (v === undefined) return ''
  if (tipo === 's') {
    const i = Number(v)
    return Number.isInteger(i) && i >= 0 && i < compartidas.length ? compartidas[i] : ''
  }
  return unescapeXml(v)
}

/** El XML de una fila entera, o '' si esa fila no existe en el documento */
export function filaXml(hojaXml: string, n: number): string {
  return hojaXml.match(new RegExp(`<row[^>]*\\sr="${n}"[^>]*>[\\s\\S]*?</row>`))?.[0] ?? ''
}

/**
 * La primera fila, dentro de un rango, donde alguna de las columnas dadas diga
 * un texto. Devuelve null si no aparece: quien llama tiene que negarse, no
 * inventarse un número de fila.
 */
export function buscarFila(
  hojaXml: string,
  compartidas: string[],
  opciones: {
    columnas: string[]
    contiene: string[]
    desde?: number
    hasta?: number
    /**
     * Coincidencia EXACTA en vez de «contiene».
     *
     * Hace falta más de lo que parece. La hoja de embalaje tiene la cabecera
     * «SKU» en la fila 5, pero en la 3 pone «Total de SKU: 23 (69 unidades)»:
     * buscando por «contiene» se encuentra la 3, el bloque de referencias
     * empieza dos filas antes de donde está, y el generador cree que la hoja no
     * tiene ninguna referencia. Un rótulo que habla DE una columna no es esa
     * columna.
     */
    exacto?: boolean
  }
): number | null {
  const normal = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
  const buscados = opciones.contiene.map(normal)
  const desde = opciones.desde ?? 1
  const hasta = opciones.hasta ?? 400

  for (let n = desde; n <= hasta; n += 1) {
    for (const col of opciones.columnas) {
      const texto = normal(leerCelda(hojaXml, `${col}${n}`, compartidas)).trim()
      if (!texto) continue
      const casa = opciones.exacto
        ? buscados.some((b) => texto === b.trim())
        : buscados.some((b) => texto.includes(b))
      if (casa) return n
    }
  }
  return null
}

/* ------------------------------------------------------------------ */
/* Escribir                                                            */
/* ------------------------------------------------------------------ */

/** Lo que se puede meter en una celda */
export type Valor =
  | { tipo: 'texto'; valor: string }
  | { tipo: 'numero'; valor: number }

/**
 * ESCRIBIR UNA CELDA CONSERVANDO SU ESTILO.
 *
 * El estilo vive en el atributo `s="NN"` de la celda y apunta a xl/styles.xml.
 * Si se reescribe la celda sin él, la celda pierde el formato —bordes, fondo,
 * número de decimales— y la hoja queda con agujeros visibles. Por eso cuando la
 * celda YA EXISTE se conserva su `s`, y cuando no existe se crea sin estilo, que
 * es lo que Excel entiende por «el de por defecto».
 *
 * EL TEXTO VA SIEMPRE COMO `inlineStr` Y NUNCA COMO CADENA COMPARTIDA.
 * Meterlo en xl/sharedStrings.xml obligaría a tocar ese fichero y a recalcular
 * el `count`/`uniqueCount` de su cabecera; equivocarse ahí rompe TODAS las
 * cadenas del libro, no solo la que se añadió. Inline es local a la celda: lo
 * peor que puede pasar es que esa celda salga mal.
 *
 * Y UN SKU ES SIEMPRE TEXTO, aunque parezca un número. Muchos llevan ceros a la
 * izquierda que forman parte del código: «0050119247» y «50119247» son artículos
 * DISTINTOS. Escrito como número, Excel se come los ceros y el fichero apunta a
 * otro producto o a ninguno.
 */
export function celdaXml(ref: string, valor: Valor, estilo: string | null): string {
  const s = estilo ? ` s="${estilo}"` : ''
  if (valor.tipo === 'numero') {
    // Sin `t=`: en el formato de Excel la ausencia de tipo ES el número.
    return `<c r="${ref}"${s}><v>${valor.valor}</v></c>`
  }
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${escapeXml(valor.valor)}</t></is></c>`
}

/** El `s="NN"` que ya tenía esa celda, para no perder su formato */
export function estiloDe(hojaXml: string, ref: string): string | null {
  const m = hojaXml.match(new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>)`))
  return m?.[1]?.match(/\ss="(\d+)"/)?.[1] ?? null
}

/**
 * Mete o sustituye celdas dentro de filas que YA EXISTEN en el documento.
 *
 * Es el caso de los dos «Seller» del manifiesto y de los pesos y medidas del
 * embalaje: la fila está, la celda puede estar vacía o no, y lo que hay
 * alrededor —otras celdas de esa misma fila— no se puede tocar.
 */
export function escribirCeldas(
  hojaXml: string,
  celdas: Array<{ ref: string; valor: Valor }>
): string {
  let xml = hojaXml

  for (const { ref, valor } of celdas) {
    const fila = Number(ref.match(/\d+$/)?.[0] ?? 0)
    const col = ref.replace(/\d+$/, '')
    if (!fila) continue

    const nueva = celdaXml(ref, valor, estiloDe(xml, ref))
    const existente = new RegExp(`<c r="${ref}"(?:[^>]*?/>|[^>]*?>[\\s\\S]*?</c>)`)

    if (existente.test(xml)) {
      xml = xml.replace(existente, nueva)
      continue
    }

    // La celda no existe: hay que meterla en su sitio DENTRO de la fila. Excel
    // exige que las celdas vayan en orden de columna; una fuera de orden hace
    // que el fichero se abra «reparado» y con la fila en blanco.
    const filaActual = filaXml(xml, fila)
    if (!filaActual) continue

    const refsDeLaFila = [...filaActual.matchAll(/<c r="([A-Z]+)(\d+)"/g)].map((m) => m[1])
    const siguiente = refsDeLaFila.find((c) => colIndex(c) > colIndex(col))
    const conLaCelda = siguiente
      ? filaActual.replace(new RegExp(`<c r="${siguiente}${fila}"`), `${nueva}<c r="${siguiente}${fila}"`)
      : filaActual.replace(/<\/row>$/, `${nueva}</row>`)

    xml = xml.replace(filaActual, conLaCelda)
  }

  return xml
}

/**
 * Añade filas nuevas DETRÁS de una fila dada, tirando las que hubiera después.
 *
 * Es lo que hace falta en el manifiesto: debajo de la cabecera va una fila por
 * referencia y no hay nada más en la hoja. Las que hubiera de una carga anterior
 * se van, que es lo correcto — si no, un envío de 5 referencias sobre una
 * plantilla usada para 40 mandaría las 35 viejas también.
 */
export function reemplazarFilasTras(
  hojaXml: string,
  ultimaFilaQueSeQueda: number,
  filasNuevas: string
): string {
  const sheetData = hojaXml.match(/<sheetData>([\s\S]*?)<\/sheetData>/)
  if (!sheetData) throw new LibroError('La hoja no tiene datos: no es la plantilla esperada.')

  const filas = sheetData[1].match(/<row[^>]*>[\s\S]*?<\/row>|<row[^>]*\/>/g) ?? []
  const conservadas = filas.filter((f) => {
    const n = Number(f.match(/\sr="(\d+)"/)?.[1] ?? 0)
    return n > 0 && n <= ultimaFilaQueSeQueda
  })

  return hojaXml.replace(
    /<sheetData>[\s\S]*?<\/sheetData>/,
    `<sheetData>${conservadas.join('')}${filasNuevas}</sheetData>`
  )
}

/**
 * Pone al día el `<dimension ref>` de la hoja.
 *
 * Es el rectángulo que declara hasta dónde llegan los datos. Dejarlo corto no
 * impide que Excel abra el fichero —recalcula—, pero algunos lectores estrictos
 * se quedan solo con lo declarado, y el de Amazon es uno de los que no conviene
 * probar: leería media carga y daría el resto por no enviado.
 */
export function actualizarDimension(hojaXml: string, ultimaColumna: string, ultimaFila: number): string {
  if (!/<dimension ref="/.test(hojaXml)) return hojaXml
  return hojaXml.replace(/<dimension ref="[^"]*"/, `<dimension ref="A1:${ultimaColumna}${ultimaFila}"`)
}
