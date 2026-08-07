/**
 * COMPROBACIÓN DE NO REGRESIÓN DEL LECTOR CONFIGURABLE.
 *
 * Responde a una sola pregunta, que es la que importa: ¿leer el fichero del
 * cliente CON PERFIL da exactamente lo mismo que leerlo con el código de
 * siempre? Si algún día deja de darlo, el módulo «Sincronismo de stock» —el
 * que la agencia usa de verdad todos los días— habrá cambiado de resultado sin
 * que nadie lo haya pedido.
 *
 * Compara tres cosas contra los ficheros reales:
 *   1. parseStockWorkbook()  vs  leerStock(PERFIL_SHOPLAMP_STOCK), línea a línea
 *   2. parseEanWorkbook()    vs  leerEan(PERFIL_SHOPLAMP_EAN), entrada a entrada
 *   3. crossStock() por los dos caminos: tiene que dar 395 filas y 7.877 unidades
 *
 * Se ejecuta así (los tres ficheros van por argumento porque no están en el
 * repositorio: son datos de un cliente):
 *
 *   npx tsx scripts/check-lector-stock.ts \
 *     supabase/seed/stock_mappings_shoplamp.csv \
 *     ~/Downloads/ARTICULOS_STOCK_05-08-2026.xlsx \
 *     '~/Downloads/ARTICULOS_EAN_14JULIO2026 (1).xlsx'
 *
 * Sale con código 1 si algo no cuadra, para que se pueda encadenar.
 */

import { readFileSync } from 'fs'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import {
  type CrossMapping,
  crossStock,
  parseEanWorkbook,
  parseStockWorkbook,
} from '../lib/stock-sync/engine'
import {
  PERFIL_SHOPLAMP_EAN,
  PERFIL_SHOPLAMP_STOCK,
  leerEan,
  leerStock,
} from '../lib/stock-sync/lector'

/** Lo que dio el cruce con estos tres ficheros el día que se verificó a mano */
const FILAS_ESPERADAS = 395
const UNIDADES_ESPERADAS = 7877

const [rutaMapeo, rutaStock, rutaEan] = process.argv.slice(2)

if (!rutaMapeo || !rutaStock || !rutaEan) {
  console.error(
    'Faltan ficheros. Uso:\n' +
      '  npx tsx scripts/check-lector-stock.ts <mapeo.csv> <stock.xlsx> <ean.xlsx>'
  )
  process.exit(1)
}

let fallos = 0

function comprobar(titulo: string, ok: boolean, detalle: string): void {
  console.log(`${ok ? '  OK  ' : ' FALLA'}  ${titulo}${detalle ? ` — ${detalle}` : ''}`)
  if (!ok) fallos++
}

// ---------- 1) El fichero de stock ----------

const bufferStock = readFileSync(rutaStock)

const viejasStock = parseStockWorkbook(bufferStock)
const lectura = leerStock(bufferStock, PERFIL_SHOPLAMP_STOCK)
const nuevasStock = lectura.lineas

comprobar(
  'mismo número de líneas de stock',
  viejasStock.length === nuevasStock.length,
  `${viejasStock.length} vs ${nuevasStock.length}`
)

let diferentes = 0
let primeraDiferencia = ''
const hasta = Math.min(viejasStock.length, nuevasStock.length)
for (let i = 0; i < hasta; i++) {
  const a = viejasStock[i]
  const b = nuevasStock[i]
  // Solo los cuatro campos que consume crossStock: los que trae de más el
  // lector nuevo (precio, coste, ean, familia, fila) son acompañantes y el
  // cruce ni los mira.
  if (
    a.articulo !== b.articulo ||
    a.articuloNorm !== b.articuloNorm ||
    a.descripcion !== b.descripcion ||
    a.stock !== b.stock
  ) {
    diferentes++
    if (!primeraDiferencia) {
      primeraDiferencia = `línea ${i}: ${JSON.stringify(a)} vs ${JSON.stringify({
        articulo: b.articulo,
        articuloNorm: b.articuloNorm,
        descripcion: b.descripcion,
        stock: b.stock,
      })}`
    }
  }
}

