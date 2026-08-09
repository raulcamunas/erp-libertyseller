/**
 * EL FICHERO DE COSTES DEL CLIENTE
 * ================================
 * Puro: entra un buffer y un perfil, salen líneas. Sin base de datos.
 *
 *
 * ============ AQUÍ NO HAY NINGÚN LECTOR ============
 *
 * Y es lo importante de este fichero. Abrir el libro, elegir la hoja, encontrar
 * la cabecera y resolver qué columna es cada cosa lo hace `leerTabla()` de
 * lib/stock-sync/lector.ts, que es EXACTAMENTE la misma máquina que lee los
 * volcados de stock que la agencia sube a Amazon todos los días. Lo único que
 * hay aquí es el vocabulario —qué campos busca un fichero de costes— y la
 * interpretación de cada celda.
 *
 * La especificación lo pide literalmente («reutiliza el que ya existe en la
 * sincronización de stock») y el motivo es que ese lector ya sabe las cuatro
 * cosas que se aprenden a base de romperse:
 *
 *   · la hoja que pide el perfil puede no existir, y leer otra en silencio
 *     publica los números de la hoja equivocada;
 *   · la cabecera casi nunca está en la fila 1;
 *   · dos campos no pueden llevarse la misma columna (exclusión mutua), o el
 *     coste de envío acaba leyéndose como precio de compra sin dar un error;
 *   · una columna que casa «por prefijo» es la forma más silenciosa de leer la
 *     que no es, así que se avisa.
 *
 * Escribir un segundo lector habría sido tener dos sitios donde arreglar el
 * mismo fallo, y uno de los dos se habría quedado sin arreglar.
 */

import {
  StockSyncError,
  normalizeHeader,
  parseUnits,
  plainText,
  type WorkbookInput,
} from '@/lib/stock-sync/engine'
import { leerImporte, leerTabla, type EspecLectura } from '@/lib/stock-sync/lector'
import { exactCode, normalizeCode, normalizeEan } from '@/lib/types/stock-sync'
import type { PerfilCostes } from './tipos'

/* ------------------------------------------------------------------ */
/* El vocabulario de un fichero de costes                              */
/* ------------------------------------------------------------------ */

/**
 * ORDEN DE RESOLUCIÓN, Y ES SIGNIFICATIVO.
 *
 * Se resuelven de arriba abajo con exclusión mutua: la columna que se lleva un
 * campo ya no la puede coger otro. Por eso LOS TRES COSTES ESPECÍFICOS VAN
 * ANTES QUE EL PRECIO DE COMPRA, y no es cosmética:
 *
 * findColumn() prueba primero la coincidencia exacta y después «empieza por». En
 * un fichero con «Coste de compra» y «Coste de envío», el alias «Coste» del
 * precio de compra casa por prefijo con la PRIMERA de las dos que encuentre —que
 * puede ser la del envío—. Resolviendo antes los campos de nombre más largo, la
 * columna de envío ya está ocupada cuando le toca el turno al genérico.
 */
const ORDEN_COSTES = [
  'referencia',
  'sku',
  'ean',
  'costeEnvio',
  'costeAlmacen',
  'costeFlete',
  'coste',
  'moneda',
  'validoDesde',
  'descripcion',
] as const

/** Cómo se llama cada campo cuando hay que explicarle un error a una persona */
const ETIQUETAS_COSTES: Record<string, string> = {
  referencia: 'la referencia del artículo',
  sku: 'el SKU de Amazon',
  ean: 'el código de barras',
  coste: 'el precio de compra',
  costeEnvio: 'el coste de envío',
  costeAlmacen: 'el almacenamiento en Amazon',
  costeFlete: 'el flete de entrada',
  moneda: 'la divisa',
  validoDesde: 'la fecha de entrada en vigor',
  descripcion: 'la descripción',
}

/* ------------------------------------------------------------------ */
/* Lo que sale                                                         */
/* ------------------------------------------------------------------ */

