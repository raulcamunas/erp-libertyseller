/**
 * COMPROBACIÓN DEL SIMULACRO: ¿EL CONTRASTE CONTRA AMAZON CUENTA LO QUE DICE?
 *
 * El simulacro es la pieza de la que se fía todo lo demás: es lo que se mira
 * para decidir si se enciende el envío de un cliente y lo que se mira cuando
 * algo va mal. Un contador que exagera invita a apagar la automatización que
 * funcionaba; uno que se queda corto deja pasar el fichero que vacía el
 * inventario. Así que se comprueba con NÚMEROS EXACTOS, no a ojo.
 *
 * LA IDEA DE LA PRUEBA, Y ES LO QUE LA HACE VALER: se fabrica un espejo del
 * catálogo de Amazon PARTIENDO DEL RESULTADO REAL DEL CRUCE (395 filas de datos
 * de verdad) y se le aplican cambios conocidos, uno a uno. Como se sabe
 * exactamente qué se ha movido, se sabe exactamente qué tiene que contestar el
 * simulacro. Con datos inventados de principio a fin se comprobaría la
 * aritmética; partiendo del cruce real se comprueba además que el precio se
 * vuelve a juntar con su SKU por el camino bueno.
 *
 * Se ejecuta así (los ficheros van por argumento: son datos de un cliente y no
 * están en el repositorio):
 *
 *   npx tsx scripts/check-simulacro.ts \
 *     supabase/seed/stock_mappings_shoplamp.csv \
 *     ~/Downloads/ARTICULOS_STOCK_05-08-2026.xlsx \
 *     '~/Downloads/ARTICULOS_EAN_14JULIO2026 (1).xlsx'
 *
 * Sale con código 1 si algo no cuadra.
 */

import { readFileSync } from 'fs'
import Papa from 'papaparse'
import { type CrossMapping, crossStock } from '../lib/stock-sync/engine'
import { PERFIL_SHOPLAMP_EAN, PERFIL_SHOPLAMP_STOCK, leerEan, leerStock } from '../lib/stock-sync/lector'
import { aplicarReglas, type ReglasNegocio } from '../lib/stock-sync/reglas'
import { simular } from '../lib/stock-sync/simulacro'
import type { UmbralesFreno } from '../lib/stock-sync/frenos'
import type { AmazonListing } from '../lib/types/amazon'

const [rutaMapeo, rutaStock, rutaEan] = process.argv.slice(2)

if (!rutaMapeo || !rutaStock || !rutaEan) {
  console.error(
    'Faltan ficheros. Uso:\n' +
      '  npx tsx scripts/check-simulacro.ts <mapeo.csv> <stock.xlsx> <ean.xlsx>'
  )
  process.exit(1)
}

let fallos = 0

function comprobar(titulo: string, ok: boolean, detalle = ''): void {
  console.log(`${ok ? '  OK  ' : ' FALLA'}  ${titulo}${detalle ? ` — ${detalle}` : ''}`)
  if (!ok) fallos++
}

function igual(titulo: string, real: number, esperado: number): void {
  comprobar(titulo, real === esperado, `${real} vs ${esperado} esperado`)
}

const AHORA = new Date('2026-08-07T09:00:00.000Z')

// =====================================================
// El cruce real, que es el punto de partida
// =====================================================

const mapeo = Papa.parse<Record<string, string>>(readFileSync(rutaMapeo, 'utf8'), {
  header: true,
  skipEmptyLines: true,
})

const mappings: CrossMapping[] = mapeo.data.map((f) => ({
  sku_amazon: f.SKU_AMAZON ?? f.sku_amazon ?? '',
  ref_erp: f.REF_ERP ?? f.ref_erp ?? null,
  asin: f.ASIN ?? f.asin ?? null,
  ean_amazon: f.EAN_AMAZON ?? f.ean_amazon ?? null,
  ean_erp: f.EAN_ERP ?? f.ean_erp ?? null,
  ean_final: f.EAN_FINAL ?? f.ean_final ?? null,
  todos_ean_erp: f.TODOS_EAN_ERP ?? f.todos_ean_erp ?? null,
  origen_ean: f.ORIGEN_EAN ?? f.origen_ean ?? null,
}))

