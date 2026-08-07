/**
 * EL LECTOR CONFIGURABLE.
 *
 * Lo que cambia de un cliente a otro es el FICHERO y CÓMO SE INTERPRETA. El
 * destino es siempre idéntico —Amazon quiere SKU, precio y cantidad—, así que
 * toda la variabilidad del mundo cabe en esta pieza. Aquí abajo no hay ni una
 * sola constante de ningún cliente: la hoja, las columnas y sus nombres
 * alternativos llegan en el perfil.
 *
 * LO QUE ESTE FICHERO NO HACE, Y ES LO IMPORTANTE: no toca el cruce. Devuelve
 * exactamente las mismas StockLine que produce hoy parseStockWorkbook() en
 * engine.ts, así que crossStock() no se entera de que existe. El cruce está
 * probado contra datos reales (395 filas, 7.877 unidades) y es el activo más
 * valioso del módulo; la forma de no romperlo es no tocarlo.
 *
 * PERFIL_SHOPLAMP_STOCK y PERFIL_SHOPLAMP_EAN son la reproducción exacta de lo
 * que hoy está grabado en engine.ts. Sirven para dos cosas: para que el primer
 * cliente no sea un caso especial, y como prueba de que el modelo de perfil da
 * de sí. scripts/check-lector-stock.ts comprueba con los ficheros reales que
 * leer por perfil y leer por el código de siempre dan LO MISMO, línea a línea.
 *
 * Por qué el lector va por NOMBRE de columna y nunca por posición: el día que
 * el cliente añade una columna a su exportación, ir por posición escribe el
 * stock de un artículo en el precio de otro SIN DAR NINGÚN ERROR. Ir por
 * nombre falla ruidosamente y con un mensaje que dice qué falta, que es lo que
 * se quiere.
 */

import * as XLSX from 'xlsx'
import {
  StockSyncError,
  type EanIndex,
  type StockLine,
  type WorkbookInput,
  findColumn,
  normalizeHeader,
  parseUnits,
  plainText,
  readWorkbook,
  sanitizeUnits,
} from './engine'
import {
  type StockReadProfile,
  exactCode,
  normalizeCode,
  normalizeEan,
} from '@/lib/types/stock-sync'

// =====================================================
// El perfil, tal y como lo ve el lector
// =====================================================

/**
 * Los campos que un fichero puede traer. Cada uno es una LISTA de nombres
 * aceptados, en orden de preferencia; se comparan sin tildes, sin mayúsculas y
 * sin puntuación (normalizeHeader), así que «Artículo», «ARTICULO» y
 * «Cód.Artículo» ya casan solas y la lista es para los nombres realmente
 * distintos: «St. Real» y «Stock disponible».
 */
export interface ColumnasPerfil {
  /** OBLIGATORIA siempre: el código del artículo en el ERP del cliente */
  referencia: string[]
  /** OBLIGATORIA en los perfiles de stock */
  stock?: string[]
  /** Precio ya listo para publicar */
  precio?: string[]
  /** Se mira SOLO si la de precio viene vacía en esa fila */
  precioRespaldo?: string[]
  /** Coste; solo hace falta cuando el precio se calcula por margen */
  coste?: string[]
  /** OBLIGATORIA en los perfiles de EAN */
  ean?: string[]
  descripcion?: string[]
  /** Familia o categoría: hace falta para poder excluir familias enteras */
  familia?: string[]
  /** Solo en ficheros de EAN que mezclan tipos de código */
  tipo?: string[]
}

export type TipoPerfil = 'stock' | 'ean'

export interface PerfilLectura {
  /** Para los mensajes de error: es lo primero que va a leer quien dé de alta un cliente */
  nombre: string
  tipo: TipoPerfil
  /** Hoja por NOMBRE. Es lo preferido: sobrevive a que el cliente reordene el libro */
  hoja?: string | null
  /** Hoja por POSICIÓN, empezando en 1. Último recurso; si hay nombre, manda el nombre */
  hojaIndice?: number | null
  /** Fila de la cabecera, empezando en 1. Vacío = búscala sola en las primeras 20 */
  filaCabecera?: number | null
  /** Primera fila de datos, empezando en 1. Vacío = la siguiente a la cabecera */
  filaDatos?: number | null
  columnas: ColumnasPerfil
  /**
   * En un fichero de EAN que mezcla EAN-13 con códigos internos, el valor de la
   * columna «Tipo» que marca los buenos. Vacío = acepta todo lo que parezca un
   * código de barras.
   */
  eanSoloTipo?: number | null
  /** Solo para CSV. Vacíos = se abre igual que siempre (utf-8, separador automático) */
  csvSeparador?: string | null
  csvCodificacion?: string | null
}

// =====================================================
// Lo que devuelve
// =====================================================

