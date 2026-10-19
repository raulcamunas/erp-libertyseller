import { strToU8, zipSync } from 'fflate'
import { colLetter, escapeXml } from '../libro'

/**
 * UN ESCRITOR DE .XLSX CON ESTILO, SIN DEPENDENCIAS NUEVAS.
 * =========================================================
 * Puro: devuelve bytes, no toca el disco ni la red. Se comprueba con
 * propuesta-excel.prueba.ts, que además abre el resultado con openpyxl.
 *
 *
 * ============ POR QUÉ UNO PROPIO ============
 *
 * `xlsx` (SheetJS), que está en el proyecto, NO escribe estilos: la edición comunitaria
 * ignora rellenos, fuentes y bordes, y un Excel «con la marca» es justo eso. La otra
 * salida habitual, `exceljs`, es una dependencia más grande para dibujar una cabecera y
 * una tabla, y esta aplicación no se puede compilar entera en el portátil de desarrollo
 * (la carpeta del proyecto está en iCloud), así que una dependencia que solo se prueba
 * en el despliegue es el tipo de riesgo que no merece la pena correr.
 *
 * Un .xlsx es un ZIP con XML dentro, y `fflate` ya está en el proyecto (lo usan el
 * manifiesto y el embalaje). Lo que hace falta para un documento así es poco:
 * estilos (fuente, relleno, borde, alineación, formato de número), celdas, anchos y
 * altos, celdas combinadas, una imagen y la configuración de impresión.
 *
 *
 * ============ LO QUE NO HACE, A PROPÓSITO ============
 *
 *   · No escribe fórmulas. Todo son valores: lo que se ve es lo que hay en la celda, y
 *     así un documento que se manda a un cliente no lleva cuentas que alguien pueda
 *     romper al abrirlo.
 *   · No usa la tabla de cadenas compartidas: cada texto va en su celda como cadena
 *     «en línea». Excel lo lee igual y, al guardar, lo convierte él.
 *   · Un texto NUNCA se interpreta como fórmula: una cadena en línea que empiece por «=»
 *     es solo texto. Un nombre de producto copiado de Amazon no puede ejecutar nada.
 */

/* ------------------------------------------------------------------ */
/* Estilos                                                             */
/* ------------------------------------------------------------------ */

/** RGB en hexadecimal, sin almohadilla: «F26212» */
export type Color = string

export interface LadoBorde {
  estilo: 'thin' | 'medium' | 'thick'
  color: Color
}

export interface Estilo {
  nombre?: string
  tam?: number
  negrita?: boolean
  cursiva?: boolean
  color?: Color
  relleno?: Color
  h?: 'left' | 'center' | 'right'
  v?: 'top' | 'center' | 'bottom'
  /** Partir el texto en varias líneas dentro de la celda */
  ajustar?: boolean
  sangria?: number
  arriba?: LadoBorde
  abajo?: LadoBorde
  izquierda?: LadoBorde
  derecha?: LadoBorde
  /** Formato de número de Excel: '#,##0', '0.0%'… Sin él, «General» */
  formato?: string
}

const argb = (c: Color): string => `FF${c.replace(/^#/, '').toUpperCase()}`

/**
 * La huella de un estilo: dos estilos iguales dan la misma, escritos en el orden que se
 * escriban. NO vale `JSON.stringify(e, Object.keys(e).sort())`: una lista de claves
 * como segundo argumento filtra también los objetos de dentro, y los bordes —que son
 * `{ estilo, color }`— perderían el `estilo`. Dos bordes distintos darían la misma huella
 * y una celda saldría con el borde de otra, sin ningún error.
 */
function claveDe(e: Estilo): string {
  const ordenado = (v: unknown): unknown =>
    v !== null && typeof v === 'object'
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>)
            .filter(([, x]) => x !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, x]) => [k, ordenado(x)])
        )
      : v
  return JSON.stringify(ordenado(e))
}