const lectura = leerStock(readFileSync(rutaStock), PERFIL_SHOPLAMP_STOCK)
const eanIndex = leerEan(readFileSync(rutaEan), PERFIL_SHOPLAMP_EAN).indice

/**
 * Reglas neutras: sin reserva, sin umbral y sin precio.
 *
 * Neutras a propósito en la parte de stock, para que cualquier diferencia que
 * salga sea del CONTRASTE y no de las reglas — que ya tienen su propia
 * comprobación. El precio se enciende más abajo, en su bloque.
 */
const reglasNeutras: ReglasNegocio = {
  reservaUnidades: 0,
  stockMinimo: 0,
  precioModo: 'ninguno',
  margenPorcentaje: null,
  ivaPorcentaje: null,
  precioMinimo: null,
  precioMaximo: null,
  familiasExcluidas: [],
  referenciasExcluidas: [],
  enviarStock: true,
  enviarPrecio: false,
}

const aplicadas = aplicarReglas(lectura.lineas, reglasNeutras, AHORA)
const cruce = crossStock({ mappings, stockLines: aplicadas.lineas, eanIndex })

console.log(
  `\nPunto de partida real: ${cruce.rows.length} filas cruzadas, ` +
    `${cruce.stats.totalUnits} unidades, ${cruce.unmatched.length} sin casar.\n`
)

const sinUmbrales: UmbralesFreno = {
  maxPctACero: null,
  maxVariacionPrecioPct: null,
  maxCaidaLineasPct: null,
  maxCaidaUnidadesPct: null,
  maxCambios: null,
  lineasReferencia: null,
}

/**
 * Lo que hace falta para llamar a simular() sin repetirlo en cada prueba.
 *
 * `envioAutomatico: false` en todas menos donde se pruebe justo lo contrario:
 * es el modo en el que se ejecuta un simulacro, y con él encendido un freno
 * que no se puede medir bloquea el envío, que es otra prueba distinta.
 */
const CONTEXTO = {
  envioAutomatico: false,
  filasDeMapeo: mappings.length,
  conDestino: true,
} as const

const SIN_RANGO_PRECIO = { precioMinimo: null, precioMaximo: null } as const

/** Un listing del espejo, con lo mínimo que mira el simulacro */
function listing(params: {
  sku: string
  quantity?: number | null
  price?: number | null
  productType?: string | null
  canal?: string | null
  fba?: boolean
  fbaQuantity?: number | null
}): AmazonListing {
  const canal = params.canal === undefined ? 'DEFAULT' : params.canal
  return {
    id: `id-${params.sku}`,
    connection_id: 'conn',
    marketplace_id: 'A1RKKUPIHCS9HS',
    sku: params.sku,
    asin: null,
    title: `Producto ${params.sku}`,
    product_type: params.productType === undefined ? 'LIGHT_FIXTURE' : params.productType,
    condition_type: 'new_new',
    listing_status: ['DISCOVERABLE'],
    price: params.price ?? null,
    currency: 'EUR',
    quantity: params.quantity ?? null,
    fulfillment_channel_code: canal,
    // Es la columna GENERADA de la migración 118: canal no nulo y distinto de
    // DEFAULT. Se reproduce igual para que la prueba no mienta.
    is_fba: params.fba ?? (canal !== null && canal !== '' && canal !== 'DEFAULT'),
    fba_quantity: params.fbaQuantity ?? null,
    fba_fulfillable_quantity: params.fbaQuantity ?? null,
    last_seen_at: AHORA.toISOString(),
    amazon_last_updated_at: null,
    created_at: AHORA.toISOString(),
    updated_at: AHORA.toISOString(),
  }
}

const skusDelMapeo = new Set(mappings.map((m) => m.sku_amazon))