/** Una línea del fichero de costes del cliente */
export interface LineaCoste {
  /** Fila del fichero tal y como la ve Excel (1-based), para poder señalarla */
  fila: number
  /**
   * IDENTIDAD del artículo en el ERP del cliente: el código tal cual viene, con
   * sus ceros a la izquierda. Cadena vacía si el fichero no trae referencia.
   */
  articulo: string
  /** El mismo código sin ceros a la izquierda. NO identifica: es clave de búsqueda */
  articuloNorm: string
  /** El SKU de Amazon, si el fichero lo trae. Es el camino corto: sin cruce */
  sku: string
  ean: string
  descripcion: string
  /** null = la celda estaba vacía, era ilegible o valía cero. NUNCA se lee como 0 */
  coste: number | null
  costeEnvio: number | null
  costeAlmacen: number | null
  costeFlete: number | null
  /** La divisa de la fila, si el fichero la trae. '' si no */
  moneda: string
  /** 'YYYY-MM-DD' si el fichero trae fecha de entrada en vigor por fila; null si no */
  validoDesde: string | null
}

export interface LecturaCostes {
  perfil: string
  hoja: string
  filaCabecera: number
  cabeceras: string[]
  columnas: Record<string, number>
  lineas: LineaCoste[]
  /** Filas descartadas por no traer ni referencia ni SKU (pies de página, totales) */
  filasSinIdentidad: number
  /** Filas con identidad pero SIN coste legible. NO se importan, y se cuentan
      aparte para que nadie las confunda con un coste de cero */
  filasSinCoste: number
  avisos: string[]
}

/* ------------------------------------------------------------------ */
/* Lectura                                                             */
/* ------------------------------------------------------------------ */

/** Del perfil de la base a la especificación que entiende el lector compartido */
export function especDePerfilCostes(perfil: PerfilCostes): EspecLectura {
  return {
    nombre: perfil.name,
    columnas: {
      referencia: perfil.col_referencia ?? [],
      sku: perfil.col_sku ?? [],
      ean: perfil.col_ean ?? [],
      descripcion: perfil.col_descripcion ?? [],
      coste: perfil.col_coste ?? [],
      costeEnvio: perfil.col_envio ?? [],
      costeAlmacen: perfil.col_almacen ?? [],
      costeFlete: perfil.col_flete ?? [],
      moneda: perfil.col_moneda ?? [],
      validoDesde: perfil.col_valido_desde ?? [],
    },
    orden: [...ORDEN_COSTES],
    etiquetas: ETIQUETAS_COSTES,
    hoja: perfil.hoja,
    hojaIndice: perfil.hoja_indice,
    filaCabecera: perfil.fila_cabecera,
    filaDatos: perfil.fila_datos,
    csvSeparador: perfil.csv_separador,
    csvCodificacion: perfil.csv_codificacion,
  }
}

/**
 * Lee el fichero de costes de un cliente con su perfil.
 *
 * LAS OBLIGATORIAS SON EL COSTE Y ALGUNA FORMA DE IDENTIDAD. Cuál de las dos
 * identidades se exige depende del perfil: si tiene apuntada la columna de SKU
 * se pide esa, y si no, la referencia del ERP. Con las dos apuntadas basta con
 * que aparezca una —hay ficheros que traen el SKU solo en algunas filas—, y por
 * eso la comprobación de identidad se hace fila a fila y no solo de cabecera.
 */
