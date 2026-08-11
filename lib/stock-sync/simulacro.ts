/**
 * EL SIMULACRO: QUÉ SE MANDARÍA, SIN MANDAR NADA.
 *
 * Es la pieza más importante de toda la automatización, y no por prudencia
 * general: es lo que convierte dar de alta a un cliente en media hora en vez de
 * en un susto, y es lo primero que se mira cuando algo va mal.
 *
 * LA DIFERENCIA CON EL PROCESO DE HOY, Y ES TODA LA DIFERENCIA: el sincronismo
 * manual genera un Excel con lo que el fichero dice, y nadie sabe qué parte de
 * eso es un CAMBIO hasta que Amazon lo digiere. Aquí se contrasta contra EL
 * CATÁLOGO QUE AMAZON TIENE AHORA MISMO —el espejo que ya mantiene el módulo de
 * Amazon cada quince minutos— así que se puede decir cuántos SKU cambian de
 * verdad, cuántos suben, cuántos bajan y cuántos se irían a cero.
 *
 * Y LA PREGUNTA QUE NADIE HACE: cuántos SKU tiene Amazon que el fichero NO
 * menciona. Esos son los que se quedan con el stock de hace tres meses para
 * siempre, vendiendo lo que ya no hay; no aparecen en ningún informe porque no
 * fallan, sencillamente no salen.
 *
 * TODO ES PURO. Ni Supabase, ni fetch, ni Date.now(): entran las líneas ya
 * leídas y pasadas por las reglas, el resultado del cruce, el espejo del
 * catálogo y la fecha. Quien llama se encarga de traer los datos. Así el
 * simulacro se puede ejecutar sobre datos inventados para comprobar que cuenta
 * lo que dice contar.
 *
 * NO ENVÍA. No hay ni una llamada a sendChanges() en este fichero, a propósito:
 * lo que se envía se decide fuera, mirando además los frenos.
 */

import { MAX_PRICE, MAX_QUANTITY, mismoValor, stockEfectivo } from '@/lib/amazon/catalogo'
import {
  canEditPrice,
  canEditQuantity,
  whyNotEditable,
  type AmazonListing,
} from '@/lib/types/amazon'
import { formatInt, type StockMatchMethod } from '@/lib/types/stock-sync'
import type { AmazonStockRow, CrossResult, UnmatchedReason } from './engine'
import { evaluarFrenos, type CambioPropuesto, type ResultadoFrenos, type UmbralesFreno } from './frenos'
import type { LineaAplicada, ReglasNegocio } from './reglas'

// =====================================================
// Entradas
// =====================================================

export interface EntradaSimulacro {
  /** Las líneas del fichero ya pasadas por las reglas del cliente */
  lineas: LineaAplicada[]
  /** Lo que devolvió crossStock() con esas mismas líneas */
  cruce: CrossResult
  /** El espejo del catálogo: lo que Amazon tiene AHORA en esta conexión y marketplace */
  listings: AmazonListing[]
  /**
   * SKU que aparecen en la tabla de mapeo del cliente. Sirve para separar los
   * dos motivos por los que un listing de Amazon se queda sin tocar: que el
   * mapeo no lo conozca (se arregla completando el mapeo) o que lo conozca y su
   * artículo no venga en el fichero (se arregla mirando el volcado).
   */
  skusDelMapeo: ReadonlySet<string>
  reglas: Pick<ReglasNegocio, 'enviarStock' | 'enviarPrecio' | 'precioMinimo' | 'precioMaximo'>
  moneda: string
  umbrales: UmbralesFreno
  /**
   * Si este cliente tiene el envío automático encendido.
   *
   * Con él encendido, un freno que no se ha podido medir impide mandar igual
   * que uno que ha saltado: sin nadie delante, «no se ha mirado» no puede valer
   * como permiso. En simulacro va apagado porque ahí no se manda nada y
   * bloquear la pantalla de alta de un cliente no protegería de nada.
   */
  envioAutomatico: boolean
  /**
   * Cuántas filas de mapeo activas tiene el cliente. Sirve para distinguir «el
   * fichero no menciona estos SKU» de «este cliente todavía no tiene mapeo»,
   * que dan el mismo simulacro vacío y tienen arreglos opuestos.
   */
  filasDeMapeo: number
  /**
   * true si esas filas NO salen de stock_mappings sino del propio catálogo de
   * Amazon, cruzando la referencia del fichero contra el SKU. Ver
   * resolverMapeo() en proceso.ts.
   *
   * Cambia lo que hay que decirle a quien mira la pantalla: con la tabla, un
   * SKU sin casar se arregla completando el mapeo; sin ella, se arregla en el
   * SKU de Amazon o en la referencia del cliente, que son sitios distintos.
   */
  mapeoAutomatico?: boolean
  /** Cuándo se refrescó por última vez el espejo del catálogo. null = nunca */
  espejoRefrescadoEn?: string | null
  /** true si el perfil apunta a una conexión de Amazon: sin ella el espejo vacío es normal */
  conDestino?: boolean
  /**
   * Líneas con código que traía el fichero ANTES de aplicar las reglas. Es lo
   * que mide el freno de caída: si se contaran las de después, un cambio en las
   * exclusiones del perfil parecería un fichero a medias.
   */
  lineasLeidas: number
  ahora: Date
}