/**
 * Una línea del fichero del cliente.
 *
 * Extiende StockLine SIN cambiarla: los cuatro campos de siempre están
 * intactos y en la misma forma, así que un LineaLeida[] se le pasa a
 * crossStock() tal cual. Los campos nuevos (precio, coste, ean, familia) viajan
 * de acompañantes y el cruce los ignora, que es exactamente lo que se busca:
 * el precio se vuelve a juntar con su SKU DESPUÉS de cruzar, por el campo
 * `articulo`, sin que crossStock tenga que aprender nada nuevo.
 */
export interface LineaLeida extends StockLine {
  /** Precio de venta leído del fichero, sin redondear. null = no venía o no se pudo leer */
  precio: number | null
  /** Precio de respaldo de esa misma fila; solo se usa si `precio` es null */
  precioRespaldo: number | null
  /** Coste, para calcular el precio por margen */
  coste: number | null
  /** EAN normalizado si el fichero de stock lo trae; '' si no */
  ean: string
  /** Familia o categoría tal cual viene, para las exclusiones */
  familia: string
  /** Fila del fichero como la ve Excel (1-based), para poder señalarla en un aviso */
  fila: number
}

/** Qué columna acabó usándose para cada campo. -1 = el fichero no la traía */
export type IndiceColumnas = Record<keyof ColumnasPerfil, number>

export interface LecturaStock {
  perfil: string
  /** Hoja de la que se leyó, para que conste en el registro de la ejecución */
  hoja: string
  /** Fila de la cabecera, 1-based */
  filaCabecera: number
  cabeceras: string[]
  columnas: IndiceColumnas
  lineas: LineaLeida[]
  /** Filas descartadas por no traer código de artículo (pies de página, totales) */
  filasSinCodigo: number
  /** En español y sin bloquear: cosas que conviene mirar pero no impiden seguir */
  avisos: string[]
}

export interface LecturaEan {
  perfil: string
  hoja: string
  filaCabecera: number
  cabeceras: string[]
  columnas: IndiceColumnas
  indice: EanIndex
  /** Artículos distintos indexados y códigos de barras en total */
  articulos: number
  codigos: number
  avisos: string[]
}

// =====================================================
// Perfiles de fábrica: lo que hoy está grabado en engine.ts
// =====================================================

/**
 * El volcado de stock de Shoplamp, exactamente como lo lee hoy
 * parseStockWorkbook() (engine.ts:337). Mismos alias, mismo orden, misma hoja.
 *
 * No es documentación: es el perfil que usa el código, y
 * scripts/check-lector-stock.ts comprueba con el fichero real de 21.115 líneas
 * que leer por aquí da byte a byte lo mismo que leer por el camino de siempre.
 */
export const PERFIL_SHOPLAMP_STOCK: PerfilLectura = {
  nombre: 'Shoplamp — volcado de stock',
  tipo: 'stock',
  hoja: 'Browser',
  columnas: {
    referencia: ['Articulo', 'Cod.Articulo', 'Codigo articulo'],
    stock: ['St. Real', 'St.Real', 'Stock real', 'Stock'],
    descripcion: ['Descrip.Propia', 'Descripcion', 'Descripcion propia'],
  },
}

/**
 * El fichero de códigos de barras de Shoplamp, como lo lee hoy
 * parseEanWorkbook() (engine.ts:402), incluido el «solo Tipo 1».
 *
 * El Tipo importa: el fichero mezcla EAN-13 (Tipo 1) con códigos internos del
 * ERP («0004000342.PZ»), y esos no identifican el producto fuera de casa del
 * cliente. Si se colaran, dos artículos distintos podrían casar por un código
 * interno parecido y el stock acabaría en el listing equivocado.
 */
export const PERFIL_SHOPLAMP_EAN: PerfilLectura = {
  nombre: 'Shoplamp — códigos de barras',
  tipo: 'ean',
  hoja: 'Browser',
  columnas: {
    referencia: ['Cod.Articulo', 'Codigo articulo', 'Articulo'],
    ean: ['Codigo de Barras', 'Codigo barras', 'EAN'],
    tipo: ['Tipo'],
  },
  eanSoloTipo: 1,
}

// =====================================================
// Lectura
// =====================================================

/** Cabecera plausible en las primeras filas; más abajo ya son datos */
const FILAS_BUSCANDO_CABECERA = 20

/** Cuántas cabeceras se enumeran en un mensaje de error antes de cortar */
const MAX_CABECERAS_EN_ERROR = 60

/**
 * Etiqueta de cada campo en castellano llano. Es lo que aparece en el mensaje
 * de error, así que se escribe pensando en quien está dando de alta un cliente
 * nuevo con el fichero delante, no en quien programó esto.
 */
const ETIQUETA_CAMPO: Record<keyof ColumnasPerfil, string> = {
  referencia: 'la referencia del artículo',
  stock: 'las unidades en stock',
  precio: 'el precio',
  precioRespaldo: 'el precio de respaldo',
  coste: 'el coste',
  ean: 'el código de barras',
  descripcion: 'la descripción',
  familia: 'la familia',
  tipo: 'el tipo de código',
}