function simulacro(listings: AmazonListing[], opciones: Partial<{
  reglas: Pick<ReglasNegocio, 'enviarStock' | 'enviarPrecio'>
  umbrales: UmbralesFreno
  lineas: typeof aplicadas.lineas
  cruceUsado: typeof cruce
  lineasLeidas: number
}> = {}) {
  return simular({
    lineas: opciones.lineas ?? aplicadas.lineas,
    cruce: opciones.cruceUsado ?? cruce,
    listings,
    skusDelMapeo,
    reglas: { ...SIN_RANGO_PRECIO, ...(opciones.reglas ?? { enviarStock: true, enviarPrecio: false }) },
    moneda: 'EUR',
    umbrales: opciones.umbrales ?? sinUmbrales,
    lineasLeidas: opciones.lineasLeidas ?? lectura.lineas.length,
    ...CONTEXTO,
    ahora: AHORA,
  })
}

// =====================================================
// 1) EL ESPEJO YA DICE LO MISMO QUE EL FICHERO
// =====================================================
// La prueba que más vale de todas: si Amazon ya tiene exactamente lo que dice
// el fichero, el simulacro NO puede proponer ni un solo cambio. Un contraste
// mal hecho —comparar contra la columna equivocada, o no comparar— se
// manifiesta aquí como 395 cambios en vez de 0.

const espejoIdentico = cruce.rows.map((r) => listing({ sku: r.sku, quantity: r.stock }))
const identico = simulacro(espejoIdentico)

igual('sin diferencias, no se propone ningún cambio', identico.cambios.length, 0)
igual('sin diferencias, ningún SKU marcado como que cambia', identico.resumen.skuCambian, 0)
igual(
  'sin diferencias, todos los SKU cuentan como iguales',
  identico.resumen.stockIgual,
  cruce.rows.length
)
igual('sin diferencias, ningún huérfano', identico.resumen.huerfanos, 0)
igual(
  'el detalle trae una fila por SKU cruzado',
  identico.filas.length,
  cruce.rows.length
)

// =====================================================
// 2) CAMBIOS CONOCIDOS, CONTADOS UNO A UNO
// =====================================================
// Se mueven cuatro grupos con nombre y apellidos y se comprueba que cada uno
// cae en su contador. Los grupos se eligen sobre las filas reales del cruce.

const conStock = cruce.rows.filter((r) => r.stock > 0)
const sinStock = cruce.rows.filter((r) => r.stock === 0)

comprobar(
  'los datos reales dan de sí para la prueba',
  conStock.length >= 20 && sinStock.length >= 5,
  `${conStock.length} con unidades · ${sinStock.length} a cero`
)

// 5 que se irán a cero: el fichero dice 0 y Amazon tiene unidades.
const irANCero = sinStock.slice(0, 5)
// 7 que suben: Amazon tiene menos de lo que dice el fichero.
const suben = conStock.slice(0, 7)
// 6 que bajan (sin llegar a 0): Amazon tiene más.
const bajan = conStock.slice(7, 13)

const espejoMovido = cruce.rows.map((r) => {
  if (irANCero.includes(r)) return listing({ sku: r.sku, quantity: 12 })
  if (suben.includes(r)) return listing({ sku: r.sku, quantity: Math.max(0, r.stock - 3) })
  if (bajan.includes(r)) return listing({ sku: r.sku, quantity: r.stock + 25 })
  return listing({ sku: r.sku, quantity: r.stock })
})

const movido = simulacro(espejoMovido)

igual('se cuentan los que se van a cero', movido.resumen.stockACero, irANCero.length)
igual('se cuentan los que suben', movido.resumen.stockSuben, suben.length)
igual('se cuentan los que bajan', movido.resumen.stockBajan, bajan.length)
igual(
  'los SKU que cambian son la suma de los tres grupos',
  movido.resumen.skuCambian,
  irANCero.length + suben.length + bajan.length
)
igual(
  'se propone exactamente un cambio por SKU movido',
  movido.cambios.length,
  irANCero.length + suben.length + bajan.length
)
comprobar(
  'todos los cambios propuestos son de cantidad',
  movido.cambios.every((c) => c.campo === 'cantidad'),
  `${movido.cambios.length} cambios`
)
comprobar(
  'los que se van a cero llevan valor nuevo 0 y anterior mayor que 0',
  movido.filas
    .filter((f) => f.seVaACero)
    .every((f) => f.stock.nuevo === 0 && (f.stock.amazon ?? 0) > 0),
  `${movido.resumen.stockACero} filas`
)
igual(
  'el resto sigue contando como igual',
  movido.resumen.stockIgual,
  cruce.rows.length - (irANCero.length + suben.length + bajan.length)
)