// =====================================================
// Salida
// =====================================================

/** Qué pasaría con un campo concreto de un SKU */
export interface CampoSimulado {
  /** Lo que Amazon tiene ahora. null = no lo sabemos o el listing no está */
  amazon: number | null
  /** Lo que se mandaría. null = este perfil no manda este campo, o no hay dato */
  nuevo: number | null
  cambia: boolean
  /** true si hay valor nuevo pero NO se puede escribir */
  bloqueado: boolean
  /** Por qué no se puede escribir, en español. null si se puede */
  motivoBloqueo: string | null
}

export type EstadoFila =
  /** Se mandaría algo */
  | 'cambia'
  /** Lo que dice el fichero es lo que Amazon ya tiene */
  | 'igual'
  /** El cruce lo resolvió pero ese SKU no está en el espejo del catálogo */
  | 'sin_listing'
  /** Hay algo que cambiar y no se puede escribir (FBA, sin tipo de producto…) */
  | 'bloqueado'
  /** El perfil no manda ninguno de los dos campos */
  | 'sin_envio'

export const ESTADO_FILA_LABELS: Record<EstadoFila, string> = {
  cambia: 'Cambiaría',
  igual: 'Ya está igual',
  sin_listing: 'No está en el catálogo',
  bloqueado: 'No se puede escribir',
  sin_envio: 'No se manda nada',
}

/** Una línea del detalle: un SKU que el fichero sí resolvió */
export interface FilaSimulacro {
  sku: string
  asin: string | null
  titulo: string | null
  /** Código del artículo en el ERP del cliente, con sus ceros */
  articulo: string
  refErp: string | null
  descripcion: string
  /** Por qué vía casó el cruce. Un 'ean_listing' conviene mirarlo dos veces */
  via: StockMatchMethod
  esFba: boolean
  stock: CampoSimulado
  precio: CampoSimulado
  /** Variación de precio en tanto por ciento. null si no hay con qué comparar */
  variacionPrecioPct: number | null
  /** true si el stock pasaría de tener unidades a cero. Es lo que más duele */
  seVaACero: boolean
  estado: EstadoFila
  /** Cuando no se manda nada, por qué. Es la columna que más se lee de la tabla */
  motivo: string | null
}

/** Por qué un SKU de Amazon no lo toca el fichero */
export type MotivoHuerfano = 'sin_mapeo' | 'no_casa'

export const MOTIVO_HUERFANO_LABELS: Record<MotivoHuerfano, string> = {
  sin_mapeo: 'El mapeo del cliente no tiene este SKU',
  // «no viene en el fichero» a secas era mentira en un caso corriente: una
  // línea que SÍ venía y que las reglas descartaron —familia excluida, precio
  // ilegible— acaba aquí igual, y quien lo lee se pone a buscar en el volcado
  // del cliente un artículo que estaba donde tenía que estar.
  no_casa: 'El mapeo lo tiene, pero su artículo no ha llegado al cruce: o no viene en el fichero, o lo han descartado las reglas del perfil',
}

/**
 * Un SKU que Amazon tiene y el fichero no menciona.
 *
 * LA PREGUNTA QUE NADIE HACE. Un listing así se queda con el stock del último
 * envío que sí lo incluyó, para siempre, y sigue vendiendo. No da ningún error
 * ni aparece en ningún contador: sencillamente no sale en el fichero.
 */
export interface HuerfanoAmazon {
  sku: string
  asin: string | null
  titulo: string | null
  /** Lo que Amazon tiene publicado ahora mismo */
  stock: number | null
  precio: number | null
  esFba: boolean
  motivo: MotivoHuerfano
}