export function leerCostes(input: WorkbookInput, perfil: PerfilCostes): LecturaCostes {
  const espec = especDePerfilCostes(perfil)

  const tieneSku = (perfil.col_sku ?? []).length > 0
  const tieneRef = (perfil.col_referencia ?? []).length > 0
  if (!tieneSku && !tieneRef) {
    throw new StockSyncError(
      `El perfil «${perfil.name}» no tiene apuntada ni la columna de referencia ni la del SKU. ` +
        'Sin una de las dos no hay a qué producto asignarle el coste.'
    )
  }

  // Se exige la que el perfil considere principal: la referencia si la hay
  // (porque es la que casa contra el mapeo verificado) y el SKU si no.
  const obligatorias = ['coste', tieneRef ? 'referencia' : 'sku']
  const lectura = leerTabla(input, espec, obligatorias, [
    'sku',
    'ean',
    'costeEnvio',
    'costeAlmacen',
    'costeFlete',
    'moneda',
    'validoDesde',
    'descripcion',
  ])

  const c = lectura.columnas
  const avisos = [...lectura.avisos]
  const lineas: LineaCoste[] = []
  let filasSinIdentidad = 0
  let filasSinCoste = 0
  let fechasIlegibles = 0

  for (const { fila, celdas } of lectura.filas) {
    // exactCode() y no plainText(): los ceros a la izquierda son parte de la
    // identidad del artículo en el ERP del cliente. Es la misma decisión que
    // toma el lector de stock, y por el mismo motivo: en el volcado real
    // conviven «0080997933» y «080997933» y son dos productos distintos.
    const articulo = c.referencia === -1 ? '' : exactCode(celdas[c.referencia])
    const articuloNorm = normalizeCode(articulo)
    const sku = c.sku === -1 ? '' : plainText(celdas[c.sku]).replace(/\.0+$/, '')

    // Sin identidad no hay a quién asignarle el coste. Suele ser el pie de
    // página que el ERP añade al exportar: «Total», la fecha de extracción.
    if (!articuloNorm && !sku) {
      filasSinIdentidad += 1
      continue
    }

    const coste = c.coste === -1 ? null : leerImporte(celdas[c.coste])
    if (coste === null) filasSinCoste += 1

    const fecha = c.validoDesde === -1 ? null : leerFecha(celdas[c.validoDesde])
    if (c.validoDesde !== -1 && fecha === null && !celdaVacia(celdas[c.validoDesde])) {
      fechasIlegibles += 1
    }

    lineas.push({
      fila,
      articulo,
      articuloNorm,
      sku,
      ean: c.ean === -1 ? '' : normalizeEan(celdas[c.ean]),
      descripcion: c.descripcion === -1 ? '' : plainText(celdas[c.descripcion]),
      coste,
      costeEnvio: c.costeEnvio === -1 ? null : leerImporte(celdas[c.costeEnvio]),
      costeAlmacen: c.costeAlmacen === -1 ? null : leerImporte(celdas[c.costeAlmacen]),
      costeFlete: c.costeFlete === -1 ? null : leerImporte(celdas[c.costeFlete]),
      moneda: c.moneda === -1 ? '' : normalizaMoneda(celdas[c.moneda]),
      validoDesde: fecha,
    })
  }

  if (filasSinCoste > 0) {
    avisos.push(
      `${filasSinCoste} ${filasSinCoste === 1 ? 'fila trae' : 'filas traen'} el artículo pero no un coste legible ` +
        '(celda vacía, texto, o un cero). NO se van a importar: «sin coste» y «coste cero» no son lo mismo, ' +
        'y un margen calculado sobre cero sale fantástico y falso. Si el cero es de verdad —una muestra, ' +
        'material cedido— méteselo a mano, que ahí sí queda constancia de que alguien lo decidió.'
    )
  }

  if (fechasIlegibles > 0) {
    avisos.push(
      `${fechasIlegibles} ${fechasIlegibles === 1 ? 'fila trae' : 'filas traen'} algo en la columna de fecha de ` +
        'entrada en vigor que no se ha podido leer como fecha. Esas filas usan la fecha general de la importación.'
    )
  }

  if (lineas.length === 0) {
    throw new StockSyncError(
      `El fichero no trae ninguna línea con artículo en la hoja «${lectura.hoja}». ` +
        `Se ha leído la columna «${lectura.cabeceras[c.referencia] ?? lectura.cabeceras[c.sku] ?? '?'}» ` +
        `a partir de la fila ${lectura.filaCabecera + 1}.`
    )
  }

  return {
    perfil: lectura.perfil,
    hoja: lectura.hoja,
    filaCabecera: lectura.filaCabecera,
    cabeceras: lectura.cabeceras,
    columnas: c,
    lineas,
    filasSinIdentidad,
    filasSinCoste,
    avisos,
  }
}

/* ------------------------------------------------------------------ */
/* Celdas                                                              */
/* ------------------------------------------------------------------ */

function celdaVacia(valor: unknown): boolean {
  return valor === null || valor === undefined || String(valor).trim() === ''
}