comprobar(
  'las líneas de stock son idénticas campo a campo',
  diferentes === 0,
  diferentes === 0 ? `${hasta} líneas comparadas` : `${diferentes} distintas · ${primeraDiferencia}`
)

// ---------- 2) El fichero de EAN ----------

const bufferEan = readFileSync(rutaEan)

const viejoEan = parseEanWorkbook(bufferEan)
const nuevoEan = leerEan(bufferEan, PERFIL_SHOPLAMP_EAN).indice

comprobar(
  'mismo número de artículos con EAN',
  viejoEan.size === nuevoEan.size,
  `${viejoEan.size} vs ${nuevoEan.size}`
)

let eanDistintos = 0
let primerEanDistinto = ''
for (const [articulo, lista] of viejoEan) {
  const otra = nuevoEan.get(articulo)
  if (!otra || otra.length !== lista.length || otra.some((v, i) => v !== lista[i])) {
    eanDistintos++
    if (!primerEanDistinto) {
      primerEanDistinto = `${articulo}: ${JSON.stringify(lista)} vs ${JSON.stringify(otra ?? null)}`
    }
  }
}

comprobar(
  'los índices de EAN son idénticos',
  eanDistintos === 0,
  eanDistintos === 0 ? `${viejoEan.size} artículos comparados` : `${eanDistintos} distintos · ${primerEanDistinto}`
)

// ---------- 3) El cruce completo, por los dos caminos ----------

const csv = Papa.parse<Record<string, string>>(readFileSync(rutaMapeo, 'utf8'), {
  header: true,
  skipEmptyLines: true,
})

const mappings: CrossMapping[] = csv.data
  .filter((r) => (r.is_active ?? 'true').trim() !== 'false')
  .map((r) => ({
    sku_amazon: r.sku_amazon ?? '',
    ref_erp: r.ref_erp ?? null,
    asin: r.asin ?? null,
    ean_amazon: r.ean_amazon ?? null,
    ean_erp: r.ean_erp ?? null,
    ean_final: r.ean_final ?? null,
    todos_ean_erp: r.todos_ean_erp ?? null,
    origen_ean: r.origen_ean ?? null,
  }))

const viejo = crossStock({ mappings, stockLines: viejasStock, eanIndex: viejoEan })
// nuevasStock es LineaLeida[], que ES StockLine[] con acompañantes: se le pasa
// a crossStock sin convertir nada, que es justo lo que había que demostrar.
const nuevo = crossStock({ mappings, stockLines: nuevasStock, eanIndex: nuevoEan })

comprobar(
  `el camino de siempre da ${FILAS_ESPERADAS} filas y ${UNIDADES_ESPERADAS} unidades`,
  viejo.rows.length === FILAS_ESPERADAS && viejo.stats.totalUnits === UNIDADES_ESPERADAS,
  `${viejo.rows.length} filas · ${viejo.stats.totalUnits} unidades`
)

comprobar(
  `el camino del perfil da ${FILAS_ESPERADAS} filas y ${UNIDADES_ESPERADAS} unidades`,
  nuevo.rows.length === FILAS_ESPERADAS && nuevo.stats.totalUnits === UNIDADES_ESPERADAS,
  `${nuevo.rows.length} filas · ${nuevo.stats.totalUnits} unidades`
)

const mismasFilas =
  viejo.rows.length === nuevo.rows.length &&
  viejo.rows.every((r, i) => {
    const o = nuevo.rows[i]
    return r.sku === o.sku && r.stock === o.stock && r.via === o.via && r.articulo === o.articulo
  })

comprobar(
  'el fichero de salida es idéntico SKU a SKU, incluida la vía de cruce',
  mismasFilas,
  JSON.stringify(nuevo.stats.byVia)
)