export interface ResumenSimulacro {
  /** SKU que el fichero resolvió (los que tienen fila en el detalle) */
  skuEnFichero: number
  /** De esos, cuántos cambiarían algo */
  skuCambian: number

  stockSuben: number
  stockBajan: number
  /** De tener unidades a cero. Es el número que decide si esto se manda o no */
  stockACero: number
  stockIgual: number
  /** Unidades que se publicarían en total */
  unidadesTotal: number

  precioCambian: number
  precioSuben: number
  precioBajan: number

  /** Filas del mapeo que no casaron con ningún artículo del fichero */
  sinCasar: number
  sinCasarPorMotivo: Record<UnmatchedReason, number>

  /** SKU de Amazon que el fichero no menciona */
  huerfanos: number
  /** De esos, los que tienen unidades publicadas: son los que siguen vendiendo */
  huerfanosConStock: number

  /** SKU con algo que cambiar que no se puede escribir */
  bloqueados: number
  /** SKU resueltos que no están en el espejo del catálogo */
  sinListing: number

  /** Total de SKU en el espejo, para poner los porcentajes en contexto */
  skuEnAmazon: number
  /**
   * SKU QUE ESTE PERFIL GESTIONA DE VERDAD: los que el fichero resuelve y
   * además existen en el espejo. Es el denominador honesto de los porcentajes,
   * porque el mapeo de un cliente casi nunca cubre su catálogo entero.
   */
  skuGestionados: number
  /**
   * Unidades que Amazon tiene AHORA en esas mismas filas, para poder comparar
   * con `unidadesTotal`. Se cuentan sobre el mismo conjunto exacto: sumar unas
   * sobre un conjunto y otras sobre otro daría una caída inventada.
   */
  unidadesEnAmazon: number
}

export interface Simulacro {
  filas: FilaSimulacro[]
  huerfanos: HuerfanoAmazon[]
  /** Tal cual sale de crossStock: sku, motivo y frase */
  sinCasar: CrossResult['unmatched']
  resumen: ResumenSimulacro
  /**
   * Lo que se mandaría, en el formato que consume sendChanges().
   *
   * Es la MISMA lista que se ha medido y que han visto los frenos. Que el envío
   * salga de aquí y no de un segundo recorrido es lo que garantiza que lo
   * enviado sea exactamente lo enseñado: dos recorridos con la misma intención
   * acaban discrepando en cuanto uno de los dos cambia.
   */
  cambios: CambioPropuesto[]
  frenos: ResultadoFrenos
  /** Los mayores saltos de precio, de mayor a menor. Es donde se ve el desastre */
  mayoresSaltos: FilaSimulacro[]
  moneda: string
  avisos: string[]
  simuladoEn: string
}

/** Cuántos saltos de precio se devuelven arriba del todo */
const MAX_SALTOS = 20

/**
 * A partir de cuántas horas el espejo del catálogo deja de servir para
 * contrastar. El refresco va cada quince minutos, así que seis horas ya
 * significa que ese proceso no está corriendo, no que haya tardado un poco.
 */
const HORAS_ESPEJO_VIEJO = 6

// =====================================================
// El simulacro
// =====================================================

