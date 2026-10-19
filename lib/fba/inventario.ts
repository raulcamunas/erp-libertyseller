import { repartirSku, type Movimiento, type Remesa, type LineaRemesa } from './fifo'
import type { EdadAmazonSku, ResumenEdadAmazon } from './planificacion'

/**
 * EL INVENTARIO FBA DE UN CLIENTE, ENTERO: QUÉ HAY, CUÁNTO SE VENDE, CUÁNTO LLEVA PARADO.
 * =======================================================================================
 * PURO: no toca la base ni la red. Entran los hechos —el stock que Amazon dice tener, el
 * libro mayor de movimientos y los envíos del ERP— y sale el panel. Se comprueba con
 * inventario.prueba.ts.
 *
 * Lo usan DOS cosas y las dos tienen que ver los MISMOS números: la pantalla «Inventario»
 * del cliente y el motor de propuestas con IA (lib/fba/reposicion.ts). Si cada una
 * calculara su ritmo de venta por su lado, la IA propondría mandar 40 unidades de algo que
 * la pantalla enseña con 200 días de stock, y nadie sabría cuál de las dos tiene razón.
 *
 *
 * ============ DE DÓNDE SALE CADA COSA ============
 *
 *   QUÉ HAY AHORA         el espejo de Amazon (`amazon_listings`): total en la red, que
 *                         INCLUYE lo que viene de camino, y lo vendible ahora mismo.
 *   VENTAS Y DEVOLUCIONES el libro mayor de inventario (`fba_movimientos`): `Shipments` son
 *                         ventas y `CustomerReturns` devoluciones. Es lo único que Amazon
 *                         entrega con día y por SKU.
 *   LA EDAD DEL STOCK     el reparto FIFO (lib/fba/fifo.ts) con lotes sacados de las ENTRADAS
 *                         del propio libro (`Receipts`): cada llegada es un lote con su día, y
 *                         las ventas se llevan el lote más antiguo primero. Es la misma
 *                         convención que usa Amazon para su informe de antigüedad. Se
 *                         probó contra el stock real: con lotes de las entradas, cuadra en
 *                         291 de 292 referencias de ShoesF.
 *   LO QUE VIENE DE CAMINO los envíos registrados en el ERP que Amazon todavía no ha
 *                         terminado de recibir.
 *
 * No hace falta que el cliente tenga envíos registrados en el ERP: el libro trae las
 * entradas de TODO lo que llegó a Amazon, lo registrara alguien o no.
 *
 *
 * ============ LO QUE NO SE SABE SE DICE ============
 *
 *   · El libro solo llega hasta donde se empezó a leer. El stock que ya estaba en Amazon
 *     antes de esa fecha no tiene lote y NO se reparte por tramos de edad: va aparte, como
 *     `anteriorALaLectura`, con la edad mínima que se puede afirmar (los días que lleva el
 *     libro). Meterlo en el primer tramo sería mentir a favor del cliente.
 *   · El FIFO es una convención contable nuestra, no un hecho: Amazon mezcla la mercancía.
 *     Cuando los lotes suman más de lo que Amazon dice tener, el sobrante se quita de los
 *     lotes MÁS ANTIGUOS (es lo que se habrá vendido sin que el libro lo cuente) y se
 *     avisa en `descuadre`.
 *   · El ritmo no corrige los días sin stock: un producto que se agotó dos semanas de las
 *     últimas cuatro parece que se vende la mitad. `diasSinVenta` y el estado lo dejan ver.
 */

/* ------------------------------------------------------------------ */
/* Entrada                                                             */
/* ------------------------------------------------------------------ */

export interface ListingInventario {
  sku: string
  asin: string | null
  /** El código de barras de Amazon, el que va en la etiqueta. Hace falta para montar un envío */
  fnsku?: string | null
  titulo: string | null
  precio: number | null
  moneda: string | null
  /** Total en la red de Amazon, incluido lo que viene de camino. null = no se ha preguntado */
  enAmazon: number | null
  /** Lo que se puede vender ahora mismo. null = no se ha preguntado */
  vendibles: number | null
}

export interface MovimientoInventario extends Movimiento {
  /** En las entradas (`Receipts`), el identificador del envío de Amazon */
  referencia?: string | null
}

export interface EnvioInventario {
  id: string
  nombre: string | null
  /** 'YYYY-MM-DD' */
  fechaEnvio: string
  llegadaAt: string | null
  /** WORKING, SHIPPED, IN_TRANSIT, CLOSED… tal y como lo llama Amazon */
  estadoAmazon: string | null
  /** El paso de la propuesta en el ERP: borrador, aprobada, encajando, lista, enviada o cerrada */
  estado: string
  referenciaEnvio: string | null
  lineas: Array<{ sku: string; unidades: number; recibidas: number | null }>
}