comprobar(
  'mismos SKU sin casar',
  viejo.unmatched.length === nuevo.unmatched.length,
  `${viejo.unmatched.length} vs ${nuevo.unmatched.length}`
)

// ---------- 4) Ficheros fabricados: los fallos que NO se ven ----------
//
// Los tres de aquí abajo son silenciosos: no dan error, no dan aviso y
// devuelven un número plausible. Sin una comprobación que los fije, vuelven.

/** Un libro de una hoja a partir de filas sueltas */
function libro(nombre: string, filas: unknown[][]): Uint8Array {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(filas), nombre)
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }))
}

/**
 * FILAS EN BLANCO Y `fila_datos`.
 *
 * Los dos campos son la fila COMO LA VE EXCEL. Con la rejilla leída sin filas
 * en blanco, la posición del array dejaba de ser la fila del fichero en cuanto
 * había una línea vacía por encima, y el primer artículo se perdía sin error,
 * sin aviso y sin contarse. El listing de ese artículo se quedaba con el stock
 * del envío anterior indefinidamente.
 */
const conBlanco = libro('Browser', [
  ['Articulo', 'Descrip.Propia', 'St. Real'],
  [null, null, null],
  ['0001', 'Bombilla', 40],
  ['0002', 'Foco', 12],
  ['0003', 'Tira LED', 7],
])

const conFilaEnBlanco = leerStock(conBlanco, {
  nombre: 'Prueba · fila en blanco',
  tipo: 'stock',
  hoja: 'Browser',
  filaCabecera: 1,
  filaDatos: 3,
  columnas: {
    referencia: ['Articulo'],
    stock: ['St. Real'],
    descripcion: ['Descrip.Propia'],
  },
})

comprobar(
  'una fila en blanco entre la cabecera y los datos no se come ningún artículo',
  conFilaEnBlanco.lineas.length === 3 &&
    conFilaEnBlanco.lineas[0].articulo === '0001' &&
    conFilaEnBlanco.lineas[0].stock === 40,
  JSON.stringify(conFilaEnBlanco.lineas.map((l) => [l.articulo, l.stock, l.fila]))
)

comprobar(
  'y la fila que se apunta en cada línea es la que ve Excel',
  conFilaEnBlanco.lineas.map((l) => l.fila).join(',') === '3,4,5',
  conFilaEnBlanco.lineas.map((l) => l.fila).join(',')
)

comprobar(
  'las filas en blanco no se cuentan como filas sin código',
  conFilaEnBlanco.filasSinCodigo === 0,
  `${conFilaEnBlanco.filasSinCodigo} contadas`
)

/**
 * UNA COLUMNA EMPAREJADA POR PARECIDO DE NOMBRE.
 *
 * findColumn cae a «empieza por» cuando no hay coincidencia exacta. Con un
 * fichero que trae «FBA/FBM Stock» (las unidades) y «Stock value» (un importe),
 * el alias «Stock» se lleva la segunda y devuelve el catálogo entero a cero sin
 * dar ningún error. No se puede prohibir —rompería perfiles legítimos— pero sí
 * se puede decir.
 */
const porParecido = leerStock(
  libro('Hoja1', [
    ['SKU', 'FBA/FBM Stock', 'Stock value'],
    ['A-1', 219, 0],
    ['A-2', 93, 0],
  ]),
  {
    nombre: 'Prueba · parecido',
    tipo: 'stock',
    columnas: { referencia: ['Articulo', 'Referencia', 'SKU'], stock: ['St. Real', 'Stock'] },
  }
)

comprobar(
  'una columna que casa solo por prefijo deja aviso',
  porParecido.avisos.some((a) => a.includes('Stock value') && a.includes('empieza igual')),
  porParecido.avisos[0] ?? '(ningún aviso)'
)

/**
 * LA HOJA QUE EL PERFIL PIDE Y NO EXISTE.
 *
 * Se caía al orden del libro sin dejar constancia, así que una errata en el
 * nombre hacía que se leyera otra hoja con otros números. En un fichero con una
 * hoja de resumen delante de la de detalle eso publica los números equivocados.
 */