export function simular(entrada: EntradaSimulacro): Simulacro {
  const { cruce, listings, reglas, ahora } = entrada

  const espejo = new Map(listings.map((l) => [l.sku, l]))
  const precios = indicePrecios(entrada.lineas)
  const descripciones = new Map(entrada.lineas.map((l) => [l.articulo, l.descripcion]))

  const filas: FilaSimulacro[] = []
  const cambios: CambioPropuesto[] = []
  const avisos: string[] = []

  for (const row of cruce.rows) {
    const listing = espejo.get(row.sku) ?? null
    const fila = simularFila({
      row,
      listing,
      precio: precios.get(row.articulo) ?? null,
      descripcion: descripciones.get(row.articulo) ?? '',
      reglas,
    })
    filas.push(fila)

    // Los cambios se recogen del MISMO objeto que se ha pintado. Ver el
    // comentario de `cambios` arriba.
    if (fila.stock.cambia && fila.stock.nuevo !== null) {
      cambios.push({
        sku: fila.sku,
        campo: 'cantidad',
        valorNuevo: fila.stock.nuevo,
        valorAnterior: fila.stock.amazon,
      })
    }
    if (fila.precio.cambia && fila.precio.nuevo !== null) {
      cambios.push({
        sku: fila.sku,
        campo: 'precio',
        valorNuevo: fila.precio.nuevo,
        valorAnterior: fila.precio.amazon,
      })
    }
  }

  const huerfanos = buscarHuerfanos(listings, cruce.rows, entrada.skusDelMapeo)
  const resumen = resumir({ filas, huerfanos, cruce, listings })

  const frenos = evaluarFrenos({
    cambios,
    catalogo: {
      totalSku: listings.length,
      // El denominador es lo que el perfil gestiona, no el espejo entero: ver
      // el comentario de EstadoCatalogo.gestionados en frenos.ts.
      gestionados: resumen.skuGestionados,
      conStock: contarConStock(listings),
    },
    unidades: { nuevas: resumen.unidadesTotal, ahora: resumen.unidadesEnAmazon },
    lineasLeidas: entrada.lineasLeidas,
    umbrales: entrada.umbrales,
    moneda: entrada.moneda,
    precioMinimo: reglas.precioMinimo,
    precioMaximo: reglas.precioMaximo,
    exigirCompletos: entrada.envioAutomatico,
    ahora,
  })

  avisos.push(...avisosDe({ entrada, resumen, filas }))

  const mayoresSaltos = filas
    .filter((f) => f.precio.cambia && f.variacionPrecioPct !== null)
    .sort((a, b) => Math.abs(b.variacionPrecioPct ?? 0) - Math.abs(a.variacionPrecioPct ?? 0))
    .slice(0, MAX_SALTOS)

  return {
    filas,
    huerfanos,
    sinCasar: cruce.unmatched,
    resumen,
    cambios,
    frenos,
    mayoresSaltos,
    moneda: entrada.moneda,
    avisos,
    simuladoEn: ahora.toISOString(),
  }
}

// =====================================================
// Una fila
// =====================================================

function simularFila(params: {
  row: AmazonStockRow
  listing: AmazonListing | null
  precio: PrecioDeArticulo | null
  descripcion: string
  reglas: Pick<ReglasNegocio, 'enviarStock' | 'enviarPrecio'>
}): FilaSimulacro {
  const { row, listing, precio, descripcion, reglas } = params

  const base = {
    sku: row.sku,
    asin: row.asin ?? listing?.asin ?? null,
    titulo: listing?.title ?? null,
    articulo: row.articulo,
    refErp: row.refErp,
    descripcion,
    via: row.via,
    esFba: listing?.is_fba ?? false,
  }

  // Sin listing en el espejo no hay nada contra qué contrastar NI a dónde
  // escribir: sendChanges lo rechazaría por no tener product_type. Se enseña
  // igual, porque es un aviso real —el mapeo apunta a un SKU que Amazon ya no
  // tiene, o el catálogo está sin refrescar— y no un caso raro.
  if (!listing) {
    return {
      ...base,
      stock: vacio(null, reglas.enviarStock ? row.stock : null),
      precio: vacio(null, reglas.enviarPrecio ? (precio?.valor ?? null) : null),
      variacionPrecioPct: null,
      seVaACero: false,
      estado: 'sin_listing',
      motivo:
        'Este SKU no está en el espejo del catálogo de Amazon. O el mapeo apunta a un SKU que ya no existe, ' +
        'o el catálogo lleva sin refrescarse desde que se creó.',
    }
  }

  const stock = simularStock(row, listing, reglas.enviarStock)
  const precioCampo = simularPrecio(precio, listing, reglas.enviarPrecio)

  const variacionPrecioPct =
    precioCampo.nuevo !== null && precioCampo.amazon !== null && precioCampo.amazon > 0
      ? ((precioCampo.nuevo - precioCampo.amazon) / precioCampo.amazon) * 100
      : null

  const seVaACero = stock.cambia && stock.nuevo === 0 && (stock.amazon ?? 0) > 0

  return {
    ...base,
    stock,
    precio: precioCampo,
    variacionPrecioPct,
    seVaACero,
    estado: estadoDe(stock, precioCampo, reglas),
    motivo: motivoDe(stock, precioCampo, reglas, precio),
  }
}