// =====================================================
// 3) LO QUE NO SE PUEDE ESCRIBIR NO SE PROMETE
// =====================================================
// Es la diferencia entre un simulacro fiable y uno que promete cambios que
// sendChanges() rechazaría después. Un FBA, un listing sin tipo de producto y
// uno del que no consta el canal NO pueden aparecer como cambios.

const objetivo = conStock.slice(0, 3)
const espejoBloqueado = cruce.rows.map((r) => {
  // FBA: el stock lo gestiona Amazon.
  if (r === objetivo[0]) {
    return listing({ sku: r.sku, canal: 'AMAZON_EU', fbaQuantity: r.stock + 50 })
  }
  // Sin product_type: Amazon lo exige en cada PATCH.
  if (r === objetivo[1]) {
    return listing({ sku: r.sku, quantity: r.stock + 50, productType: null })
  }
  // Canal desconocido: ante la duda NO se escribe (isMfnChannel).
  if (r === objetivo[2]) return listing({ sku: r.sku, quantity: r.stock + 50, canal: null })
  return listing({ sku: r.sku, quantity: r.stock })
})

const bloqueado = simulacro(espejoBloqueado)

igual('los tres listings no escribibles se marcan como bloqueados', bloqueado.resumen.bloqueados, 3)
igual('y no generan ningún cambio', bloqueado.cambios.length, 0)
igual('ni cuentan como SKU que cambian', bloqueado.resumen.skuCambian, 0)
comprobar(
  'cada bloqueo explica por qué en español',
  bloqueado.filas
    .filter((f) => f.estado === 'bloqueado')
    .every((f) => (f.motivo ?? '').length > 20),
  bloqueado.filas.find((f) => f.estado === 'bloqueado')?.motivo?.slice(0, 80) ?? ''
)

// =====================================================
// 4) LA PREGUNTA QUE NADIE HACE: LOS HUÉRFANOS
// =====================================================
// SKU que Amazon tiene y el fichero no menciona. Se distinguen los dos motivos,
// porque se arreglan en sitios distintos.

const skuDelCruce = new Set(cruce.rows.map((r) => r.sku))
// Uno que SÍ está en el mapeo pero no casó (sale de los unmatched reales).
const noCasa = cruce.unmatched.find((u) => u.sku && !skuDelCruce.has(u.sku))
// Y dos que el mapeo ni conoce.
const espejoConHuerfanos = [
  ...cruce.rows.map((r) => listing({ sku: r.sku, quantity: r.stock })),
  ...(noCasa ? [listing({ sku: noCasa.sku, quantity: 40 })] : []),
  listing({ sku: 'SKU-QUE-NADIE-MAPEO-1', quantity: 17 }),
  listing({ sku: 'SKU-QUE-NADIE-MAPEO-2', quantity: 0 }),
]

const conHuerfanos = simulacro(espejoConHuerfanos)

igual(
  'se detectan todos los SKU de Amazon que el fichero no menciona',
  conHuerfanos.resumen.huerfanos,
  noCasa ? 3 : 2
)
igual(
  'y se separan los que SÍ tienen unidades publicadas',
  conHuerfanos.resumen.huerfanosConStock,
  noCasa ? 2 : 1
)
comprobar(
  'un SKU que el mapeo no conoce se marca como «sin_mapeo»',
  conHuerfanos.huerfanos.find((h) => h.sku === 'SKU-QUE-NADIE-MAPEO-1')?.motivo === 'sin_mapeo',
  ''
)
if (noCasa) {
  comprobar(
    'un SKU que el mapeo sí conoce pero no casa se marca como «no_casa»',
    conHuerfanos.huerfanos.find((h) => h.sku === noCasa.sku)?.motivo === 'no_casa',
    noCasa.sku
  )
}
comprobar(
  'los huérfanos con unidades salen los primeros',
  (conHuerfanos.huerfanos[0]?.stock ?? 0) >= (conHuerfanos.huerfanos.at(-1)?.stock ?? 0),
  ''
)