/**
 * La divisa de una celda, en mayúsculas y de tres letras.
 *
 * Se aceptan también los símbolos porque los ficheros de ERP los traen: «€» y
 * «$» son lo que escribe media Europa. El dólar se resuelve como USD y no como
 * CAD ni AUD: es el uso abrumadoramente mayoritario y, si se equivoca, se ve en
 * la pantalla de cobertura, que enseña las divisas distintas que han entrado.
 * Lo que NO se hace es inventarse una divisa cuando la celda está vacía.
 */
function normalizaMoneda(valor: unknown): string {
  const texto = plainText(valor).trim()
  if (!texto) return ''
  if (texto.includes('€')) return 'EUR'
  if (texto.includes('£')) return 'GBP'
  if (texto.includes('$')) return 'USD'
  const letras = texto.toUpperCase().replace(/[^A-Z]/g, '')
  return letras.length === 3 ? letras : ''
}

/**
 * Una fecha de una celda, en 'YYYY-MM-DD'.
 *
 * Tres formas, y las tres aparecen de verdad:
 *   · el número de serie de Excel (45.000 y pico), que es lo que llega cuando la
 *     celda tiene formato de fecha;
 *   · el ISO, que es lo que escriben los ERP modernos;
 *   · dd/mm/aaaa, que es lo que escribe media España.
 *
 * El caso ambiguo —«03/04/2026»— se resuelve como DÍA/MES porque este ERP es
 * español y sus ficheros los exportan sus clientes. Se deja escrito para que
 * nadie lo cambie por descuido: en un fichero de costes equivocarse de mes mueve
 * un tramo entero de vigencia, y el margen del mes que se calcula con el coste
 * que no era pasa desapercibido.
 *
 * Lo que no se reconoce devuelve null y la fila se queda con la fecha general de
 * la importación, que es lo prudente: inventarse la fecha de entrada en vigor
 * reescribe el histórico de márgenes sin que nadie lo pida.
 */
export function leerFecha(valor: unknown): string | null {
  if (celdaVacia(valor)) return null

  // Número de serie de Excel: días desde el 30/12/1899 (el sistema de 1900 con
  // el año bisiesto fantasma que Lotus 1-2-3 metió en 1983 y que sigue ahí).
  if (typeof valor === 'number' && Number.isFinite(valor)) {
    if (valor < 1 || valor > 2_958_465) return null
    const ms = Date.UTC(1899, 11, 30) + Math.floor(valor) * 86_400_000
    return iso(new Date(ms))
  }

  const texto = String(valor).trim()

  const isoDirecto = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(texto)
  if (isoDirecto) {
    return validaYFormatea(Number(isoDirecto[1]), Number(isoDirecto[2]), Number(isoDirecto[3]))
  }

  const conBarras = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(texto)
  if (conBarras) {
    const anyo = Number(conBarras[3])
    return validaYFormatea(
      anyo < 100 ? 2000 + anyo : anyo,
      Number(conBarras[2]),
      Number(conBarras[1])
    )
  }

  return null
}

function validaYFormatea(anyo: number, mes: number, dia: number): string | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31 || anyo < 1990 || anyo > 2999) return null
  const d = new Date(Date.UTC(anyo, mes - 1, dia, 12))
  // Rebota el 31 de febrero: si el mes se ha desbordado, la fecha no existía.
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null
  return iso(d)
}

function iso(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate()
  ).padStart(2, '0')}`
}

/**
 * Las cabeceras del fichero, tal cual, para que la pantalla pueda proponerlas al
 * configurar un perfil.
 *
 * Existe para lo mismo que el explorador de orígenes de la sincronización de
 * stock: dar de alta un cliente con el fichero delante es diez segundos si se
 * ven sus columnas, y media tarde si hay que adivinarlas.
 */
export function cabecerasDe(input: WorkbookInput, perfil: PerfilCostes): string[] {
  const espec = especDePerfilCostes(perfil)
  // Sin obligatorias: aquí solo interesa qué trae el fichero, no si encaja.
  return leerTabla(input, espec, []).cabeceras.filter((cabecera) => normalizeHeader(cabecera) !== '')
}

/** Reexportado para que quien lea costes no tenga que conocer el motor de stock */
export { parseUnits, StockSyncError }