/**
 * ORDEN EN QUE SE RESUELVEN LAS COLUMNAS, Y ES SIGNIFICATIVO.
 *
 * Se resuelven de arriba abajo con exclusión mutua: una columna que ya se ha
 * llevado un campo no se la puede llevar otro. Sin eso, dos campos distintos
 * pueden acabar leyendo la misma columna del fichero y nadie se entera —el
 * proceso no falla, simplemente publica el coste como si fuera el precio—.
 * Es la misma protección que usa la importación de mapeos.
 *
 * Los campos con alias más específicos van primero; los que suelen llevar
 * nombres cortos y genéricos («Stock», «EAN»), después.
 */
const ORDEN_CAMPOS: (keyof ColumnasPerfil)[] = [
  'referencia',
  'ean',
  'stock',
  'coste',
  'precio',
  'precioRespaldo',
  'descripcion',
  'familia',
  'tipo',
]

/** Una hoja ya troceada en cabecera y datos, candidata a ser la buena */
interface Candidata {
  hoja: string
  /** 1-based, como la ve Excel */
  filaCabecera: number
  cabeceras: string[]
  filas: unknown[][]
  /** Fila del fichero (1-based) de la primera de `filas` */
  primeraFilaDatos: number
}

/** El resultado de buscar hojas, con lo que haya que contarle a quien mira */
interface Candidatas {
  lista: Candidata[]
  /** Aviso cuando el perfil pide una hoja que el fichero no tiene */
  avisos: string[]
}

/**
 * Una fila sin NADA en ninguna celda.
 *
 * Hace falta porque la rejilla se lee conservando las filas en blanco (ver
 * candidatas()): sin esto, la fila de separación que muchos ERP meten entre la
 * cabecera y los datos se contaría como «fila sin código de artículo» y el
 * contador que sirve para detectar un fichero raro empezaría a mentir.
 */
function filaVacia(fila: unknown[] | undefined): boolean {
  if (!fila) return true
  return fila.every((celda) => celda === null || celda === undefined || String(celda).trim() === '')
}

/**
 * Abre el libro. Por el camino de siempre salvo que el perfil pida algo
 * concreto de CSV.
 *
 * Que el caso normal pase por readWorkbook() de engine.ts no es pereza: es lo
 * que garantiza que un mismo Excel se lea igual entre por donde entre. Un
 * fichero que se interpretara distinto según el camino daría diferencias que
 * no se ven hasta que un cliente publica el stock de otro artículo.
 */
function abrirLibro(input: WorkbookInput, perfil: PerfilLectura): XLSX.WorkBook {
  const separador = perfil.csvSeparador?.trim()
  const codepage = codepageDe(perfil.csvCodificacion)

  if (!separador && codepage === null) return readWorkbook(input)

  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.length === 0) throw new StockSyncError('El fichero está vacío')

  try {
    return XLSX.read(bytes, {
      type: 'array',
      cellDates: false,
      codepage: codepage ?? 65001,
      // Lo mismo que readWorkbook(), y por lo mismo: sin raw:true la librería
      // interpreta las celdas del CSV con criterio anglosajón y «24,90» llega
      // aquí como 2490. Ver el comentario largo en engine.ts.
      raw: true,
      ...(separador ? { FS: separador } : {}),
    })
  } catch (error) {
    const detalle = error instanceof Error ? error.message : 'formato no reconocido'
    throw new StockSyncError(
      `No se ha podido leer el fichero (${detalle}). Tiene que ser un .xlsx, .xls o .csv`
    )
  }
}

/**
 * De un nombre de codificación al número que entiende la librería, o null si
 * no hace falta tocarlo.
 *
 * Solo las tres que aparecen de verdad: utf-8 es lo normal, latin1 es lo que
 * sale de los ERP viejos españoles y windows-1252 lo que escribe Excel cuando
 * se guarda un CSV en Windows.
 */
function codepageDe(nombre: string | null | undefined): number | null {
  const v = (nombre ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!v) return null
  if (v === 'utf8' || v === 'utf') return 65001
  if (v === 'latin1' || v === 'iso88591' || v === 'iso885915') return 28591
  if (v === 'windows1252' || v === 'cp1252' || v === 'win1252') return 1252
  throw new StockSyncError(
    `La codificación «${nombre}» del perfil no se reconoce. Vale utf-8, latin1 o windows-1252.`
  )
}

/**
 * Las hojas que hay que probar, en orden, ya troceadas en cabecera y datos.
 *
 * La hoja del perfil va primero y el resto del libro después, no en su lugar:
 * el fichero de siempre se lee por el camino rápido y uno exportado desde otra
 * pantalla aún tiene oportunidad de reconocerse por sus columnas. Es lo mismo
 * que hace readTable() y por la misma razón.
 */