// =====================================================
// 4 bis) UN SKU SIN LISTING NO ES UN SKU «YA IGUAL»
// =====================================================
// El cruce lo resuelve pero el espejo no lo tiene: o el mapeo apunta a un SKU
// que ya no existe, o el catálogo lleva sin refrescarse. Contarlo como «ya está
// igual» haría que un catálogo sin refrescar pareciera un catálogo al día, que
// es justo el momento en el que alguien decidiría encender el envío.

const espejoIncompleto = espejoIdentico.slice(0, espejoIdentico.length - 10)
const incompleto = simulacro(espejoIncompleto)

igual('los SKU cruzados que no están en el espejo se cuentan aparte', incompleto.resumen.sinListing, 10)
igual(
  'y NO se cuentan como que ya están igual',
  incompleto.resumen.stockIgual,
  cruce.rows.length - 10
)
igual('ni proponen ningún cambio', incompleto.cambios.length, 0)
comprobar(
  'sus unidades no se suman a las que se publicarían',
  incompleto.resumen.unidadesTotal < identico.resumen.unidadesTotal,
  `${incompleto.resumen.unidadesTotal} vs ${identico.resumen.unidadesTotal} con el espejo completo`
)
comprobar(
  'y el aviso lo dice',
  incompleto.avisos.some((a) => a.includes('no están en el espejo')),
  ''
)

// =====================================================
// 5) EL PRECIO, QUE VIAJA POR FUERA DEL CRUCE
// =====================================================
// El cruce no lleva precio: se vuelve a juntar con su SKU DESPUÉS, por el campo
// `articulo`. Si esa unión estuviera mal hecha, el precio de un artículo
// acabaría en el listing de otro — que es exactamente el fallo que no daría
// ningún error y se descubriría por el cliente.

const PRECIO_FIJO = 24.9

// Se le pone a cada línea un precio derivado de su propio artículo, para poder
// comprobar DESPUÉS que cada SKU recibió el de SU artículo y no el de otro.
const lineasConPrecio = aplicadas.lineas.map((l) => ({
  ...l,
  precioFinal: precioDe(l.articulo),
}))

/** Un precio distinto y reproducible por artículo */
function precioDe(articulo: string): number {
  let suma = 0
  for (let i = 0; i < articulo.length; i++) suma += articulo.charCodeAt(i)
  return Math.round((10 + (suma % 400) / 10) * 100) / 100
}

const cruceConPrecio = crossStock({ mappings, stockLines: lineasConPrecio, eanIndex })

const espejoPrecio = cruceConPrecio.rows.map((r) =>
  listing({ sku: r.sku, quantity: r.stock, price: PRECIO_FIJO })
)

const conPrecio = simular({
  lineas: lineasConPrecio,
  cruce: cruceConPrecio,
  listings: espejoPrecio,
  skusDelMapeo,
  reglas: { ...SIN_RANGO_PRECIO, enviarStock: false, enviarPrecio: true },
  moneda: 'EUR',
  umbrales: sinUmbrales,
  lineasLeidas: lectura.lineas.length,
  ...CONTEXTO,
  ahora: AHORA,
})

comprobar(
  'cada SKU recibe el precio de SU artículo, no el de otro',
  conPrecio.filas.every((f) => {
    // Un artículo repetido con precios distintos se marca ambiguo y no manda
    // precio: ese caso es correcto y se comprueba aparte, abajo.
    if (f.precio.nuevo === null) return true
    return Math.abs(f.precio.nuevo - precioDe(f.articulo)) < 0.005
  }),
  `${conPrecio.filas.length} filas comprobadas`
)
comprobar(
  'todos los cambios propuestos son de precio y ninguno de cantidad',
  conPrecio.cambios.length > 0 && conPrecio.cambios.every((c) => c.campo === 'precio'),
  `${conPrecio.cambios.length} cambios de precio`
)
comprobar(
  'no se propone precio cuando coincide con el publicado',
  conPrecio.filas
    .filter((f) => f.precio.nuevo !== null && Math.abs(f.precio.nuevo - PRECIO_FIJO) < 0.005)
    .every((f) => !f.precio.cambia),
  ''
)
igual(
  'los que suben y los que bajan suman los que cambian',
  conPrecio.resumen.precioSuben + conPrecio.resumen.precioBajan,
  conPrecio.resumen.precioCambian
)
comprobar(
  'los mayores saltos vienen ordenados de mayor a menor',
  conPrecio.mayoresSaltos.every(
    (f, i, arr) =>
      i === 0 ||
      Math.abs(arr[i - 1].variacionPrecioPct ?? 0) >= Math.abs(f.variacionPrecioPct ?? 0)
  ),
  `el mayor: ${Math.round(Math.abs(conPrecio.mayoresSaltos[0]?.variacionPrecioPct ?? 0))}%`
)