export interface UmbralesInventario {
  /** Cobertura a partir de la cual hay que reponer YA: lo que tarda un envío en llegar */
  plazoCritico: number
  /** Por debajo de esto, stock bajo */
  coberturaBaja: number
  /** Por encima de esto, exceso */
  coberturaExceso: number
  /** Días sin venta a partir de los cuales hay stock parado */
  diasParado: number
}

export const UMBRALES_POR_DEFECTO: UmbralesInventario = {
  plazoCritico: 14,
  coberturaBaja: 30,
  coberturaExceso: 120,
  diasParado: 60,
}

export interface EntradaInventario {
  /** 'YYYY-MM-DD' */
  hoy: string
  listings: ListingInventario[]
  movimientos: MovimientoInventario[]
  envios: EnvioInventario[]
  /** Hasta qué día se ha leído el libro mayor. Las ventas de después no están. null = no se sabe */
  leidoHasta: string | null
  umbrales?: Partial<UmbralesInventario>
}

/* ------------------------------------------------------------------ */
/* Salida                                                              */
/* ------------------------------------------------------------------ */

/** Los tramos de antigüedad de Amazon: lo que más pesa en las tarifas de almacenaje */
export const TRAMOS_EDAD = [
  { id: 't0', texto: '0-90 días', desde: 0, hasta: 90 },
  { id: 't91', texto: '91-180', desde: 91, hasta: 180 },
  { id: 't181', texto: '181-270', desde: 181, hasta: 270 },
  { id: 't271', texto: '271-365', desde: 271, hasta: 365 },
  { id: 't366', texto: 'Más de 365', desde: 366, hasta: Number.POSITIVE_INFINITY },
] as const

export type IdTramo = (typeof TRAMOS_EDAD)[number]['id']
export type PorTramo = Record<IdTramo, number>

export const tramoDe = (edadDias: number): IdTramo =>
  TRAMOS_EDAD.find((t) => edadDias >= t.desde && edadDias <= t.hasta)?.id ?? 't366'

export type EstadoSku = 'agotado' | 'urgente' | 'bajo' | 'ok' | 'exceso' | 'parado' | 'sin_ventas' | 'sin_datos'

export type Tendencia = 'sube' | 'estable' | 'baja'

export interface LoteInventario {
  /** El día que llegó a Amazon */
  desde: string
  /** El envío de Amazon al que pertenece (FBA15…), si el libro lo dice */
  referencia: string | null
  /** Cómo lo llama el equipo, si ese envío está en el ERP */
  nombreEnvio: string | null
  recibidas: number
  /** Lo que queda ahora, ya ajustado al stock real */
  quedan: number
  edadDias: number
}

export interface SkuInventario {
  sku: string
  asin: string | null
  fnsku: string | null
  nombre: string | null
  precio: number | null
  moneda: string | null

  /* --- qué hay ahora --- */
  /** Total en la red de Amazon, con lo que viene de camino */
  enAmazon: number
  /** Lo que se vende ahora mismo */
  vendibles: number
  /** Registrado en el ERP y todavía sin recibir del todo */
  entrante: number
  /**
   * En la red de Amazon y no vendible ahora: total − vendible − lo registrado de camino.
   * Puede ser mercancía en tránsito que nadie registró en el ERP, reservada para un pedido
   * o un traslado, o dañada: el espejo del catálogo solo trae el total y lo vendible, así que
   * desde aquí no se pueden separar. Si es mucho, hay que mirarlo en Seller Central.
   */
  noDisponibles: number

  /* --- ventas y devoluciones (unidades) --- */
  vendidas: { d7: number; d14: number; d30: number; d60: number; d90: number }
  devueltas: { d30: number; d90: number }
  /** Devueltas / vendidas en 90 días. null si no hay ventas */
  tasaDevolucion90: number | null

  /* --- ritmo --- */
  ritmo7: number
  ritmo30: number
  ritmo90: number
  /** El ritmo con el que se calcula la cobertura y se planifica: mezcla de 14 y 30 días */
  ritmoPlan: number
  tendencia: Tendencia | null
  /** Menos de dos semanas en Amazon o menos de tres ventas en 30 días: el ritmo es poco fiable */
  muestraCorta: boolean
  /** Las ventas de cada uno de los últimos 90 días, de más antiguo a más reciente. null si no ha vendido */
  serie90: number[] | null
  ultimaVenta: string | null
  diasSinVenta: number | null
  primeraEntrada: string | null