function simularStock(
  row: AmazonStockRow,
  listing: AmazonListing,
  enviar: boolean
): CampoSimulado {
  const amazon = stockEfectivo(listing)
  if (!enviar) return vacio(amazon, null)

  const nuevo = row.stock

  // El tope de cordura es el mismo que aplica el envío (catalogo.ts). Si no se
  // mirara aquí, el simulacro prometería un cambio que sendChanges rechazaría
  // después, y el simulacro dejaría de ser fiable justo en el caso raro.
  if (nuevo > MAX_QUANTITY) {
    return {
      amazon,
      nuevo,
      cambia: false,
      bloqueado: true,
      motivoBloqueo: `Un stock de ${formatInt(nuevo)} unidades no se envía: el máximo son ${formatInt(MAX_QUANTITY)}. Repasa la columna del fichero.`,
    }
  }

  // canEditQuantity exige que CONSTE el canal del vendedor: un listing sin
  // canal conocido no se toca. Ver isMfnChannel() en lib/types/amazon.ts.
  if (!canEditQuantity(listing)) {
    return {
      amazon,
      nuevo,
      cambia: false,
      bloqueado: true,
      motivoBloqueo: whyNotEditable(listing, 'cantidad'),
    }
  }

  return {
    amazon,
    nuevo,
    cambia: !mismoValor(amazon, nuevo, 'cantidad'),
    bloqueado: false,
    motivoBloqueo: null,
  }
}

function simularPrecio(
  precio: PrecioDeArticulo | null,
  listing: AmazonListing,
  enviar: boolean
): CampoSimulado {
  const amazon = listing.price
  if (!enviar) return vacio(amazon, null)

  // El artículo trae varias líneas con precios distintos: no se elige uno a
  // ojo. Es el mismo criterio que usa el cruce con el stock (pickLine): varios
  // candidatos solo son un problema si NO coinciden, y cuando no coinciden se
  // descarta en vez de adivinar.
  if (precio?.ambiguo) {
    return {
      amazon,
      nuevo: null,
      cambia: false,
      bloqueado: true,
      motivoBloqueo:
        'El fichero trae varias líneas de este artículo con precios distintos. No se manda ninguno: habría que elegir a ojo.',
    }
  }

  const nuevo = precio?.valor ?? null
  if (nuevo === null) return vacio(amazon, null)

  if (nuevo > MAX_PRICE) {
    return {
      amazon,
      nuevo,
      cambia: false,
      bloqueado: true,
      motivoBloqueo: `Un precio de ${nuevo} no se envía: el máximo son ${MAX_PRICE}. Repasa la columna del fichero.`,
    }
  }

  if (!canEditPrice(listing)) {
    return {
      amazon,
      nuevo,
      cambia: false,
      bloqueado: true,
      motivoBloqueo: whyNotEditable(listing, 'precio'),
    }
  }

  return {
    amazon,
    nuevo,
    cambia: !mismoValor(amazon, nuevo, 'precio'),
    bloqueado: false,
    motivoBloqueo: null,
  }
}

function vacio(amazon: number | null, nuevo: number | null): CampoSimulado {
  return { amazon, nuevo, cambia: false, bloqueado: false, motivoBloqueo: null }
}

function estadoDe(
  stock: CampoSimulado,
  precio: CampoSimulado,
  reglas: Pick<ReglasNegocio, 'enviarStock' | 'enviarPrecio'>
): EstadoFila {
  if (stock.cambia || precio.cambia) return 'cambia'
  if (!reglas.enviarStock && !reglas.enviarPrecio) return 'sin_envio'
  if (stock.bloqueado || precio.bloqueado) return 'bloqueado'
  return 'igual'
}

function motivoDe(
  stock: CampoSimulado,
  precio: CampoSimulado,
  reglas: Pick<ReglasNegocio, 'enviarStock' | 'enviarPrecio'>,
  precioArticulo: PrecioDeArticulo | null
): string | null {
  if (stock.cambia || precio.cambia) return null

  if (!reglas.enviarStock && !reglas.enviarPrecio) {
    return 'El perfil no manda ni stock ni precio: solo lee y compara.'
  }
  // El bloqueo se cuenta antes que el «ya está igual»: es lo accionable.
  if (stock.bloqueado) return stock.motivoBloqueo
  if (precio.bloqueado) return precio.motivoBloqueo

  if (reglas.enviarPrecio && precio.nuevo === null && !precioArticulo) {
    return 'Este perfil manda precio y no se ha podido leer ninguno para este artículo.'
  }

  return 'Lo que dice el fichero es lo que Amazon ya tiene publicado.'
}