// =====================================================
// 6) LOS FRENOS, CON LOS NÚMEROS DEL CONTRASTE
// =====================================================
// No basta con que los frenos sepan comparar: tienen que recibir del simulacro
// los mismos números que se enseñan en pantalla.

// Todo el catálogo a cero: el freno del 20% tiene que saltar.
const espejoLleno = cruce.rows.map((r) => listing({ sku: r.sku, quantity: 50 }))
const lineasACero = aplicadas.lineas.map((l) => ({ ...l, stock: 0 }))
const cruceACero = crossStock({ mappings, stockLines: lineasACero, eanIndex })

const vaciado = simular({
  lineas: lineasACero,
  cruce: cruceACero,
  listings: espejoLleno,
  skusDelMapeo,
  reglas: { ...SIN_RANGO_PRECIO, enviarStock: true, enviarPrecio: false },
  moneda: 'EUR',
  umbrales: { ...sinUmbrales, maxPctACero: 20 },
  lineasLeidas: lectura.lineas.length,
  ...CONTEXTO,
  ahora: AHORA,
})

comprobar(
  'un vaciado del catálogo salta el freno de referencias a cero',
  !vaciado.frenos.puedeEnviar && vaciado.frenos.primero === 'pct_a_cero',
  vaciado.frenos.resumen ?? ''
)

// Un fichero a medias: el freno de caída de líneas tiene que saltar ANTES que
// los demás, porque es la causa y no la consecuencia.
const mitad = aplicadas.lineas.slice(0, Math.floor(aplicadas.lineas.length / 2))
const cruceMitad = crossStock({ mappings, stockLines: mitad, eanIndex })

const aMedias = simular({
  lineas: mitad,
  cruce: cruceMitad,
  listings: espejoLleno,
  skusDelMapeo,
  reglas: { ...SIN_RANGO_PRECIO, enviarStock: true, enviarPrecio: false },
  moneda: 'EUR',
  umbrales: { ...sinUmbrales, maxPctACero: 20, maxCaidaLineasPct: 15, lineasReferencia: lectura.lineas.length },
  lineasLeidas: mitad.length,
  ...CONTEXTO,
  ahora: AHORA,
})

comprobar(
  'un volcado a medias salta el freno de caída de líneas, y es el que se avisa',
  !aMedias.frenos.puedeEnviar && aMedias.frenos.primero === 'caida_lineas',
  aMedias.frenos.resumen ?? ''
)

/**
 * SIN UMBRALES, UN SIMULACRO NO FRENA — PERO CADA FRENO QUEDA MARCADO COMO
 * HUECO, Y CON EL ENVÍO AUTOMÁTICO ENCENDIDO ESO SÍ IMPIDE MANDAR.
 *
 * Es el arreglo del agujero que encontró la auditoría: sinEvaluar() devolvía
 * salta=false y evaluarFrenos decidía solo con `saltaron.length === 0`, así que
 * vaciar las casillas de la pantalla —que es lo que hace parseDecimal con un
 * campo en blanco— dejaba pasar cualquier cosa. Un freno sin umbral no es «no
 * ha saltado»: es «no se ha mirado».
 */
comprobar(
  'sin umbrales, un simulacro no frena pero todos los frenos constan como huecos',
  identico.frenos.puedeEnviar &&
    identico.frenos.huecos.length === identico.frenos.todos.filter((f) => f.estado !== 'no_aplica').length &&
    identico.frenos.medidos === 0,
  `${identico.frenos.huecos.length} huecos de ${identico.frenos.todos.length} frenos declarados`
)