  /* --- edad --- */
  lotes: LoteInventario[]
  edadMediaDias: number | null
  edadMaxDias: number | null
  porTramo: PorTramo
  /**
   * Unidades VENDIBLES que ya estaban antes de empezar el libro: sin lote y sin tramo.
   * Se cuentan sobre lo vendible y no sobre el total, para no confundir stock antiguo con
   * mercancía de camino o reservada.
   */
  anteriorALaLectura: number
  /** Cuánto tardan las unidades en venderse desde que llegan, de media */
  diasMedioDeVenta: number | null
  retiradas: number
  mermas: number
  /** Stock real − lo que explican las entradas y los envíos. Positivo: hay más de lo explicado */
  descuadre: number | null

  /* --- cobertura --- */
  cobertura: number | null
  seAgotaEl: string | null

  /* --- valor --- */
  valorStock: number | null
  valorVentas30: number | null

  estado: EstadoSku
  alertas: string[]
  /**
   * La antigüedad que cuenta Amazon, si se ha leído su informe de planificación. No sale del libro
   * mayor: la pone quien lee la base DESPUÉS de calcular (lib/fba/inventario-datos.ts). null = ese
   * SKU no sale en el informe (sin stock)
   */
  edadAmazon?: EdadAmazonSku | null
}

export interface DiaVentas {
  fecha: string
  vendidas: number
  devueltas: number
}

export interface ResumenInventario {
  unidadesEnAmazon: number
  vendibles: number
  entrante: number
  noDisponibles: number
  /** Stock a precio de venta. Solo cuenta lo que tiene precio: `sinPrecio` dice cuántas no */
  valorStock: number
  sinPrecio: number
  vendidas30: number
  valorVentas30: number
  ritmo30: number
  /** Días que dura todo el stock vendible al ritmo de planificación */
  coberturaMedia: number | null
  vendidas90: number
  devueltas90: number
  tasaDevolucion90: number | null
  referencias: number
  agotadas: number
  urgentes: number
  paradas: number
  paradasUnidades: number
  paradasValor: number
  exceso: number
  edadMediaDias: number | null
  porTramo: PorTramo
  valorPorTramo: PorTramo
  anteriorALaLectura: number
  /** Unidades con más de 270 días: la zona donde Amazon empieza a cobrar de más */
  unidadesAntiguas: number
  /** Referencias con alguna unidad en la red de Amazon que no se puede vender ahora */
  conNoVendibles: number
  enviosEnCamino: number
}

export interface InventarioCliente {
  hoy: string
  /** Hasta dónde llegan las ventas */
  leidoHasta: string | null
  /** Desde dónde hay libro mayor */
  libroDesde: string | null
  /** Los días que cubre el libro. Es la edad mínima del stock anterior */
  diasDeLibro: number | null
  /**
   * Cuánto se puede fiar uno del libro: `sin_leer` = todavía no hay ni un movimiento (no se
   * sabe nada de ventas ni de edad), `corto` = cubre menos de 90 días (las ventas de 90 días
   * y la edad del stock están a medias), `ok` = cubre lo que hace falta.
   */
  libro: 'ok' | 'corto' | 'sin_leer'
  skus: SkuInventario[]
  resumen: ResumenInventario
  /** Ventas y devoluciones del cliente día a día, sin huecos, de los últimos 90 días */
  porDia: DiaVentas[]
  avisos: string[]
}

/** Lo que devuelve la ruta: el inventario y si el cliente tiene de dónde sacarlo */
export interface InventarioDeCliente extends InventarioCliente {
  /** El cliente tiene una conexión de Amazon activa. Sin ella no hay libro ni stock */
  conectado: boolean
  marketplaceId: string | null
  /** La conexión de la que sale todo. Es la que se pide volver a leer (POST /api/fba/sincronizar) */
  conexionId: string | null
  /**
   * La antigüedad del stock TAL Y COMO LA CUENTA AMAZON (su informe de planificación), con la que se
   * dibuja la tarjeta de antigüedad. null = todavía no se ha leído: el panel enseña entonces la que
   * se estima del libro mayor, con sus límites.
   */
  edadAmazon: ResumenEdadAmazon | null
  /** Cómo va la lectura de ese informe: si existe la tabla (migración 231), cuándo se leyó y por qué falló */
  planificacion: { tabla: boolean; leidoAt: string | null; error: string | null }
  /** El último intento de leer el libro mayor y si falló. null = ni se ha intentado */
  lectura: { intentoAt: string | null; error: string | null } | null
}

/* ------------------------------------------------------------------ */
/* Fechas                                                              */
/* ------------------------------------------------------------------ */