// =====================================================
// El precio, que viaja POR FUERA del cruce
// =====================================================

/**
 * EL PRECIO NO PASA POR DENTRO DEL CRUCE, Y ESO ES DELIBERADO.
 *
 * crossStock() está probado contra datos reales y es el activo más valioso del
 * módulo; meterle un campo nuevo obligaría a tocarlo. No hace falta: el cruce ya
 * arrastra en cada fila el `articulo` del que salió el stock, así que el precio
 * se vuelve a juntar con su SKU DESPUÉS, por ese mismo campo, y el resultado es
 * idéntico sin que el cruce se entere de que existe el precio.
 */
interface PrecioDeArticulo {
  valor: number | null
  /** Varias líneas del mismo artículo con precios distintos */
  ambiguo: boolean
}

function indicePrecios(lineas: LineaAplicada[]): Map<string, PrecioDeArticulo> {
  const out = new Map<string, PrecioDeArticulo>()

  for (const linea of lineas) {
    const previo = out.get(linea.articulo)
    if (!previo) {
      out.set(linea.articulo, { valor: linea.precioFinal, ambiguo: false })
      continue
    }
    if (previo.ambiguo) continue
    // Repetir el artículo no es un problema; repetirlo con OTRO precio sí.
    if (previo.valor !== linea.precioFinal) {
      out.set(linea.articulo, { valor: null, ambiguo: true })
    }
  }

  return out
}

// =====================================================
// Los huérfanos
// =====================================================

function buscarHuerfanos(
  listings: AmazonListing[],
  rows: AmazonStockRow[],
  skusDelMapeo: ReadonlySet<string>
): HuerfanoAmazon[] {
  const tocados = new Set(rows.map((r) => r.sku))

  return listings
    .filter((l) => !tocados.has(l.sku))
    .map((l) => ({
      sku: l.sku,
      asin: l.asin,
      titulo: l.title,
      stock: stockEfectivo(l),
      precio: l.price,
      esFba: l.is_fba,
      motivo: (skusDelMapeo.has(l.sku) ? 'no_casa' : 'sin_mapeo') as MotivoHuerfano,
    }))
    // Los que tienen unidades primero: son los que siguen vendiendo con un
    // stock que ya no se actualiza, y por tanto los únicos urgentes.
    .sort((a, b) => (b.stock ?? 0) - (a.stock ?? 0) || a.sku.localeCompare(b.sku, 'es'))
}

function contarConStock(listings: AmazonListing[]): number {
  return listings.filter((l) => (stockEfectivo(l) ?? 0) > 0).length
}

// =====================================================
// Las cuentas
// =====================================================