function candidatas(libro: XLSX.WorkBook, perfil: PerfilLectura): Candidatas {
  if (libro.SheetNames.length === 0) {
    throw new StockSyncError('El fichero no tiene ninguna hoja con datos')
  }

  const avisos: string[] = []

  const preferidas: string[] = []
  if (perfil.hoja) {
    const buscada = normalizeHeader(perfil.hoja)
    preferidas.push(...libro.SheetNames.filter((n) => normalizeHeader(n) === buscada))
    // LA HOJA PEDIDA NO EXISTE, Y ESO NO PUEDE PASAR EN SILENCIO. Sin este
    // aviso se cae al orden del libro y se lee OTRA hoja con otros números: en
    // un fichero con una hoja de resumen delante de la de detalle —el caso
    // normal de un volcado de ERP— eso publica en Amazon los números de la hoja
    // equivocada sin dar ningún error. Se avisa y se sigue, porque reconocer la
    // hoja por sus columnas sigue siendo mejor que no leer nada.
    if (preferidas.length === 0) {
      avisos.push(
        `El perfil pide la hoja «${perfil.hoja}» y el fichero no la tiene. ` +
          `Sus hojas son: ${libro.SheetNames.join(', ')}. ` +
          'Se ha leído la primera cuyas columnas encajan: comprueba que es la que querías.'
      )
    }
  }
  if (preferidas.length === 0 && perfil.hojaIndice && perfil.hojaIndice >= 1) {
    const porPosicion = libro.SheetNames[perfil.hojaIndice - 1]
    if (porPosicion) preferidas.push(porPosicion)
  }
  const orden = [...preferidas, ...libro.SheetNames.filter((n) => !preferidas.includes(n))]

  const out: Candidata[] = []

  for (const nombre of orden) {
    const hoja = libro.Sheets[nombre]
    if (!hoja) continue

    /**
     * LA REJILLA CONSERVA LAS FILAS EN BLANCO, Y ESO ES LO QUE HACE QUE
     * `fila_cabecera` Y `fila_datos` SIGNIFIQUEN LO QUE DICEN.
     *
     * Los dos campos son la fila TAL Y COMO LA VE EXCEL, que es lo único que
     * puede teclear quien tiene el fichero del cliente abierto delante. Con las
     * filas en blanco descartadas, la posición en el array dejaba de ser la
     * fila del fichero en cuanto había una sola línea vacía por encima: un
     * perfil con fila_datos=3 sobre un fichero con una fila de separación se
     * saltaba el primer artículo SIN dar error, sin aviso y sin contarlo — el
     * listing de ese artículo se quedaba con el stock del envío anterior para
     * siempre.
     *
     * `origen` es la primera fila del rango usado de la hoja: una hoja cuyo
     * contenido empieza en la fila 5 no empieza a numerar en la 1.
     */
    const rango = hoja['!ref'] ? XLSX.utils.decode_range(hoja['!ref']) : null
    const origen = rango ? rango.s.r : 0

    const rejilla = XLSX.utils.sheet_to_json<unknown[]>(hoja, {
      header: 1,
      defval: null,
      blankrows: true,
      raw: true,
    })
    if (rejilla.length === 0) continue

    const texto = (fila: unknown[] | undefined): string[] =>
      (fila ?? []).map((celda) => (celda === null || celda === undefined ? '' : String(celda).trim()))

    /** De fila de Excel (1-based) a posición en la rejilla */
    const posicionDe = (filaExcel: number): number => filaExcel - 1 - origen
    /** Y al revés, que es lo que se le enseña a una persona */
    const filaExcelDe = (posicion: number): number => posicion + origen + 1

    // Cabecera fijada en el perfil: se usa esa y no se busca. Si el cliente
    // manda un fichero con dos filas de título en vez de una, es mejor que
    // falle diciendo qué columnas ha encontrado que ponerse a adivinar.
    if (perfil.filaCabecera && perfil.filaCabecera >= 1) {
      const indice = posicionDe(perfil.filaCabecera)
      if (indice < 0 || indice >= rejilla.length) continue
      const cabeceras = texto(rejilla[indice])
      const desde = Math.max(
        perfil.filaDatos ? posicionDe(perfil.filaDatos) : indice + 1,
        indice + 1
      )
      out.push({
        hoja: nombre,
        filaCabecera: perfil.filaCabecera,
        cabeceras,
        filas: rejilla.slice(desde),
        primeraFilaDatos: filaExcelDe(desde),
      })
      continue
    }

    // Sin fila fijada: la primera de las 20 primeras que tenga al menos dos
    // celdas con algo. Los Excel de trabajo llevan a menudo un título o una
    // fila en blanco delante, y asumir la 1 los deja sin leer.
    const limite = Math.min(rejilla.length, FILAS_BUSCANDO_CABECERA)
    for (let i = 0; i < limite; i++) {
      const cabeceras = texto(rejilla[i])
      if (cabeceras.filter(Boolean).length < 2) continue
      const desde = Math.max(perfil.filaDatos ? posicionDe(perfil.filaDatos) : i + 1, i + 1)
      out.push({
        hoja: nombre,
        filaCabecera: filaExcelDe(i),
        cabeceras,
        filas: rejilla.slice(desde),
        primeraFilaDatos: filaExcelDe(desde),
      })
      break
    }
  }

  if (out.length === 0) throw new StockSyncError('El fichero no tiene ninguna fila con datos')
  return { lista: out, avisos }
}