const DIA = 86_400_000
const aMs = (f: string) => Date.parse(`${f.slice(0, 10)}T00:00:00Z`)
const aFecha = (ms: number) => new Date(ms).toISOString().slice(0, 10)
/**
 * Los dos avisos a los que la pantalla añade el botón de leer el libro de Amazon. Se reconocen
 * por su principio, y por eso las dos pantallas —la que los escribe y la que los acompaña—
 * usan estas constantes y no el texto.
 */
export const AVISO_LIBRO_SIN_LEER = 'Todavía no se ha leído el libro mayor de Amazon'
export const AVISO_VENTAS_ATRASADAS = 'Las ventas están leídas hasta el'
/** El aviso de la edad estimada del libro: con la antigüedad que da Amazon ya no hace falta */
export const AVISO_ANTERIOR_AL_LIBRO = 'ya estaban en Amazon antes de empezar el libro'

export const sumarDiasInv = (f: string, n: number) => aFecha(aMs(f) + n * DIA)
export const diasEntreInv = (desde: string, hasta: string) => Math.round((aMs(hasta) - aMs(desde)) / DIA)

const redondea = (n: number, dec = 2) => Math.round(n * 10 ** dec) / 10 ** dec
/** «2026-10-14» → «14/10/2026»: así se lee en un aviso */
const dmy = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`

const tramosVacios = (): PorTramo => ({ t0: 0, t91: 0, t181: 0, t271: 0, t366: 0 })

/** Los estados de Amazon en los que un envío todavía no está terminado de recibir */
const ENVIO_VIVO = new Set(['WORKING', 'READY_TO_SHIP', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CHECKED_IN', 'RECEIVING'])
/** Y aquellos en los que `unidades_recibidas` ya se puede creer (ver recepcionContada en fifo.ts) */
const RECEPCION_EN_MARCHA = new Set(['CHECKED_IN', 'RECEIVING'])

/* ------------------------------------------------------------------ */
/* Lotes a partir de las entradas del libro                            */
/* ------------------------------------------------------------------ */

interface Lote {
  id: string
  fecha: string
  referencia: string | null
  unidades: number
}

/**
 * Las llegadas de un SKU, agrupadas por envío.
 *
 * Una caja de un mismo envío puede entrar en días distintos, y `Receipts` puede traer
 * cantidades NEGATIVAS (reversiones). Se suma por envío —o por día, si el libro no dice
 * de qué envío es— y el lote lleva el día de la primera entrada. Un envío cuyas
 * entradas y reversiones se anulan no es un lote.
 */
function lotesDe(sku: string, entradas: MovimientoInventario[]): Lote[] {
  const grupos = new Map<string, { fecha: string; referencia: string | null; neto: number }>()
  for (const m of entradas) {
    const clave = m.referencia?.trim() ? m.referencia.trim() : `@${m.fecha}`
    const g = grupos.get(clave)
    if (!g) grupos.set(clave, { fecha: m.fecha, referencia: m.referencia?.trim() || null, neto: m.cantidad })
    else {
      g.neto += m.cantidad
      if (m.fecha < g.fecha) g.fecha = m.fecha
    }
  }
  return [...grupos.entries()]
    .filter(([, g]) => g.neto > 0)
    .map(([clave, g]) => ({ id: `${sku}|${clave}`, fecha: g.fecha, referencia: g.referencia, unidades: g.neto }))
    .sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : a.id.localeCompare(b.id)))
}

/* ------------------------------------------------------------------ */
/* El cálculo                                                          */
/* ------------------------------------------------------------------ */

export function calcularInventario(entrada: EntradaInventario): InventarioCliente {
  const u: UmbralesInventario = { ...UMBRALES_POR_DEFECTO, ...entrada.umbrales }
  const { hoy } = entrada
  // Las ventas llegan hasta donde se ha leído el libro, no hasta hoy: contar el día de hoy
  // en el divisor sin sus ventas rebajaría el ritmo de todo el catálogo un 3 %.
  const fin = entrada.leidoHasta && entrada.leidoHasta <= hoy ? entrada.leidoHasta : hoy
  const avisos: string[] = []

  /* ---------- el libro, ordenado por SKU ---------- */
  const porSku = new Map<string, MovimientoInventario[]>()
  let libroDesde: string | null = null
  for (const m of entrada.movimientos) {
    const l = porSku.get(m.sku)
    if (l) l.push(m)
    else porSku.set(m.sku, [m])
    if (libroDesde === null || m.fecha < libroDesde) libroDesde = m.fecha
  }
  const diasDeLibro = libroDesde ? Math.max(0, diasEntreInv(libroDesde, hoy)) : null
  // Sin ningún movimiento no se sabe NADA de ventas: decir «parado» de un stock del que no hay
  // libro sería inventarse una acusación. Se declara aparte y las pantallas lo cuentan.
  const hayLibro = entrada.leidoHasta !== null && libroDesde !== null
  const libro: InventarioCliente['libro'] = !hayLibro ? 'sin_leer' : (diasDeLibro ?? 0) < 90 ? 'corto' : 'ok'

  /* ---------- lo que viene de camino, por SKU ---------- */
  const entrante = new Map<string, number>()
  const enviosEnCamino = new Set<string>()
  const nombreDeEnvio = new Map<string, string>()
  for (const e of entrada.envios) {
    if (e.referenciaEnvio && e.nombre) nombreDeEnvio.set(e.referenciaEnvio.trim(), e.nombre)
    // Solo los envíos que existen en Amazon y no han terminado de llegar. Una propuesta
    // todavía no ha salido; un envío cerrado ya está en el libro.
    if (e.estado !== 'enviada' || !e.estadoAmazon || !ENVIO_VIVO.has(e.estadoAmazon)) continue
    enviosEnCamino.add(e.id)
    for (const l of e.lineas) {
      const yaRecibidas = RECEPCION_EN_MARCHA.has(e.estadoAmazon) ? (l.recibidas ?? 0) : 0
      const faltan = Math.max(0, l.unidades - yaRecibidas)
      if (faltan > 0) entrante.set(l.sku, (entrante.get(l.sku) ?? 0) + faltan)
    }
  }

  /* ---------- la serie de ventas del cliente, día a día ---------- */
  const desde90 = sumarDiasInv(fin, -89)
  const serie = new Map<string, DiaVentas>()
  for (let i = 0; i < 90; i += 1) {
    const f = sumarDiasInv(desde90, i)
    serie.set(f, { fecha: f, vendidas: 0, devueltas: 0 })
  }

  /* ---------- los SKU a calcular: los que tienen stock o han vendido ---------- */
  const listings = new Map(entrada.listings.map((l) => [l.sku, l]))
  const skusConMovimiento = new Set<string>()
  for (const [sku, movs] of porSku) {
    if (movs.some((m) => m.tipo === 'Shipments' || m.tipo === 'CustomerReturns' || m.tipo === 'Receipts')) skusConMovimiento.add(sku)
  }
  const todos = new Set<string>([...listings.keys(), ...skusConMovimiento, ...entrante.keys()])

  const skus: SkuInventario[] = []
  for (const sku of todos) {
    const movs = porSku.get(sku) ?? []
    const listing = listings.get(sku) ?? null

    /* --- ventas y devoluciones por ventana --- */
    const vend = { d7: 0, d14: 0, d30: 0, d60: 0, d90: 0 }
    const dev = { d30: 0, d90: 0 }
    let ultimaVenta: string | null = null
    let primeraEntrada: string | null = null
    const dias90 = new Array<number>(90).fill(0)
    for (const m of movs) {
      const n = Math.abs(m.cantidad)
      if (m.tipo === 'Receipts' && m.cantidad > 0 && (primeraEntrada === null || m.fecha < primeraEntrada)) primeraEntrada = m.fecha
      if (m.fecha > fin) continue
      const edad = diasEntreInv(m.fecha, fin) // 0 = el último día leído
      if (m.tipo === 'Shipments') {
        if (ultimaVenta === null || m.fecha > ultimaVenta) ultimaVenta = m.fecha
        if (edad < 7) vend.d7 += n
        if (edad < 14) vend.d14 += n
        if (edad < 30) vend.d30 += n
        if (edad < 60) vend.d60 += n
        if (edad < 90) {
          vend.d90 += n
          dias90[89 - edad] += n
        }
        const d = serie.get(m.fecha)
        if (d) d.vendidas += n
      } else if (m.tipo === 'CustomerReturns') {
        if (edad < 30) dev.d30 += n
        if (edad < 90) dev.d90 += n
        const d = serie.get(m.fecha)
        if (d) d.devueltas += n
      }
    }

    /* --- el ritmo: se divide por los días que el producto lleva en Amazon, no por la ventana --- */
    const diasEnAmazon = primeraEntrada ? Math.max(1, diasEntreInv(primeraEntrada, fin) + 1) : (libroDesde ? Math.max(1, diasEntreInv(libroDesde, fin) + 1) : 90)
    const ritmoEn = (ventas: number, ventana: number) => ventas / Math.max(1, Math.min(ventana, diasEnAmazon))
    const ritmo7 = ritmoEn(vend.d7, 7)
    const ritmo14 = ritmoEn(vend.d14, 14)
    const ritmo30 = ritmoEn(vend.d30, 30)
    const ritmo60 = ritmoEn(vend.d60, 60)
    const ritmo90 = ritmoEn(vend.d90, 90)
    const ritmoPlan = 0.6 * ritmo30 + 0.4 * ritmo14

    let tendencia: Tendencia | null = null
    if (vend.d60 >= 5) {
      if (ritmo60 === 0) tendencia = ritmo14 > 0 ? 'sube' : null
      else {
        const r = ritmo14 / ritmo60
        tendencia = r >= 1.3 ? 'sube' : r <= 0.7 ? 'baja' : 'estable'
      }
    }
    const muestraCorta = diasEnAmazon < 14 || vend.d30 < 3

    /* --- los lotes, con el reparto FIFO --- */
    const lotes = lotesDe(sku, movs.filter((m) => m.tipo === 'Receipts'))
    const remesas = new Map<string, Remesa>(
      lotes.map((l) => [l.id, { id: l.id, fechaEnvio: l.fecha, fechaLlegada: l.fecha, recepcionContada: true }])
    )
    const lineas: LineaRemesa[] = lotes.map((l) => ({ remesaId: l.id, sku, unidades: l.unidades, recibidas: l.unidades }))
    // Solo hasta el último día leído: una entrada o una venta posteriores no existen todavía
    const reparto = repartirSku(sku, lineas, remesas, movs.filter((m) => m.fecha <= fin), { hoy: fin })
    const repartoPorLote = new Map(reparto.lineas.map((l) => [l.remesaId, l]))

    /* --- lo que hay de verdad, y lo que explican los lotes --- */
    const enviosDelSku = entrante.get(sku) ?? 0
    const enAmazon = listing?.enAmazon ?? reparto.quedan
    const enAlmacen = Math.max(0, enAmazon - enviosDelSku)
    const vendibles = listing?.vendibles ?? reparto.quedanVendibles
    const noDisponibles = Math.max(0, enAmazon - vendibles - enviosDelSku)

    // Las vivas ahora, de la más antigua a la más nueva
    const vivos = lotes
      .map((l) => ({ lote: l, quedan: repartoPorLote.get(l.id)?.quedan ?? 0 }))
      .filter((v) => v.quedan > 0)
    let explicado = vivos.reduce((s, v) => s + v.quedan, 0)

    // Si los lotes explican MÁS de lo que Amazon tiene, lo que sobra se habrá vendido sin
    // que el libro lo cuente. Se quita de los más antiguos: es lo que Amazon vende primero.
    let sobra = listing?.enAmazon != null ? Math.max(0, explicado - enAlmacen) : 0
    for (const v of vivos) {
      if (sobra <= 0) break
      const quita = Math.min(v.quedan, sobra)
      v.quedan -= quita
      sobra -= quita
    }
    explicado = vivos.reduce((s, v) => s + v.quedan, 0)

    const lotesVivos: LoteInventario[] = vivos
      .filter((v) => v.quedan > 0)
      .map((v) => ({
        desde: v.lote.fecha,
        referencia: v.lote.referencia,
        nombreEnvio: v.lote.referencia ? (nombreDeEnvio.get(v.lote.referencia) ?? null) : null,
        recibidas: v.lote.unidades,
        quedan: v.quedan,
        edadDias: Math.max(0, diasEntreInv(v.lote.fecha, hoy)),
      }))

    const porTramo = tramosVacios()
    for (const l of lotesVivos) porTramo[tramoDe(l.edadDias)] += l.quedan
    const edadMediaDias = explicado > 0 ? redondea(lotesVivos.reduce((s, l) => s + l.quedan * l.edadDias, 0) / explicado, 1) : null
    const edadMaxDias = lotesVivos.length > 0 ? Math.max(...lotesVivos.map((l) => l.edadDias)) : null

    // El stock VENDIBLE que no tiene lote: ya estaba antes de empezar el libro (o llegó sin
    // entrada). Se mide contra lo vendible y no contra el total: lo que sobra del total suele
    // ser mercancía de camino o reservada, y esa no tiene «edad» que acusar.
    const anteriorALaLectura =
      listing?.vendibles != null ? Math.max(0, vendibles - explicado) : listing?.enAmazon != null ? Math.max(0, enAlmacen - explicado) : 0
    const descuadre = listing?.enAmazon != null ? enAmazon - enviosDelSku - explicado : null

    /* --- cuánto tarda en venderse lo que llega: la espera media de las unidades vendidas --- */
    let unidadesVendidas = 0
    let esperaTotal = 0
    for (const l of reparto.lineas) {
      const lote = lotes.find((x) => x.id === l.remesaId)
      if (!lote) continue
      for (const [fecha, n] of Object.entries(l.porDia)) {
        if (n <= 0) continue
        unidadesVendidas += n
        esperaTotal += n * Math.max(0, diasEntreInv(lote.fecha, fecha))
      }
    }
    const diasMedioDeVenta = unidadesVendidas >= 3 ? redondea(esperaTotal / unidadesVendidas, 1) : null

    const cobertura = ritmoPlan > 0 ? redondea(vendibles / ritmoPlan, 1) : null
    const precio = listing?.precio ?? null
    const diasSinVenta = ultimaVenta ? diasEntreInv(ultimaVenta, fin) : null
    const tasa90 = vend.d90 > 0 ? redondea(dev.d90 / vend.d90, 3) : null

    /* --- el estado, el primero que se cumpla --- */
    const tieneStock = enAmazon > 0
    // «Parado» exige que el libro llegue lo bastante atrás como para afirmarlo
    const libroSuficiente = (diasDeLibro ?? 0) >= u.diasParado
    let estado: EstadoSku
    if (!hayLibro) estado = 'sin_datos'
    else if (vendibles <= 0 && enviosDelSku === 0 && vend.d90 > 0) estado = 'agotado'
    else if (cobertura !== null && vendibles > 0 && cobertura <= u.plazoCritico) estado = 'urgente'
    else if (tieneStock && vend.d90 > 0 && diasSinVenta !== null && diasSinVenta >= u.diasParado) estado = 'parado'
    else if (tieneStock && vend.d90 === 0) estado = (edadMediaDias ?? 0) >= u.diasParado || (anteriorALaLectura > 0 && libroSuficiente) ? 'parado' : 'sin_ventas'
    else if (cobertura !== null && cobertura > u.coberturaExceso) estado = 'exceso'
    else if (cobertura !== null && cobertura <= u.coberturaBaja) estado = 'bajo'
    else estado = 'ok'

    const alertas: string[] = []
    if (tasa90 !== null && tasa90 >= 0.12 && dev.d90 >= 3) alertas.push('devoluciones altas')
    if (porTramo.t271 + porTramo.t366 > 0) alertas.push('stock de más de 270 días')
    // Unas pocas unidades no vendibles son lo normal (una devolución dañada); la alerta es para
    // cuando son tantas que merece la pena mirarlas en Seller Central
    if (noDisponibles >= 3 && noDisponibles >= 0.15 * Math.max(1, enAmazon)) alertas.push('unidades no disponibles')
    if (muestraCorta && vend.d30 > 0) alertas.push('ritmo poco fiable')

    skus.push({
      sku,
      asin: listing?.asin ?? null,
      fnsku: listing?.fnsku ?? null,
      nombre: listing?.titulo ?? null,
      precio,
      moneda: listing?.moneda ?? null,
      enAmazon,
      vendibles,
      entrante: enviosDelSku,
      noDisponibles,
      vendidas: vend,
      devueltas: dev,
      tasaDevolucion90: tasa90,
      ritmo7: redondea(ritmo7),
      ritmo30: redondea(ritmo30),
      ritmo90: redondea(ritmo90),
      ritmoPlan: redondea(ritmoPlan),
      tendencia,
      muestraCorta,
      serie90: vend.d90 > 0 ? dias90 : null,
      ultimaVenta,
      diasSinVenta,
      primeraEntrada,
      lotes: lotesVivos,
      edadMediaDias,
      edadMaxDias,
      porTramo,
      anteriorALaLectura,
      diasMedioDeVenta,
      retiradas: reparto.lineas.reduce((s, l) => s + l.retiradas, 0),
      mermas: reparto.lineas.reduce((s, l) => s + l.mermas, 0),
      descuadre,
      cobertura,
      seAgotaEl: cobertura !== null && vendibles > 0 ? sumarDiasInv(hoy, Math.floor(cobertura)) : null,
      valorStock: precio !== null ? redondea(enAmazon * precio) : null,
      valorVentas30: precio !== null ? redondea(vend.d30 * precio) : null,
      estado,
      alertas,
    })
  }

  // Lo que más urge primero: sin stock, urgentes, y dentro de cada grupo lo que más vende
  const PRIORIDAD: Record<EstadoSku, number> = { agotado: 0, urgente: 1, bajo: 2, parado: 3, exceso: 4, sin_ventas: 5, ok: 6, sin_datos: 7 }
  skus.sort((a, b) => PRIORIDAD[a.estado] - PRIORIDAD[b.estado] || b.ritmoPlan - a.ritmoPlan || a.sku.localeCompare(b.sku))

  /* ---------- el resumen del cliente ---------- */
  const conStock = skus.filter((s) => s.enAmazon > 0)
  const porTramo = tramosVacios()
  const valorPorTramo = tramosVacios()
  let valorStock = 0
  let sinPrecio = 0
  let valorVentas30 = 0
  let edadPonderada = 0
  let unidadesConEdad = 0
  for (const s of skus) {
    for (const id of Object.keys(porTramo) as IdTramo[]) {
      porTramo[id] += s.porTramo[id]
      if (s.precio !== null) valorPorTramo[id] += s.porTramo[id] * s.precio
    }
    if (s.enAmazon > 0) {
      if (s.valorStock !== null) valorStock += s.valorStock
      else sinPrecio += 1
    }
    valorVentas30 += s.valorVentas30 ?? 0
    for (const l of s.lotes) {
      edadPonderada += l.quedan * l.edadDias
      unidadesConEdad += l.quedan
    }
  }
  for (const id of Object.keys(valorPorTramo) as IdTramo[]) valorPorTramo[id] = redondea(valorPorTramo[id])

  const vendibles = skus.reduce((s, k) => s + k.vendibles, 0)
  const ritmoPlanTotal = skus.reduce((s, k) => s + k.ritmoPlan, 0)
  const vendidas90 = skus.reduce((s, k) => s + k.vendidas.d90, 0)
  const devueltas90 = skus.reduce((s, k) => s + k.devueltas.d90, 0)
  const paradas = skus.filter((s) => s.estado === 'parado' && s.enAmazon > 0)

  const resumen: ResumenInventario = {
    unidadesEnAmazon: skus.reduce((s, k) => s + k.enAmazon, 0),
    vendibles,
    entrante: skus.reduce((s, k) => s + k.entrante, 0),
    noDisponibles: skus.reduce((s, k) => s + k.noDisponibles, 0),
    valorStock: redondea(valorStock),
    sinPrecio,
    vendidas30: skus.reduce((s, k) => s + k.vendidas.d30, 0),
    valorVentas30: redondea(valorVentas30),
    ritmo30: redondea(skus.reduce((s, k) => s + k.ritmo30, 0)),
    coberturaMedia: ritmoPlanTotal > 0 ? redondea(vendibles / ritmoPlanTotal, 1) : null,
    vendidas90,
    devueltas90,
    tasaDevolucion90: vendidas90 > 0 ? redondea(devueltas90 / vendidas90, 3) : null,
    referencias: conStock.length,
    agotadas: skus.filter((s) => s.estado === 'agotado').length,
    urgentes: skus.filter((s) => s.estado === 'urgente').length,
    paradas: paradas.length,
    paradasUnidades: paradas.reduce((s, k) => s + k.enAmazon, 0),
    paradasValor: redondea(paradas.reduce((s, k) => s + (k.valorStock ?? 0), 0)),
    exceso: skus.filter((s) => s.estado === 'exceso').length,
    edadMediaDias: unidadesConEdad > 0 ? redondea(edadPonderada / unidadesConEdad, 1) : null,
    porTramo,
    valorPorTramo,
    anteriorALaLectura: skus.reduce((s, k) => s + k.anteriorALaLectura, 0),
    unidadesAntiguas: porTramo.t271 + porTramo.t366,
    conNoVendibles: skus.filter((s) => s.noDisponibles > 0).length,
    enviosEnCamino: enviosEnCamino.size,
  }

  /* ---------- lo que hay que decir de los datos ---------- */
  if (entrada.leidoHasta === null) avisos.push(`${AVISO_LIBRO_SIN_LEER}: sin él no hay ventas, devoluciones ni edad del stock.`)
  else if (diasEntreInv(entrada.leidoHasta, hoy) > 3) {
    avisos.push(`${AVISO_VENTAS_ATRASADAS} ${dmy(entrada.leidoHasta)}: hace ${diasEntreInv(entrada.leidoHasta, hoy)} días. Lo posterior no cuenta todavía.`)
  }
  if (libro === 'corto' && diasDeLibro !== null) {
    avisos.push(`El libro mayor solo cubre ${diasDeLibro} días: las ventas de 90 días, las devoluciones y la edad del stock están a medias.`)
  }
  if (resumen.anteriorALaLectura > 0 && diasDeLibro !== null) {
    avisos.push(`${resumen.anteriorALaLectura.toLocaleString('es-ES')} unidades ${AVISO_ANTERIOR_AL_LIBRO} (hace ${diasDeLibro} días): su edad es esa o más, y no se reparten por tramos.`)
  }
  if (resumen.sinPrecio > 0) avisos.push(`${resumen.sinPrecio} referencias con stock no tienen precio en el catálogo: no cuentan en el valor.`)

  return {
    hoy,
    leidoHasta: entrada.leidoHasta,
    libroDesde,
    diasDeLibro,
    libro,
    skus,
    resumen,
    porDia: [...serie.values()],
    avisos,
  }
}