/** Los formatos que Excel trae de serie: no se declaran, se citan por su número */
const FORMATOS_DE_SERIE: Record<string, number> = { General: 0, '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '0%': 9, '0.00%': 10 }

class Estilos {
  private fuentes: string[] = []
  private rellenos: string[] = []
  private bordes: string[] = []
  private formatos = new Map<string, number>()
  private xfs: string[] = []
  private indices = new Map<string, number>()

  constructor() {
    // El 0 de cada lista es el que usa una celda sin estilo. Excel exige además que
    // los dos primeros rellenos sean «ninguno» y «gris 125»: son reservados.
    this.fuentes.push('<font><sz val="11"/><color rgb="FF000000"/><name val="Calibri"/><family val="2"/></font>')
    this.rellenos.push('<fill><patternFill patternType="none"/></fill>')
    this.rellenos.push('<fill><patternFill patternType="gray125"/></fill>')
    this.bordes.push('<border><left/><right/><top/><bottom/><diagonal/></border>')
    this.xfs.push('<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>')
  }

  private unico(lista: string[], xml: string): number {
    const i = lista.indexOf(xml)
    if (i >= 0) return i
    lista.push(xml)
    return lista.length - 1
  }

  /** El número de estilo de una celda. undefined = el de serie */
  indiceDe(e: Estilo | undefined): number {
    if (!e) return 0
    const clave = claveDe(e)
    const hecho = this.indices.get(clave)
    if (hecho !== undefined) return hecho

    const fuente =
      '<font>' +
      (e.negrita ? '<b/>' : '') +
      (e.cursiva ? '<i/>' : '') +
      `<sz val="${e.tam ?? 11}"/>` +
      `<color rgb="${argb(e.color ?? '000000')}"/>` +
      `<name val="${escapeXml(e.nombre ?? 'Calibri')}"/>` +
      '<family val="2"/></font>'
    const fontId = this.unico(this.fuentes, fuente)

    const relleno = e.relleno
      ? `<fill><patternFill patternType="solid"><fgColor rgb="${argb(e.relleno)}"/><bgColor indexed="64"/></patternFill></fill>`
      : null
    const fillId = relleno ? this.unico(this.rellenos, relleno) : 0

    const lado = (nombre: string, l?: LadoBorde) => (l ? `<${nombre} style="${l.estilo}"><color rgb="${argb(l.color)}"/></${nombre}>` : `<${nombre}/>`)
    const hayBorde = e.arriba || e.abajo || e.izquierda || e.derecha
    // El orden de los lados lo fija el esquema: izquierda, derecha, arriba, abajo
    const borde = hayBorde
      ? `<border>${lado('left', e.izquierda)}${lado('right', e.derecha)}${lado('top', e.arriba)}${lado('bottom', e.abajo)}<diagonal/></border>`
      : null
    const borderId = borde ? this.unico(this.bordes, borde) : 0

    let numFmtId = 0
    if (e.formato && e.formato !== 'General') {
      const deSerie = FORMATOS_DE_SERIE[e.formato]
      if (deSerie !== undefined) numFmtId = deSerie
      else {
        if (!this.formatos.has(e.formato)) this.formatos.set(e.formato, 164 + this.formatos.size)
        numFmtId = this.formatos.get(e.formato)!
      }
    }

    const alinea =
      e.h || e.v || e.ajustar || e.sangria
        ? '<alignment' +
          (e.h ? ` horizontal="${e.h}"` : '') +
          (e.v ? ` vertical="${e.v}"` : '') +
          (e.ajustar ? ' wrapText="1"' : '') +
          (e.sangria ? ` indent="${e.sangria}"` : '') +
          '/>'
        : ''

    const xf =
      `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"` +
      (numFmtId ? ' applyNumberFormat="1"' : '') +
      ' applyFont="1"' +
      (fillId ? ' applyFill="1"' : '') +
      (borderId ? ' applyBorder="1"' : '') +
      (alinea ? ` applyAlignment="1">${alinea}</xf>` : '/>')

    this.xfs.push(xf)
    const indice = this.xfs.length - 1
    this.indices.set(clave, indice)
    return indice
  }

  xml(): string {
    const formatos =
      this.formatos.size > 0
        ? `<numFmts count="${this.formatos.size}">` +
          [...this.formatos].map(([codigo, id]) => `<numFmt numFmtId="${id}" formatCode="${escapeXml(codigo)}"/>`).join('') +
          '</numFmts>'
        : ''
    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      formatos +
      `<fonts count="${this.fuentes.length}">${this.fuentes.join('')}</fonts>` +
      `<fills count="${this.rellenos.length}">${this.rellenos.join('')}</fills>` +
      `<borders count="${this.bordes.length}">${this.bordes.join('')}</borders>` +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>'
    )
  }
}