/** A qué columna del fichero corresponde cada campo del perfil, o -1 */
function resolverColumnas(cabeceras: string[], columnas: ColumnasPerfil): IndiceColumnas {
  return resolverColumnasDetalle(cabeceras, columnas).indice
}

/**
 * Lo mismo, diciendo además CÓMO se encontró cada columna.
 *
 * findColumn() prueba primero la coincidencia exacta y después «empieza por».
 * Ese último recurso es útil —resuelve «Stock disponible» con el alias
 * «Stock»— y a la vez es la forma más silenciosa que tiene este módulo de leer
 * la columna equivocada: en un fichero con «FBA/FBM Stock» (las unidades) y
 * «Stock value» (un importe en euros), el alias «Stock» se lleva la segunda,
 * devuelve el catálogo entero a cero y no da ni un error.
 *
 * No se puede prohibir el prefijo sin romper perfiles legítimos, y aquí no hay
 * forma de saber cuál de las dos quería el cliente. Lo que sí se puede es
 * DECIRLO: quien está dando de alta el cliente tiene el fichero delante y lo
 * resuelve en diez segundos, si se le enseña.
 */
function resolverColumnasDetalle(
  cabeceras: string[],
  columnas: ColumnasPerfil
): { indice: IndiceColumnas; porPrefijo: (keyof ColumnasPerfil)[] } {
  const indice = {} as IndiceColumnas
  const ocupadas = new Set<number>()
  const porPrefijo: (keyof ColumnasPerfil)[] = []

  for (const campo of ORDEN_CAMPOS) {
    const alias = columnas[campo] ?? []
    const encontrada = alias.length === 0 ? -1 : findColumn(cabeceras, [...alias], ocupadas)
    indice[campo] = encontrada
    if (encontrada !== -1) {
      ocupadas.add(encontrada)
      const real = normalizeHeader(cabeceras[encontrada])
      if (!alias.some((a) => normalizeHeader(a) === real)) porPrefijo.push(campo)
    }
  }

  return { indice, porPrefijo }
}

/** La frase que se le enseña a una persona cuando una columna casó por prefijo */
function avisoPorPrefijo(
  campo: keyof ColumnasPerfil,
  cabeceras: string[],
  indice: number,
  alias: string[]
): string {
  return (
    `Para ${ETIQUETA_CAMPO[campo]} se ha usado la columna «${cabeceras[indice]}», ` +
    `que NO es ninguno de los nombres apuntados en el perfil ` +
    `(${alias.map((a) => `«${a}»`).join(', ')}) sino una que empieza igual. ` +
    'Compruébalo: si el fichero trae otra columna parecida, se puede estar leyendo la que no es.'
  )
}

/**
 * EL MENSAJE DE ERROR, que es media funcionalidad de este fichero.
 *
 * Lo va a leer alguien dando de alta a un cliente nuevo, con el Excel del
 * cliente abierto al lado, y es la diferencia entre resolverlo en un minuto o
 * ponerse a abrir hojas a mano. Por eso dice las tres cosas: QUÉ columna falta,
 * QUÉ nombres se han buscado y QUÉ columnas trae de verdad el fichero.
 */
function errorColumnas(
  perfil: PerfilLectura,
  candidata: Candidata,
  faltan: (keyof ColumnasPerfil)[],
  avisosHoja: string[] = []
): StockSyncError {
  const detalle = faltan
    .map((campo) => {
      const alias = perfil.columnas[campo] ?? []
      const buscados = alias.length
        ? alias.map((a) => `«${a}»`).join(', ')
        : '(el perfil no tiene ningún nombre apuntado para esta columna)'
      return `  · Falta ${ETIQUETA_CAMPO[campo]}. Nombres buscados: ${buscados}`
    })
    .join('\n')

  const presentes = candidata.cabeceras.filter(Boolean)
  const listadas = presentes.slice(0, MAX_CABECERAS_EN_ERROR).join(', ')
  const resto =
    presentes.length > MAX_CABECERAS_EN_ERROR
      ? ` (y ${presentes.length - MAX_CABECERAS_EN_ERROR} más)`
      : ''

  return new StockSyncError(
    `El fichero no encaja con el perfil «${perfil.nombre}».\n` +
      `${detalle}\n` +
      // Si además la hoja que pedía el perfil no existía, esa es casi siempre
      // LA causa y tiene que salir en el mismo mensaje: sin ella se lee un
      // error sobre las columnas de una hoja que ni se había pedido.
      (avisosHoja.length > 0 ? `${avisosHoja.join('\n')}\n` : '') +
      `Las columnas de la hoja «${candidata.hoja}» (cabecera en la fila ${candidata.filaCabecera}) son: ` +
      `${listadas || 'ninguna'}${resto}.\n` +
      'Arréglalo añadiendo el nombre real de la columna a la lista de alternativas del perfil, ' +
      'o comprueba que el fichero es el que se espera y no otro.'
  )
}