function resumir(params: {
  filas: FilaSimulacro[]
  huerfanos: HuerfanoAmazon[]
  cruce: CrossResult
  listings: AmazonListing[]
}): ResumenSimulacro {
  const { filas, huerfanos, cruce, listings } = params

  const sinCasarPorMotivo: Record<UnmatchedReason, number> = {
    sin_referencia: 0,
    sin_articulo: 0,
    ref_ambigua: 0,
    ean_ambiguo: 0,
    sku_vacio: 0,
  }
  for (const u of cruce.unmatched) sinCasarPorMotivo[u.reason]++

  let skuCambian = 0
  let stockSuben = 0
  let stockBajan = 0
  let stockACero = 0
  let stockIgual = 0
  let unidadesTotal = 0
  let unidadesEnAmazon = 0
  let skuGestionados = 0
  let precioCambian = 0
  let precioSuben = 0
  let precioBajan = 0
  let bloqueados = 0
  let sinListing = 0

  for (const f of filas) {
    if (f.estado === 'cambia') skuCambian++
    if (f.estado === 'bloqueado') bloqueados++
    if (f.estado === 'sin_listing') sinListing++

    // Las unidades que QUEDARÍAN PUBLICADAS, que no es lo mismo que las que
    // trae el fichero (eso ya lo da cruce.stats.totalUnits). Se dejan fuera las
    // que no se pueden escribir y las que no tienen listing: contarlas diría
    // que se van a publicar unidades que no se van a publicar.
    const escribible = f.estado !== 'sin_listing' && !f.stock.bloqueado
    if (f.stock.nuevo !== null && escribible) {
      unidadesTotal += f.stock.nuevo
      // Sobre EL MISMO conjunto, para que la caída de unidades compare peras
      // con peras. Un listing sin cantidad conocida cuenta como 0: es lo
      // prudente aquí, porque inflar el «antes» inventaría una caída.
      unidadesEnAmazon += f.stock.amazon ?? 0
    }

    // Gestionado = el fichero lo resuelve Y Amazon lo tiene. Los 'sin_listing'
    // quedan fuera a propósito: no se les puede escribir nada, así que no
    // pueden formar parte del denominador de «cuántos se irían a cero».
    if (f.estado !== 'sin_listing') skuGestionados++

    if (f.stock.cambia && f.stock.nuevo !== null) {
      const antes = f.stock.amazon ?? 0
      if (f.seVaACero) stockACero++
      else if (f.stock.nuevo > antes) stockSuben++
      else if (f.stock.nuevo < antes) stockBajan++
    } else if (f.stock.nuevo !== null && escribible) {
      // «Igual» significa que Amazon ya tiene lo que dice el fichero. Un SKU sin
      // listing NO es igual —no hay contra qué compararlo— y meterlo aquí haría
      // que un catálogo sin refrescar pareciera un catálogo ya al día.
      stockIgual++
    }

    if (f.precio.cambia && f.precio.nuevo !== null) {
      precioCambian++
      const antes = f.precio.amazon
      // Sin precio anterior no sube ni baja: estrenar precio no es subirlo. Por
      // eso `precioSuben + precioBajan` puede ser menor que `precioCambian`.
      if (antes !== null) {
        if (f.precio.nuevo > antes) precioSuben++
        else if (f.precio.nuevo < antes) precioBajan++
      }
    }
  }

  return {
    skuEnFichero: filas.length,
    skuCambian,
    stockSuben,
    stockBajan,
    stockACero,
    stockIgual,
    unidadesTotal,
    precioCambian,
    precioSuben,
    precioBajan,
    sinCasar: cruce.unmatched.length,
    sinCasarPorMotivo,
    huerfanos: huerfanos.length,
    huerfanosConStock: huerfanos.filter((h) => (h.stock ?? 0) > 0).length,
    bloqueados,
    sinListing,
    skuEnAmazon: listings.length,
    skuGestionados,
    unidadesEnAmazon,
  }
}

/**
 * Los avisos que no frenan nada pero conviene leer antes de encender el envío.
 *
 * Son distintos de los frenos: un freno PARA el envío; esto son cosas que
 * pueden estar bien y pueden ser el síntoma de un perfil a medio configurar.
 */