/* ------------------------------------------------------------------ */
/* La hoja                                                             */
/* ------------------------------------------------------------------ */

/** Un trozo de un texto con formato propio: «01» en naranja y lo demás en gris, en la misma celda */
export interface Tramo {
  texto: string
  negrita?: boolean
  cursiva?: boolean
  color?: Color
  tam?: number
  nombre?: string
}

/** Lo que cabe en una celda: texto, número, vacío, o un texto con varios formatos */
export type Valor = string | number | null | Tramo[]

interface Celda {
  valor: Valor
  estilo: number
}

export interface Imagen {
  png: Uint8Array
  /** Fila y columna de la celda donde se ancla, contadas desde 1 */
  fila: number
  col: number
  /** Cuánto se separa de la esquina de esa celda, en píxeles */
  desplazamientoX?: number
  desplazamientoY?: number
  /** Tamaño con el que se ve, en píxeles */
  anchoPx: number
  altoPx: number
  descripcion: string
}

/** Un píxel son 9.525 EMU, la unidad en la que dibuja Excel */
const EMU_POR_PX = 9525

/** Los nombres de hoja no admiten : \ / ? * [ ] y miden 31 como mucho */
function nombreDeHoja(texto: string): string {
  const limpio = texto.replace(/[:\\/?*[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31)
  return limpio || 'Hoja'
}

export class Hoja {
  readonly nombre: string
  private celdas = new Map<number, Map<number, Celda>>()
  private anchos = new Map<number, number>()
  private altos = new Map<number, number>()
  private combinadas: string[] = []
  imagen: Imagen | null = null
  colorPestana: Color | null = null
  /** Impresión: ajustar a una página de ancho, y las que hagan falta de alto */
  ajustarAlAncho = true
  vertical = true

  constructor(
    nombre: string,
    private estilos: Estilos
  ) {
    this.nombre = nombreDeHoja(nombre)
  }

  /** Escribe una celda. Un estilo sin valor también cuenta: es como se pinta un fondo */
  poner(fila: number, col: number, valor: Valor, estilo?: Estilo): void {
    const f = this.celdas.get(fila) ?? new Map<number, Celda>()
    f.set(col, { valor, estilo: this.estilos.indiceDe(estilo) })
    this.celdas.set(fila, f)
  }

  /** Da el mismo estilo a una fila de celdas, de la columna `desde` a la `hasta`, sin tocar lo que ya llevan */
  pintar(fila: number, desde: number, hasta: number, estilo: Estilo): void {
    for (let c = desde; c <= hasta; c += 1) {
      const existente = this.celdas.get(fila)?.get(c)
      this.poner(fila, c, existente?.valor ?? null, estilo)
    }
  }

  anchoColumna(col: number, ancho: number): void {
    this.anchos.set(col, ancho)
  }

  altoFila(fila: number, alto: number): void {
    this.altos.set(fila, alto)
  }

  combinar(fila1: number, col1: number, fila2: number, col2: number): void {
    if (fila1 === fila2 && col1 === col2) return
    this.combinadas.push(`${colLetter(col1)}${fila1}:${colLetter(col2)}${fila2}`)
  }

  /** La última fila y columna con algo escrito */
  private limites(): { filas: number; cols: number } {
    let filas = 1
    let cols = 1
    for (const [f, fila] of this.celdas) {
      filas = Math.max(filas, f)
      for (const c of fila.keys()) cols = Math.max(cols, c)
    }
    for (const f of this.altos.keys()) filas = Math.max(filas, f)
    for (const c of this.anchos.keys()) cols = Math.max(cols, c)
    return { filas, cols }
  }

  /** @internal */
  xml(tieneDibujo: boolean, seleccionada: boolean): string {
    const { filas, cols } = this.limites()

    const columnas = [...this.anchos]
      .sort((a, b) => a[0] - b[0])
      .map(([c, w]) => `<col min="${c}" max="${c}" width="${w}" customWidth="1"/>`)
      .join('')

    const numeros = new Set<number>([...this.celdas.keys(), ...this.altos.keys()])
    const filasXml = [...numeros]
      .sort((a, b) => a - b)
      .map((f) => {
        const alto = this.altos.get(f)
        const celdas = [...(this.celdas.get(f) ?? new Map<number, Celda>())]
          .sort((a, b) => a[0] - b[0])
          .map(([c, celda]) => {
            const ref = `${colLetter(c)}${f}`
            const s = celda.estilo ? ` s="${celda.estilo}"` : ''
            if (celda.valor === null || celda.valor === '') return `<c r="${ref}"${s}/>`
            if (Array.isArray(celda.valor)) {
              // Texto con formatos: cada trozo lleva su propio <rPr>. Un trozo sin formato no lo necesita
              const trozos = celda.valor
                .map((t) => {
                  const rpr =
                    (t.negrita ? '<b/>' : '') +
                    (t.cursiva ? '<i/>' : '') +
                    (t.tam ? `<sz val="${t.tam}"/>` : '') +
                    (t.color ? `<color rgb="${argb(t.color)}"/>` : '') +
                    (t.nombre ? `<rFont val="${escapeXml(t.nombre)}"/>` : '')
                  return `<r>${rpr ? `<rPr>${rpr}</rPr>` : ''}<t xml:space="preserve">${escapeXml(t.texto.slice(0, 32000))}</t></r>`
                })
                .join('')
              return `<c r="${ref}"${s} t="inlineStr"><is>${trozos}</is></c>`
            }
            if (typeof celda.valor === 'number') {
              // Un número que no es finito no se puede escribir: Excel rechazaría el fichero entero
              return Number.isFinite(celda.valor) ? `<c r="${ref}"${s}><v>${celda.valor}</v></c>` : `<c r="${ref}"${s}/>`
            }
            // Excel admite 32.767 caracteres por celda
            const texto = escapeXml(celda.valor.slice(0, 32000))
            return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${texto}</t></is></c>`
          })
          .join('')
        return `<row r="${f}"${alto ? ` ht="${alto}" customHeight="1"` : ''}>${celdas}</row>`
      })
      .join('')

    return (
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheetPr>' +
      (this.colorPestana ? `<tabColor rgb="${argb(this.colorPestana)}"/>` : '') +
      (this.ajustarAlAncho ? '<pageSetUpPr fitToPage="1"/>' : '') +
      '</sheetPr>' +
      `<dimension ref="A1:${colLetter(cols)}${filas}"/>` +
      `<sheetViews><sheetView showGridLines="0"${seleccionada ? ' tabSelected="1"' : ''} workbookViewId="0"><selection activeCell="A1" sqref="A1"/></sheetView></sheetViews>` +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      (columnas ? `<cols>${columnas}</cols>` : '') +
      `<sheetData>${filasXml}</sheetData>` +
      (this.combinadas.length > 0 ? `<mergeCells count="${this.combinadas.length}">${this.combinadas.map((r) => `<mergeCell ref="${r}"/>`).join('')}</mergeCells>` : '') +
      '<printOptions horizontalCentered="1"/>' +
      '<pageMargins left="0.4" right="0.4" top="0.4" bottom="0.5" header="0.3" footer="0.3"/>' +
      `<pageSetup paperSize="9" orientation="${this.vertical ? 'portrait' : 'landscape'}"${this.ajustarAlAncho ? ' fitToWidth="1" fitToHeight="0"' : ''}/>` +
      (tieneDibujo ? '<drawing r:id="rId1"/>' : '') +
      '</worksheet>'
    )
  }
}

/* ------------------------------------------------------------------ */
/* El libro                                                            */
/* ------------------------------------------------------------------ */

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const NS_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const TIPO_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

export class Libro {
  readonly estilos = new Estilos()
  private hojas: Hoja[] = []
  titulo = ''
  autor = 'Liberty Seller'
  /** ISO. Fijarlo da el mismo fichero byte a byte: las pruebas lo agradecen */
  creado = new Date().toISOString()

  hoja(nombre: string): Hoja {
    const h = new Hoja(nombre, this.estilos)
    this.hojas.push(h)
    return h
  }

  /** El .xlsx entero, listo para devolver o guardar */
  empaquetar(): Uint8Array {
    if (this.hojas.length === 0) throw new Error('Un libro necesita al menos una hoja')

    const ficheros: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {}
    const poner = (ruta: string, xml: string) => {
      ficheros[ruta] = strToU8(xml)
    }

    const conDibujo = this.hojas.map((h) => h.imagen !== null)

    poner(
      '[Content_Types].xml',
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
        this.hojas
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
              (conDibujo[i] ? `<Override PartName="/xl/drawings/drawing${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` : '')
          )
          .join('') +
        '</Types>'
    )

    poner(
      '_rels/.rels',
      `${XML}<Relationships xmlns="${NS_REL}">` +
        `<Relationship Id="rId1" Type="${TIPO_REL}/officeDocument" Target="xl/workbook.xml"/>` +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '</Relationships>'
    )

    poner(
      'docProps/core.xml',
      `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
        `<dc:title>${escapeXml(this.titulo)}</dc:title>` +
        `<dc:creator>${escapeXml(this.autor)}</dc:creator>` +
        `<dcterms:created xsi:type="dcterms:W3CDTF">${escapeXml(this.creado)}</dcterms:created>` +
        '</cp:coreProperties>'
    )

    poner(
      'xl/workbook.xml',
      `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${TIPO_REL}">` +
        '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="17000"/></bookViews>' +
        `<sheets>${this.hojas.map((h, i) => `<sheet name="${escapeXml(h.nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>` +
        '</workbook>'
    )

    poner(
      'xl/_rels/workbook.xml.rels',
      `${XML}<Relationships xmlns="${NS_REL}">` +
        this.hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${TIPO_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${this.hojas.length + 1}" Type="${TIPO_REL}/styles" Target="styles.xml"/>` +
        '</Relationships>'
    )

    this.hojas.forEach((hoja, i) => {
      const n = i + 1
      poner(`xl/worksheets/sheet${n}.xml`, hoja.xml(conDibujo[i], i === 0))

      const img = hoja.imagen
      if (!img) return
      poner(
        `xl/worksheets/_rels/sheet${n}.xml.rels`,
        `${XML}<Relationships xmlns="${NS_REL}"><Relationship Id="rId1" Type="${TIPO_REL}/drawing" Target="../drawings/drawing${n}.xml"/></Relationships>`
      )
      poner(
        `xl/drawings/_rels/drawing${n}.xml.rels`,
        `${XML}<Relationships xmlns="${NS_REL}"><Relationship Id="rId1" Type="${TIPO_REL}/image" Target="../media/image${n}.png"/></Relationships>`
      )
      const cx = Math.round(img.anchoPx * EMU_POR_PX)
      const cy = Math.round(img.altoPx * EMU_POR_PX)
      poner(
        `xl/drawings/drawing${n}.xml`,
        `${XML}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
          '<xdr:oneCellAnchor>' +
          `<xdr:from><xdr:col>${img.col - 1}</xdr:col><xdr:colOff>${Math.round((img.desplazamientoX ?? 0) * EMU_POR_PX)}</xdr:colOff><xdr:row>${img.fila - 1}</xdr:row><xdr:rowOff>${Math.round((img.desplazamientoY ?? 0) * EMU_POR_PX)}</xdr:rowOff></xdr:from>` +
          `<xdr:ext cx="${cx}" cy="${cy}"/>` +
          '<xdr:pic>' +
          `<xdr:nvPicPr><xdr:cNvPr id="2" name="Logo" descr="${escapeXml(img.descripcion)}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>` +
          `<xdr:blipFill><a:blip xmlns:r="${TIPO_REL}" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
          `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>` +
          '</xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>'
      )
      // El PNG ya viene comprimido: volver a comprimirlo solo gasta tiempo
      ficheros[`xl/media/image${n}.png`] = [img.png, { level: 0 }]
    })

    poner('xl/styles.xml', this.estilos.xml())

    return zipSync(ficheros as Parameters<typeof zipSync>[0], { level: 6 })
  }
}