/** Elige la primera hoja cuyas columnas obligatorias resuelvan todas */
function elegirHoja(
  libro: XLSX.WorkBook,
  perfil: PerfilLectura,
  obligatorias: (keyof ColumnasPerfil)[]
): { candidata: Candidata; columnas: IndiceColumnas; avisos: string[] } {
  const { lista, avisos } = candidatas(libro, perfil)

  for (const candidata of lista) {
    const { indice, porPrefijo } = resolverColumnasDetalle(candidata.cabeceras, perfil.columnas)
    if (obligatorias.every((campo) => indice[campo] !== -1)) {
      return {
        candidata,
        columnas: indice,
        avisos: [
          ...avisos,
          ...porPrefijo.map((campo) =>
            avisoPorPrefijo(campo, candidata.cabeceras, indice[campo], perfil.columnas[campo] ?? [])
          ),
        ],
      }
    }
  }

  // Ninguna encajó: se explica con la PRIMERA de la lista, que es la hoja que
  // el perfil señalaba. Enseñar las columnas de la última hoja del libro sería
  // exacto y a la vez inútil.
  const primera = lista[0]
  const columnas = resolverColumnas(primera.cabeceras, perfil.columnas)
  const faltan = obligatorias.filter((campo) => columnas[campo] === -1)
  throw errorColumnas(perfil, primera, faltan, avisos)
}

/**
 * Lee el fichero de stock de un cliente con su perfil.
 *
 * Devuelve LineaLeida, que ES una StockLine con acompañantes: los cuatro
 * campos que consume el cruce se calculan exactamente igual que en
 * parseStockWorkbook(), con las mismas funciones y en el mismo orden.
 */