const dosHojas = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(
  dosHojas,
  XLSX.utils.aoa_to_sheet([['Articulo', 'Stock'], ['A-1', 999]]),
  'Resumen'
)
XLSX.utils.book_append_sheet(
  dosHojas,
  XLSX.utils.aoa_to_sheet([['Articulo', 'Stock'], ['A-1', 3]]),
  'Detalle'
)
const conErrata = leerStock(
  new Uint8Array(XLSX.write(dosHojas, { type: 'array', bookType: 'xlsx' })),
  {
    nombre: 'Prueba · errata',
    tipo: 'stock',
    hoja: 'Detalel',
    columnas: { referencia: ['Articulo'], stock: ['Stock'] },
  }
)

comprobar(
  'una errata en el nombre de la hoja deja aviso en vez de leer otra en silencio',
  conErrata.avisos.some((a) => a.includes('Detalel') && a.includes('no la tiene')),
  `hoja leída «${conErrata.hoja}» · ${conErrata.avisos.length} aviso(s)`
)

/**
 * UN CSV EN FORMATO ESPAÑOL.
 *
 * SheetJS parseaba las celdas del CSV con criterio anglosajón antes de que
 * parseUnits llegara a verlas: «24,90» salía 2490 y «0001» salía 1. Los precios
 * se multiplicaban por cien y las referencias perdían sus ceros a la izquierda,
 * todo sin un solo error. Se arregla con raw:true al abrir el libro.
 */
const csvEspanol = new TextEncoder().encode(
  'Articulo;Descripcion;Stock;PVP\n' +
    '0001;Bombilla;12;7,50\n' +
    '0002;Foco;1.499;24,90\n' +
    '0003;Lampara;3;1.499,90\n'
)

const csvLeido = leerStock(csvEspanol, {
  nombre: 'Prueba · CSV español',
  tipo: 'stock',
  columnas: {
    referencia: ['Articulo'],
    stock: ['Stock'],
    precio: ['PVP'],
    descripcion: ['Descripcion'],
  },
})

comprobar(
  'un CSV español conserva los ceros a la izquierda de la referencia',
  csvLeido.lineas.map((l) => l.articulo).join(',') === '0001,0002,0003',
  csvLeido.lineas.map((l) => l.articulo).join(',')
)

comprobar(
  'y lee los precios en formato español sin multiplicarlos por cien',
  csvLeido.lineas[0].precio === 7.5 && csvLeido.lineas[1].precio === 24.9 && csvLeido.lineas[2].precio === 1499.9,
  csvLeido.lineas.map((l) => l.precio).join(', ')
)

/**
 * «1.499» unidades es genuinamente ambiguo —mil cuatrocientas noventa y nueve
 * con separador de millares, o una y pico de un artículo a granel— y no hay
 * contexto que lo resuelva. Se elige por abajo, que es lo que no vende lo que
 * no hay, Y SE AVISA: lo que no puede pasar es que se elija en silencio.
 */
comprobar(
  'un stock ambiguo como «1.499» se lee por abajo y deja aviso',
  csvLeido.lineas[1].stock === 1 &&
    csvLeido.avisos.some((a) => a.includes('1.499') && a.includes('truncado')),
  `${csvLeido.lineas[1].stock} unidades · ${csvLeido.avisos.length} aviso(s)`
)

console.log(
  `\nHoja leída: «${lectura.hoja}» · cabecera en la fila ${lectura.filaCabecera} · ` +
    `${lectura.filasSinCodigo} filas sin código descartadas`
)

if (fallos > 0) {
  console.error(`\n${fallos} comprobación(es) han fallado. NO se ha mantenido el comportamiento.`)
  process.exit(1)
}

console.log('\nTodo cuadra: leer por perfil da exactamente lo mismo que el código de siempre.')