function avisosDe(params: {
  entrada: EntradaSimulacro
  resumen: ResumenSimulacro
  filas: FilaSimulacro[]
}): string[] {
  const { entrada, resumen, filas } = params
  const avisos: string[] = []

  /**
   * EL CLIENTE NO TIENE MAPEO, QUE ES OTRA COSA MUY DISTINTA.
   *
   * Sin filas en stock_mappings el cruce no devuelve nada y TODOS los listings
   * de Amazon caen en huérfanos: el simulacro sale vacío y el único aviso que
   * saltaba culpaba al volcado del cliente («el fichero no menciona estos
   * SKU») cuando la causa es que no hay diccionario de referencia a SKU. Es el
   * estado por defecto de cualquier cliente al que se le crea el perfil antes
   * de importar el mapeo, o sea el orden natural de quien entra por aquí.
   */
  const sinMapeo = entrada.filasDeMapeo === 0
  if (sinMapeo && !entrada.mapeoAutomatico) {
    avisos.push(
      'Este cliente no tiene ninguna fila de mapeo activa en Sincronismo de stock, así que no hay forma de ' +
        'saber qué SKU de Amazon le corresponde a cada referencia del fichero. Impórtalo antes de dar nada por bueno: ' +
        'hasta entonces este simulacro no puede decir nada.'
    )
  }

  /**
   * SE HA CRUZADO CONTRA EL CATÁLOGO Y HAY QUE DECIRLO.
   *
   * No es un fallo —es el modo normal del cliente que usa su referencia como
   * SKU en Amazon— pero sí es una SUPOSICIÓN, y quien mire esta pantalla tiene
   * que saber sobre qué se ha decidido. Va con los números delante porque el
   * único dato que importa aquí es cuántos han casado: si de 300 listings casan
   * 4, la suposición es falsa y este cliente necesita su tabla de mapeo.
   */
  if (entrada.mapeoAutomatico && entrada.filasDeMapeo > 0) {
    const casados = resumen.skuEnFichero
    const pct = Math.round((casados / entrada.filasDeMapeo) * 100)
    avisos.push(
      `Este cliente no tiene tabla de mapeo, así que se ha cruzado la REFERENCIA del fichero contra el ` +
        `SKU de Amazon tal cual: han casado ${casados} de los ${entrada.filasDeMapeo} SKU del catálogo (${pct} %). ` +
        'El resto del fichero —las referencias que este cliente no vende en Amazon— no se toca. ' +
        (pct < 25
          ? 'Ese porcentaje es bajo: lo más probable es que sus SKU de Amazon no sean su referencia del ERP, ' +
            'y entonces hace falta importar el mapeo en Sincronismo de stock antes de mandar nada.'
          : 'Los que no casan salen abajo como huérfanos, con el motivo de cada uno.')
    )
  }

  if (resumen.skuEnAmazon === 0) {
    avisos.push(
      entrada.conDestino === false
        ? 'Este perfil todavía no apunta a ninguna conexión de Amazon, así que no hay catálogo contra el que contrastar. ' +
          'El simulacro solo puede enseñar qué lee del fichero y qué casa con el mapeo.'
        : 'El espejo del catálogo de Amazon está vacío para este cliente y este país: no hay contra qué contrastar. ' +
          'Refresca el catálogo en la pestaña de Amazon antes de dar nada por bueno.'
    )
  } else if (entrada.espejoRefrescadoEn) {
    // Contrastar contra una foto de hace días es peor que no contrastar: se ve
    // igual de verde y propone cambios calculados sobre precios y stocks que ya
    // no son los de la tienda.
    const horas = (entrada.ahora.getTime() - new Date(entrada.espejoRefrescadoEn).getTime()) / 3_600_000
    if (Number.isFinite(horas) && horas > HORAS_ESPEJO_VIEJO) {
      avisos.push(
        `El espejo del catálogo de Amazon lleva ${Math.floor(horas)} horas sin refrescarse. ` +
          'Lo que se enseña aquí está contrastado contra esa foto, no contra lo que la tienda tiene ahora: ' +
          'comprueba que el proceso de sincronización de Amazon está corriendo.'
      )
    }
  }

  // Con el mapeo vacío, el aviso de huérfanos sería redundante y engañoso: los
  // huérfanos son TODO el catálogo, y la causa ya está dicha arriba.
  if (resumen.huerfanosConStock > 0 && !sinMapeo) {
    avisos.push(
      `Hay ${formatInt(resumen.huerfanosConStock)} ${resumen.huerfanosConStock === 1 ? 'SKU' : 'SKU'} con unidades publicadas en Amazon que el fichero no menciona. ` +
        'Ese stock se quedará como está indefinidamente: si el artículo ya no existe en el ERP del cliente, seguirá vendiéndose.'
    )
  }

  if (resumen.sinListing > 0) {
    avisos.push(
      `${formatInt(resumen.sinListing)} SKU del mapeo no están en el espejo del catálogo. ` +
        'Puede ser que el catálogo esté sin refrescar, o que esos listings ya no existan en Amazon.'
    )
  }

  const porEanListing = filas.filter((f) => f.via === 'ean_listing' && f.estado === 'cambia').length
  if (porEanListing > 0) {
    avisos.push(
      `${formatInt(porEanListing)} de los cambios casaron solo por el EAN del listing de Amazon, no por el del ERP del cliente. ` +
        'Ese EAN identifica el producto del catálogo de Amazon, no necesariamente el artículo que el cliente tiene en su almacén: conviene mirarlos.'
    )
  }

  if (entrada.reglas.enviarPrecio && resumen.precioCambian === 0 && resumen.skuEnFichero > 0) {
    avisos.push(
      'El perfil manda precio y no cambiaría ninguno. Comprueba que la columna de precio del perfil es la que trae el fichero.'
    )
  }

  if (resumen.bloqueados > 0) {
    avisos.push(
      `${formatInt(resumen.bloqueados)} SKU tienen algo que cambiar y no se puede escribir (normalmente FBA, o sin tipo de producto conocido). ` +
        'No se intentarán: un cambio que Amazon ignora se registraría como enviado igualmente.'
    )
  }

  // Los avisos del cruce se arrastran tal cual: ya están escritos en español y
  // dicen cosas que aquí no se pueden saber (SKU duplicados en el mapeo,
  // referencias ambiguas al normalizar).
  avisos.push(...entrada.cruce.stats.warnings)

  return avisos
}