export function leerStock(input: WorkbookInput, perfil: PerfilLectura): LecturaStock {
  if (perfil.tipo !== 'stock') {
    throw new StockSyncError(
      `El perfil «${perfil.nombre}» es de tipo «${perfil.tipo}» y aquí se esperaba uno de stock.`
    )
  }

  const libro = abrirLibro(input, perfil)
  const { candidata, columnas, avisos: avisosHoja } = elegirHoja(libro, perfil, [
    'referencia',
    'stock',
  ])

  const avisos: string[] = [...avisosHoja]
  for (const campo of ['precio', 'coste', 'ean', 'familia'] as const) {
    const alias = perfil.columnas[campo] ?? []
    if (alias.length > 0 && columnas[campo] === -1) {
      // No bloquea —el perfil puede tenerla apuntada «por si acaso»— pero se
      // dice, porque una regla que dependa de esa columna se va a comportar
      // como si el fichero no la trajera y eso desde fuera parece un fallo.
      avisos.push(
        `El perfil espera ${ETIQUETA_CAMPO[campo]} (${alias.map((a) => `«${a}»`).join(', ')}) ` +
          `y el fichero no la trae. Las reglas que dependan de ese dato no se podrán aplicar.`
      )
    }
  }

  const lineas: LineaLeida[] = []
  let filasSinCodigo = 0
  let stockAmbiguo = 0

  for (let i = 0; i < candidata.filas.length; i++) {
    const fila = candidata.filas[i]
    // Las filas del todo vacías se saltan SIN contarlas: ahora la rejilla las
    // conserva para que el número de fila sea el de Excel (ver candidatas()), y
    // meterlas en `filasSinCodigo` convertiría ese contador —que existe para
    // detectar un fichero raro— en el número de líneas de separación.
    if (filaVacia(fila)) continue

    // exactCode() y no plainText(): el código se guarda con sus ceros a la
    // izquierda porque son parte de la identidad del artículo, y solo se le
    // quita el «.0» que mete Excel al leerlo como número.
    const articulo = exactCode(fila[columnas.referencia])
    const articuloNorm = normalizeCode(articulo)
    // Una fila sin código no identifica nada; suele ser el pie de página que
    // el ERP añade al exportar. Se mira la forma normalizada porque un código
    // de solo ceros («0000») tampoco identifica a nadie.
    if (!articuloNorm) {
      filasSinCodigo++
      continue
    }

    const celdaStock = fila[columnas.stock]
    const unidades = parseUnits(celdaStock)
    // «1.499» unidades: mil cuatrocientas noventa y nueve con separador de
    // millares, o una coma y pico de un artículo a granel (el ERP guarda
    // decimales en el cable, que se vende por metros). No se puede saber, y
    // elegir mal por arriba publicaría stock que no existe, así que se elige por
    // abajo —parseUnits lo lee como decimal y sanitizeUnits lo trunca— y se
    // AVISA. Publicar de menos se arregla mañana; vender lo que no hay, no.
    if (esAmbiguoDeMillares(celdaStock)) stockAmbiguo++

    lineas.push({
      articulo,
      articuloNorm,
      descripcion: columnas.descripcion === -1 ? '' : plainText(fila[columnas.descripcion]),
      // Un stock ilegible se trata como cero y no se descarta la línea: el
      // artículo existe, y publicar 0 es correcto y prudente. Descartarlo
      // dejaría en Amazon el stock del envío anterior, que es lo que provoca
      // ventas de lo que no hay.
      stock: unidades === null ? 0 : sanitizeUnits(unidades),
      precio: columnas.precio === -1 ? null : leerImporte(fila[columnas.precio]),
      precioRespaldo:
        columnas.precioRespaldo === -1 ? null : leerImporte(fila[columnas.precioRespaldo]),
      coste: columnas.coste === -1 ? null : leerImporte(fila[columnas.coste]),
      ean: columnas.ean === -1 ? '' : normalizeEan(fila[columnas.ean]),
      familia: columnas.familia === -1 ? '' : plainText(fila[columnas.familia]),
      fila: candidata.primeraFilaDatos + i,
    })
  }

  if (stockAmbiguo > 0) {
    avisos.push(
      `${stockAmbiguo} ${stockAmbiguo === 1 ? 'celda' : 'celdas'} de la columna de stock ` +
        `(«${candidata.cabeceras[columnas.stock]}») ${stockAmbiguo === 1 ? 'tiene' : 'tienen'} la forma ` +
        '«1.499», que puede ser mil cuatrocientas noventa y nueve unidades o una unidad y pico de un ' +
        'artículo a granel. Se han leído como decimales y truncado hacia abajo, que es lo prudente ' +
        'pero puede publicar mucho menos stock del que hay. Si ese punto es el separador de millares, ' +
        'pide el fichero sin separadores o en .xlsx en vez de en .csv.'
    )
  }

  if (lineas.length === 0) {
    throw new StockSyncError(
      `El fichero no trae ninguna línea con código de artículo en la hoja «${candidata.hoja}». ` +
        `Se ha leído la columna «${candidata.cabeceras[columnas.referencia] || '?'}» ` +
        `a partir de la fila ${candidata.primeraFilaDatos}.`
    )
  }

  return {
    perfil: perfil.nombre,
    hoja: candidata.hoja,
    filaCabecera: candidata.filaCabecera,
    cabeceras: candidata.cabeceras,
    columnas,
    lineas,
    filasSinCodigo,
    avisos,
  }
}

/**
 * Lee el fichero de códigos de barras de un cliente y devuelve el índice
 * código exacto de artículo -> sus EAN, que es lo que consume crossStock por
 * la vía 'ean_erp'.
 *
 * Por el código EXACTO. Con la forma normalizada, «0080997933» y «080997933»
 * —dos artículos distintos— comparten entrada y sus EAN se fusionan, que es
 * justo lo que deja sin munición al desempate por EAN.
 */
export function leerEan(input: WorkbookInput, perfil: PerfilLectura): LecturaEan {
  if (perfil.tipo !== 'ean') {
    throw new StockSyncError(
      `El perfil «${perfil.nombre}» es de tipo «${perfil.tipo}» y aquí se esperaba uno de códigos de barras.`
    )
  }

  const libro = abrirLibro(input, perfil)
  const { candidata, columnas, avisos: avisosHoja } = elegirHoja(libro, perfil, [
    'referencia',
    'ean',
  ])

  const avisos: string[] = [...avisosHoja]
  if (perfil.eanSoloTipo !== null && perfil.eanSoloTipo !== undefined && columnas.tipo === -1) {
    // Sin la columna Tipo se acepta todo lo que parezca un código de barras:
    // es peor no poder leer el fichero que fiarse de la criba por longitud.
    // Pero se dice, porque significa que pueden colarse códigos internos.
    avisos.push(
      `El perfil filtra por tipo ${perfil.eanSoloTipo} y el fichero no trae la columna del tipo. ` +
        'Se aceptan todos los códigos que parezcan un EAN, así que pueden colarse códigos internos del ERP.'
    )
  }

  const indice: EanIndex = new Map()
  let codigos = 0

  for (const fila of candidata.filas) {
    if (filaVacia(fila)) continue

    const articulo = exactCode(fila[columnas.referencia])
    if (!normalizeCode(articulo)) continue

    if (
      columnas.tipo !== -1 &&
      perfil.eanSoloTipo !== null &&
      perfil.eanSoloTipo !== undefined &&
      parseUnits(fila[columnas.tipo]) !== perfil.eanSoloTipo
    ) {
      continue
    }

    const ean = normalizeEan(fila[columnas.ean])
    if (!ean) continue

    const lista = indice.get(articulo)
    if (lista) {
      if (!lista.includes(ean)) {
        lista.push(ean)
        codigos++
      }
    } else {
      indice.set(articulo, [ean])
      codigos++
    }
  }

  if (indice.size === 0) {
    avisos.push(
      'No se ha indexado ningún código de barras. El cruce perderá la vía por EAN entera y ' +
        'casarán bastantes menos referencias de lo normal.'
    )
  }

  return {
    perfil: perfil.nombre,
    hoja: candidata.hoja,
    filaCabecera: candidata.filaCabecera,
    cabeceras: candidata.cabeceras,
    columnas,
    indice,
    articulos: indice.size,
    codigos,
    avisos,
  }
}