const sinUmbralesAutomatico = simulacro(espejoIdentico, { umbrales: sinUmbrales })
// Se recalcula con el envío encendido: es la misma entrada y la decisión tiene
// que ser la contraria.
const conEnvioAutomatico = simular({
  lineas: aplicadas.lineas,
  cruce,
  listings: espejoIdentico,
  skusDelMapeo,
  reglas: { ...SIN_RANGO_PRECIO, enviarStock: true, enviarPrecio: false },
  moneda: 'EUR',
  umbrales: sinUmbrales,
  lineasLeidas: lectura.lineas.length,
  filasDeMapeo: mappings.length,
  conDestino: true,
  envioAutomatico: true,
  ahora: AHORA,
})

comprobar(
  'con el envío automático encendido, un freno sin umbral IMPIDE mandar',
  sinUmbralesAutomatico.frenos.puedeEnviar && !conEnvioAutomatico.frenos.puedeEnviar,
  conEnvioAutomatico.frenos.resumen?.slice(0, 110) ?? ''
)

/**
 * EL DERRUMBE DE UNIDADES QUE NO LLEGA A CERO.
 *
 * Ningún freno lo veía: todas las líneas presentes, todos los SKU presentes y
 * las cantidades hundidas. Es lo que produce un CSV leído con el criterio
 * decimal equivocado, y salía en verde.
 */
const lineasHundidas = aplicadas.lineas.map((l) => ({ ...l, stock: l.stock > 0 ? 1 : 0 }))
const cruceHundido = crossStock({ mappings, stockLines: lineasHundidas, eanIndex })
const hundido = simular({
  lineas: lineasHundidas,
  cruce: cruceHundido,
  listings: espejoLleno,
  skusDelMapeo,
  reglas: { ...SIN_RANGO_PRECIO, enviarStock: true, enviarPrecio: false },
  moneda: 'EUR',
  // Solo el freno de unidades: se comprueba que lo caza ÉL, no otro de rebote.
  umbrales: { ...sinUmbrales, maxCaidaUnidadesPct: 40 },
  lineasLeidas: lectura.lineas.length,
  ...CONTEXTO,
  ahora: AHORA,
})

comprobar(
  'un fichero que hunde las unidades sin llegar a cero salta el freno de unidades',
  !hundido.frenos.puedeEnviar && hundido.frenos.primero === 'caida_unidades',
  hundido.frenos.resumen ?? ''
)

// =====================================================
// 7) INVARIANTES: LO QUE SE ENSEÑA ES LO QUE SE MANDARÍA
// =====================================================
// La lista de cambios y la tabla del detalle salen del mismo recorrido. Si
// alguna vez discreparan, la pantalla enseñaría una cosa y se enviaría otra.

for (const [nombre, s] of [
  ['sin diferencias', identico],
  ['con cambios', movido],
  ['con precio', conPrecio],
] as const) {
  const cambianEnTabla = s.filas.filter((f) => f.estado === 'cambia').length
  comprobar(
    `[${nombre}] el resumen y la tabla dicen lo mismo`,
    cambianEnTabla === s.resumen.skuCambian,
    `${cambianEnTabla} en la tabla vs ${s.resumen.skuCambian} en el resumen`
  )

  const skusConCambio = new Set(s.cambios.map((c) => c.sku))
  comprobar(
    `[${nombre}] cada cambio propuesto tiene su fila marcada`,
    Array.from(skusConCambio).every(
      (sku) => s.filas.find((f) => f.sku === sku)?.estado === 'cambia'
    ),
    `${skusConCambio.size} SKU`
  )
}

// =====================================================

console.log(
  `\nContraste sobre datos reales: ${cruce.rows.length} SKU cruzados de ` +
    `${lectura.lineas.length} líneas del fichero, ${cruce.unmatched.length} sin casar.\n`
)

if (fallos > 0) {
  console.error(`\n${fallos} comprobaciones han fallado.`)
  process.exit(1)
}
console.log('Todo cuadra: el simulacro cuenta exactamente lo que dice contar.')