/**
 * Un importe de una celda, o null.
 *
 * Se apoya en parseUnits() porque ya sabe leer el formato español
 * («1.234,50»), que es como vienen los precios cuando el volcado llega en CSV.
 * A diferencia del stock NO se redondea aquí: un precio con decimales es un
 * precio válido y quien decide cómo se redondea es la regla de negocio.
 *
 * Un cero se devuelve como null a propósito: en la práctica una celda de
 * precio a 0 es una celda vacía leída como número, no un producto regalado, y
 * publicar 0,00 € en Amazon es de las pocas cosas de este módulo que no tienen
 * arreglo a posteriori.
 *
 * Y UN PATRÓN SE RECHAZA POR AMBIGUO EN VEZ DE ELEGIRLO A OJO: «1,499» o
 * «1.499» es mil cuatrocientos noventa y nueve en un idioma y uno con pico en
 * el otro, y un precio no tiene tres decimales. parseUnits tiene que elegir
 * porque lee unidades y ahí una de las dos lecturas siempre es plausible; un
 * importe que se manda a la tienda de un cliente no se adivina. Es el mismo
 * criterio que ya aplica parsePrecio() en la pantalla de edición a mano.
 */
export function leerImporte(valor: unknown): number | null {
  if (esAmbiguoDeMillares(valor)) return null
  const n = parseUnits(valor)
  if (n === null || !Number.isFinite(n) || n <= 0) return null
  return n
}

/**
 * «1.499» o «1,499»: un número con UN separador seguido de exactamente tres
 * cifras, que es genuinamente indistinguible.
 *
 * En español es mil cuatrocientos noventa y nueve; en inglés, uno con pico. No
 * hay contexto que lo resuelva —el mismo fichero puede traer las dos cosas— y
 * por eso quien lo recibe decide qué hacer: el precio lo descarta (un precio no
 * tiene tres decimales, y equivocarse publica mil veces barato) y el stock lo
 * lee por abajo y avisa. Solo se mira en TEXTO: una celda de .xlsx ya viene con
 * su tipo y ahí no hay nada que interpretar.
 */
function esAmbiguoDeMillares(valor: unknown): boolean {
  return typeof valor === 'string' && /^\s*-?\d+[.,]\d{3}\s*$/.test(valor)
}

// =====================================================
// De la fila de la base de datos al perfil
// =====================================================

/**
 * Traduce la fila de stock_read_profiles al perfil que consume el lector.
 *
 * Existe para que nada de lo de arriba tenga que saber cómo se llaman las
 * columnas de Postgres: el día que una columna se renombre se toca aquí y en
 * ningún otro sitio. Y para que el lector se pueda ejecutar con un perfil
 * escrito a mano en una prueba, sin base de datos delante.
 */
export function perfilDesdeFila(fila: StockReadProfile): PerfilLectura {
  return {
    nombre: fila.name,
    tipo: fila.tipo,
    hoja: fila.hoja,
    hojaIndice: fila.hoja_indice,
    filaCabecera: fila.fila_cabecera,
    filaDatos: fila.fila_datos,
    columnas: {
      referencia: fila.col_referencia ?? [],
      stock: fila.col_stock ?? [],
      precio: fila.col_precio ?? [],
      precioRespaldo: fila.col_precio_respaldo ?? [],
      coste: fila.col_coste ?? [],
      ean: fila.col_ean ?? [],
      descripcion: fila.col_descripcion ?? [],
      familia: fila.col_familia ?? [],
      tipo: fila.col_tipo ?? [],
    },
    eanSoloTipo: fila.ean_solo_tipo,
    csvSeparador: fila.csv_separador,
    csvCodificacion: fila.csv_codificacion,
  }
}
