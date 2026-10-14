/**
 * EL REPARTO FIFO: QUÉ QUEDA VIVO DE CADA REMESA.
 * ==============================================
 *
 * Función pura. No toca la base ni la red: entran las remesas y los movimientos,
 * sale el reparto. Todo lo que decide está aquí y se puede probar sin montar
 * nada.
 *
 *
 * ============ SE RECALCULA ENTERO, SIEMPRE ============
 *
 * No hay ningún contador que se vaya decrementando, y es deliberado. Un contador
 * deriva —una pasada a medias, un día procesado dos veces, una corrección tardía
 * de Amazon— y cuando deriva no se sabe desde cuándo. Esto se recalcula desde los
 * hechos cada vez que se pide, así que corregir la fecha de una remesa mal metida
 * arregla el histórico solo.
 *
 * Cuesta recorrer los movimientos de un SKU. Son decenas, no millones.
 *
 *
 * ============ AMAZON NO DISTINGUE LOTES ============
 *
 * Mezcla físicamente la mercancía: las unidades de la remesa 1 y la 2 son el
 * mismo montón. El FIFO es una CONVENCIÓN CONTABLE nuestra, no un hecho, y la
 * pantalla no debe presumir de saber algo que no sabe.
 *
 * Lo que sí es un hecho es el total: la suma de lo que queda en las remesas tiene
 * que cuadrar con el stock real. Cuando no cuadra, `descuadre` lo dice.
 */

/** Tal y como los nombra Amazon en GET_LEDGER_DETAIL_VIEW_DATA */
export type TipoMovimiento =
  | 'Shipments'
  | 'Receipts'
  | 'CustomerReturns'
  | 'Adjustments'
  | 'WhseTransfers'
  | 'VendorReturns'
  | (string & {})

/**
 * QUÉ CONSUME UNA REMESA, QUÉ DEVUELVE Y QUÉ NO.
 *
 * Medido sobre 3.655 movimientos reales (ShoesF, Cobo Family y Yo By Yolanda):
 *
 *   Shipments        1.593 -> SÍ. Es la venta. Siempre negativa.
 *   WhseTransfers    1.207 -> NO. Traslado entre almacenes de Amazon: no se ha
 *                            vendido nada. Es un tercio de los movimientos, y
 *                            contarlos se comería las remesas sin dar ningún
 *                            error y sin que nadie entendiera por qué.
 *   Receipts           508 -> NO consume: es la entrada de la propia remesa.
 *   CustomerReturns    220 -> DEVUELVE unidades. Siempre positiva.
 *   VendorReturns       78 -> SÍ. Mercancía retirada del almacén (retiradas y
 *                            bajas). Siempre negativa. No es una venta.
 *   Adjustments         49 -> CON SU SIGNO. Ver abajo.
 *
 *
 * ============ LOS AJUSTES VAN CON SU SIGNO ============
 *
 * Esto estuvo mal: se leían todos como consumo con valor absoluto («Mermas y
 * correcciones»). Pero un ajuste resta o suma según el caso —25 de los 49 SUMAN—:
 *
 *   M  -> pérdida (resta).
 *   F, N -> unidades que Amazon da por encontradas o recolocadas (suman).
 *   O  -> corrección que saca unidades de la cuenta (resta).
 *   P y Q vienen SIEMPRE por parejas: un cambio de estado de la mercancía
 *         (dañada -> vendible, o al revés) son dos filas, una que resta de un
 *         estado y otra que suma al otro. Físicamente no se ha movido ni una unidad.
 *
 * Contarlas con valor absoluto restaba 49 unidades donde la cuenta real es de +1.
 * La prueba está en el propio libro mayor: sumando con signo entradas, ventas,
 * devoluciones, ajustes y retiradas, se reproduce el stock que Amazon dice tener en
 * 286 de 292 referencias de ShoesF (7 unidades de diferencia en total); contando
 * los ajustes como consumo, 275 de 292 (39 unidades).
 *
 * Y se NETEAN POR DÍA: una pareja es dos filas del mismo día y no importa cuál
 * llegue primera. Sin netear, una fila que suma antes de que haya nada que
 * deshacer se perdía y la que resta después contaba, y la pareja dejaba una
 * unidad de menos.
 *
 *
 * ============ VENDIBLE E INSERVIBLE ============
 *
 * Una devolución que vuelve DEFECTIVE o CUSTOMER_DAMAGED está en el almacén pero no
 * se puede vender. Cuenta en lo que `quedan` y NO en `quedanVendibles`; y cuando
 * después se retira o se da de baja, sale de las inservibles y no de las vendibles.
 * Antes la unidad se restaba dos veces —al retirarla y por seguir marcada como
 * inservible— y las vendibles salían una unidad por debajo por cada una.
 *
 * Es inservible todo lo que no sea SELLABLE (DEFECTIVE, CUSTOMER_DAMAGED,
 * CARRIER_DAMAGED, WAREHOUSE_DAMAGED, EXPIRED…), no una lista: Amazon tiene más
 * estados de los que había apuntados.
 */
const DEVUELVEN = new Set<string>(['CustomerReturns'])
const NI_UNA_COSA_NI_OTRA = new Set<string>(['Receipts', 'WhseTransfers'])

/** ¿Esta unidad no se puede vender? Sin dato se da por vendible, que es el caso normal */
function noVendible(disposicion?: string | null): boolean {
  const d = (disposicion ?? '').trim().toUpperCase()
  return d !== '' && d !== 'SELLABLE'
}

export interface Movimiento {
  sku: string
  /** 'YYYY-MM-DD'. Es un día de negocio, no un instante */
  fecha: string
  tipo: TipoMovimiento
  /** Con signo, como lo manda Amazon */
  cantidad: number
  disposicion?: string | null
}

export interface LineaRemesa {
  remesaId: string
  sku: string
  /** Las que se declararon al montar el envío */
  unidades: number
  /**
   * LAS QUE AMAZON DICE QUE RECIBIÓ. null = todavía no ha contestado.
   *
   * Es lo que de verdad hay en el almacén, y no siempre coincide con lo
   * declarado: se pierde una caja, llegan dos pares menos, Amazon marca una
   * unidad como dañada. Esa diferencia la escribe la pasada nocturna desde
   * `getShipmentItems` en cuanto el envío tiene número.
   */
  recibidas: number | null
}

export interface Remesa {
  id: string
  /** 'YYYY-MM-DD'. Antes de esta fecha, esta remesa no existe para el reparto */
  fechaEnvio: string
  /** Confirmada por el libro mayor. Si está, manda sobre fechaEnvio */
  fechaLlegada?: string | null
  /**
   * ¿YA SE PUEDE CREER LO QUE AMAZON DICE QUE HA RECIBIDO?
   *
   * Lo que contesta `getShipmentItems` en QuantityReceived es CERO mientras el
   * envío va de camino: no es que no haya llegado nada, es que todavía no ha
   * llegado el momento de contarlo. Y la pasada nocturna pregunta por los envíos
   * vivos —WORKING y SHIPPED incluidos—, así que ese cero se guarda en
   * `unidades_recibidas` de verdad.
   *
   * Sin esta bandera, el reparto tomaba ese cero al pie de la letra y la remesa
   * salía AGOTADA yendo en el camión. Solo se hace caso a lo recibido cuando el
   * estado del envío dice que la recepción ha empezado.
   */
  recepcionContada?: boolean
}

/**
 * Los estados de Amazon en los que QuantityReceived significa algo.
 *
 * Antes de CHECKED_IN el almacén no ha abierto una caja: lo que devuelve es cero
 * porque no ha contado, no porque no haya nada.
 */
const RECEPCION_CONTADA = new Set(['CHECKED_IN', 'RECEIVING', 'CLOSED'])

/** ¿Se puede creer el `unidades_recibidas` de una remesa en este estado? */
export function recepcionContada(estadoAmazon: string | null | undefined): boolean {
  return !!estadoAmazon && RECEPCION_CONTADA.has(estadoAmazon)
}

export interface RepartoLinea {
  remesaId: string
  sku: string
  enviadas: number
  /**
   * TODO LO QUE HA SALIDO DE ESTA REMESA, en neto: ventas, retiradas y mermas, menos
   * lo que ha vuelto (devoluciones de clientes y unidades encontradas). Es lo que se
   * resta de `enviadas` para saber lo que queda.
   *
   * Sigue llamándose «consumidas» y la pantalla lo enseña como «vendidas» porque
   * hasta hace poco eran lo mismo; `retiradas` y `mermas` dicen cuánto de eso NO son
   * ventas.
   */
  consumidas: number
  devueltas: number
  /**
   * enviadas - consumidas. `devueltas` NO se suma aquí: una devolución ya se
   * descuenta de `consumidas`, y sumarla otra vez devolvía la unidad dos veces.
   * `devueltas` es un recuento para la pantalla, no un término de la cuenta.
   */
  quedan: number
  /**
   * LAS INSERVIBLES QUE HAY AHORA MISMO EN EL ALMACÉN: devueltas dañadas o
   * reclasificadas como no vendibles y que todavía no se han retirado. No es un
   * histórico: baja cuando se retiran o se dan de baja. (El nombre viene de cuando
   * solo podían llegar por una devolución.)
   */
  devueltasNoVendibles: number
  /** Lo que de verdad se puede vender: `quedan` menos las inservibles */
  quedanVendibles: number
  /** Del total de `consumidas`: lo que se retiró del almacén (retiradas y bajas). No son ventas */
  retiradas: number
  /** Del total de `consumidas`: lo que Amazon dio por perdido o dañado (ajustes que restan, netos) */
  mermas: number
  agotadaEl: string | null
  /**
   * LO QUE HA SALIDO DE ESTA REMESA CADA DÍA ('YYYY-MM-DD' → unidades), en neto: las
   * devoluciones restan del día en que vuelven. Solo trae los días en que pasó algo.
   * Su suma es `consumidas`.
   */
  porDia: Record<string, number>
}

export interface RepartoSku {
  sku: string
  lineas: RepartoLinea[]
  enviadas: number
  quedan: number
  /** Lo vendible de verdad: sin lo que volvió roto */
  quedanVendibles: number
  /** Consumo que no cabía en ninguna remesa: ventas de stock anterior al primer
      envío, o remesas que se quedaron cortas. No es un error */
  sinAtribuir: number
  /** Unidades/día de la ventana pedida */
  velocidad: number
  /** Días hasta agotar lo que se PUEDE vender (sin las inservibles), o null si no sale nada */
  diasDeCobertura: number | null
  /** 'YYYY-MM-DD' o null */
  seAgotaEl: string | null
}

export interface OpcionesReparto {
  /** Sobre cuántos días se calcula la velocidad. 30 por defecto */
  diasDeVelocidad?: number
  /** 'YYYY-MM-DD'. Hoy por defecto; se pasa para poder probar */
  hoy: string
}

function dia(fecha: string): number {
  return Date.parse(`${fecha}T00:00:00Z`)
}

function sumarDias(fecha: string, dias: number): string {
  return new Date(dia(fecha) + dias * 86_400_000).toISOString().slice(0, 10)
}

/**
 * Cuándo empieza a contar una remesa.
 *
 * La llegada confirmada por Amazon manda sobre la fecha de envío: entre que la
 * mercancía sale y entra en el almacén pasan días, y las ventas de ese hueco
 * salieron de lo que ya había allí, no de esta remesa.
 */
function desdeCuando(remesa: Remesa): string {
  return remesa.fechaLlegada ?? remesa.fechaEnvio
}

/**
 * El reparto de UN SKU.
 *
 * Las remesas se ordenan por fecha —eso es el FIFO— y los movimientos por día.
 * Cada movimiento se reparte entre las remesas ya vivas, de la más antigua a la
 * más nueva, hasta agotarlo.
 *
 * LAS DEVOLUCIONES VAN AL REVÉS, y es una convención, no un dato: el libro mayor
 * NO trae el identificador del pedido en las devoluciones (0 de 10 medidas), así
 * que no hay forma de saber de qué venta venía cada una. Se deshace el consumo
 * MÁS RECIENTE. Si volvieran a la remesa más antigua, una remesa que ya diste por
 * agotada dejaría de estarlo y su fecha de agotamiento pasaría a ser mentira.
 */
export function repartirSku(
  sku: string,
  lineas: LineaRemesa[],
  remesas: Map<string, Remesa>,
  movimientos: Movimiento[],
  opciones: OpcionesReparto
): RepartoSku {
  const vivas = lineas
    .filter((l) => remesas.has(l.remesaId))
    .map((l) => ({ linea: l, remesa: remesas.get(l.remesaId)! }))
    .sort((a, b) => {
      const d = dia(desdeCuando(a.remesa)) - dia(desdeCuando(b.remesa))
      return d !== 0 ? d : a.linea.remesaId.localeCompare(b.linea.remesaId)
    })

  /**
   * SE REPARTE SOBRE LO QUE AMAZON RECIBIÓ, NO SOBRE LO QUE SE DECLARÓ.
   *
   * Es la diferencia entre decir «quedan 20» y que queden 15. Si se mandaron
   * 100 y Amazon recibió 95 —se pierde una caja, llegan unidades dañadas, se
   * extravía un bulto—, lo que hay en el almacén son 95: descontar las ventas de
   * 100 deja un fantasma de cinco unidades que no se agota nunca y que tapa el
   * momento en que la referencia se queda sin stock, que es justo para lo que
   * sirve esta pantalla.
   *
   * El cron ya escribía `unidades_recibidas` desde hace tiempo y NADIE lo leía.
   *
   * CUANDO TODAVÍA NO HA CONTESTADO (null) SE USA LO DECLARADO, y no cero.
   *
   * Y TAMPOCO SE HACE CASO AL CERO QUE ESCRIBE LA PASADA NOCTURNA mientras el
   * envío va de camino. Esto es lo que faltaba y costó una avería: `getShipmentItems`
   * devuelve QuantityReceived = 0 para un envío en WORKING o SHIPPED —no ha
   * llegado el momento de contar, no es que no haya nada—, el cron pregunta por
   * esos estados y guarda ese cero. Un `?? ` no lo tapa, porque 0 no es null: la
   * remesa salía AGOTADA yendo en el camión.
   *
   * Así que solo manda lo recibido cuando el estado del envío dice que la
   * recepción ha empezado (ver `recepcionContada`). Antes de eso, lo declarado.
   */
  const estado = vivas.map((v) => ({
    remesaId: v.linea.remesaId,
    desde: desdeCuando(v.remesa),
    enviadas:
      v.remesa.recepcionContada && v.linea.recibidas !== null
        ? v.linea.recibidas
        : v.linea.unidades,
    /** Lo declarado, para poder decir cuántas se perdieron por el camino */
    declaradas: v.linea.unidades,
    /**
     * LAS TRES SALIDAS, CADA UNA EN NETO. `consumidas` es su suma.
     *
     * Separadas porque no son lo mismo y la pantalla tiene que poder decirlo: una
     * retirada del almacén o una merma no es una venta.
     */
    ventas: 0,
    retiradas: 0,
    mermas: 0,
    devueltas: 0,
    /** Las inservibles que hay ahora mismo en este lote. Ver la cabecera */
    noVendibles: 0,
    agotadaEl: null as string | null,
    porDia: {} as Record<string, number>,
  }))
  type Lote = (typeof estado)[number]
  type Salida = 'ventas' | 'retiradas' | 'mermas'

  const consumidasDe = (e: Lote) => e.ventas + e.retiradas + e.mermas
  const quedanDe = (e: Lote) => Math.max(0, e.enviadas - consumidasDe(e))
  /** Lo que de este lote se puede vender ahora: lo que queda menos lo inservible */
  const vendiblesDe = (e: Lote) => Math.max(0, e.enviadas - consumidasDe(e) - e.noVendibles)
  const abiertasEn = (fecha: string) => estado.filter((e) => dia(e.desde) <= dia(fecha))
  const apuntar = (e: Lote, fecha: string, n: number) => {
    e.porDia[fecha] = (e.porDia[fecha] ?? 0) + n
  }

  /**
   * SALEN UNIDADES VENDIBLES: de la remesa más antigua que ya haya llegado y tenga.
   * Una venta solo puede llevarse unidades que se pueden vender, no las inservibles
   * que hay en el mismo lote. Devuelve lo que no ha cabido en ninguna.
   */
  function sacarVendibles(n: number, fecha: string, como: Salida): number {
    let por = n
    for (const e of abiertasEn(fecha)) {
      if (por <= 0) break
      const toma = Math.min(vendiblesDe(e), por)
      if (toma <= 0) continue
      e[como] += toma
      apuntar(e, fecha, toma)
      por -= toma
      if (vendiblesDe(e) === 0) e.agotadaEl = fecha
    }
    return por
  }

  /**
   * SALEN UNIDADES INSERVIBLES (se retira o se da de baja una dañada): primero de los
   * lotes que las tienen, el más reciente primero —que es donde las dejó la
   * devolución—. Lo que no se encuentra así se trata como una salida normal: es una
   * inservible que nunca se vio entrar, y al retirarla las vendibles quedan bien.
   */
  function sacarInservibles(n: number, fecha: string, como: 'retiradas' | 'mermas'): number {
    let por = n
    for (const e of [...abiertasEn(fecha)].reverse()) {
      if (por <= 0) break
      const toma = Math.min(e.noVendibles, por)
      if (toma <= 0) continue
      e[como] += toma
      e.noVendibles -= toma
      apuntar(e, fecha, toma)
      por -= toma
    }
    return por > 0 ? sacarVendibles(por, fecha, como) : 0
  }

  /**
   * VUELVEN UNIDADES: se deshace la salida MÁS RECIENTE. Una devolución de cliente
   * deshace antes una venta; una unidad que Amazon da por encontrada, antes una
   * merma. Devuelve lo que no ha tenido a qué volver.
   */
  function reponer(n: number, fecha: string, inservible: boolean, deCliente: boolean): number {
    let por = n
    const orden: Salida[] = deCliente ? ['ventas', 'mermas', 'retiradas'] : ['mermas', 'ventas', 'retiradas']
    for (const e of [...abiertasEn(fecha)].reverse()) {
      for (const tipo of orden) {
        if (por <= 0) break
        const suelta = Math.min(e[tipo], por)
        if (suelta <= 0) continue
        e[tipo] -= suelta
        apuntar(e, fecha, -suelta)
        if (deCliente) e.devueltas += suelta
        if (inservible) e.noVendibles += suelta
        por -= suelta
      }
      if (vendiblesDe(e) > 0) e.agotadaEl = null
      if (por <= 0) break
    }
    return por
  }

  /** UN CAMBIO DE ESTADO: unidades que pasan de vendibles a inservibles o al revés. No cambia el total */
  function reclasificar(n: number, haciaInservible: boolean, fecha: string): void {
    let por = n
    for (const e of [...abiertasEn(fecha)].reverse()) {
      if (por <= 0) break
      if (haciaInservible) {
        const toma = Math.min(vendiblesDe(e), por)
        if (toma <= 0) continue
        e.noVendibles += toma
        por -= toma
        if (vendiblesDe(e) === 0) e.agotadaEl = fecha
      } else {
        const toma = Math.min(e.noVendibles, por)
        if (toma <= 0) continue
        e.noVendibles -= toma
        por -= toma
        if (vendiblesDe(e) > 0) e.agotadaEl = null
      }
    }
  }

  const ordenados = [...movimientos]
    .filter((m) => m.sku === sku && !NI_UNA_COSA_NI_OTRA.has(m.tipo))
    .sort((a, b) => dia(a.fecha) - dia(b.fecha))

  /**
   * LOS AJUSTES SE JUNTAN POR DÍA, separando lo vendible de lo inservible. Una pareja
   * de cambio de estado son dos filas del mismo día y da igual cuál llegue primera:
   * sumadas, se anulan. Ver la cabecera.
   */
  const ajustes = new Map<string, { vend: number; noVend: number }>()
  for (const m of ordenados) {
    if (m.tipo !== 'Adjustments') continue
    const a = ajustes.get(m.fecha) ?? { vend: 0, noVend: 0 }
    if (noVendible(m.disposicion)) a.noVend += m.cantidad
    else a.vend += m.cantidad
    ajustes.set(m.fecha, a)
  }

  type Evento = { fecha: string; mov: Movimiento } | { fecha: string; vend: number; noVend: number }
  const eventos: Evento[] = [
    ...ordenados.filter((m) => m.tipo !== 'Adjustments').map((mov): Evento => ({ fecha: mov.fecha, mov })),
    // Detrás de los demás movimientos del mismo día: el orden es estable
    ...[...ajustes].map(([fecha, a]): Evento => ({ fecha, vend: a.vend, noVend: a.noVend })),
  ].sort((a, b) => dia(a.fecha) - dia(b.fecha))

  // Lo que no cabía en ninguna remesa: ventas de stock que ya estaba allí antes del
  // primer envío, o remesas que no llegaban. No es un error: es lo que el cuadre
  // tiene que explicar.
  let sinAtribuir = 0
  const devuelto = (resto: number) => {
    sinAtribuir -= Math.min(resto, sinAtribuir)
  }

  /**
   * UNIDADES QUE AMAZON DA POR ENCONTRADAS (un ajuste que suma). Compensan ANTES el
   * hueco que dejó una salida que no cupo en ningún lote —lo que está en
   * `sinAtribuir`— que una venta ya apuntada. Pasa de verdad: Amazon vende una unidad
   * un día y el ajuste que la repone llega el mismo día; deshacer entonces la venta
   * del lote dejaba una unidad de más en la remesa y otra de menos en `sinAtribuir`.
   * Lo que no tenga hueco que compensar deshace la merma o la venta más reciente.
   */
  function encontradas(n: number, fecha: string, inservible: boolean) {
    const compensa = Math.min(n, sinAtribuir)
    sinAtribuir -= compensa
    if (n - compensa > 0) devuelto(reponer(n - compensa, fecha, inservible, false))
  }

  for (const ev of eventos) {
    if ('mov' in ev) {
      const m = ev.mov
      const n = Math.abs(m.cantidad)
      if (m.tipo === 'Shipments') {
        sinAtribuir += sacarVendibles(n, m.fecha, 'ventas')
      } else if (m.tipo === 'VendorReturns') {
        sinAtribuir += noVendible(m.disposicion) ? sacarInservibles(n, m.fecha, 'retiradas') : sacarVendibles(n, m.fecha, 'retiradas')
      } else if (DEVUELVEN.has(m.tipo)) {
        devuelto(reponer(n, m.fecha, noVendible(m.disposicion), true))
      }
      continue
    }

    let { vend, noVend } = ev
    // 1) Un cambio de estado: una fila resta de un estado y otra suma al otro. Lo que
    //    se solapa solo mueve unidades de un cubo a otro.
    if (vend * noVend < 0) {
      const t = Math.min(Math.abs(vend), Math.abs(noVend))
      reclasificar(t, noVend > 0, ev.fecha)
      vend -= Math.sign(vend) * t
      noVend -= Math.sign(noVend) * t
    }
    // 2) Lo que queda cambia de verdad el número de unidades: resta si es pérdida y suma si es hallazgo
    if (vend < 0) sinAtribuir += sacarVendibles(-vend, ev.fecha, 'mermas')
    if (noVend < 0) sinAtribuir += sacarInservibles(-noVend, ev.fecha, 'mermas')
    if (vend > 0) encontradas(vend, ev.fecha, false)
    if (noVend > 0) encontradas(noVend, ev.fecha, true)
  }

  const resultado: RepartoLinea[] = estado.map((e) => ({
    remesaId: e.remesaId,
    sku,
    enviadas: e.enviadas,
    consumidas: consumidasDe(e),
    devueltas: e.devueltas,
    quedan: quedanDe(e),
    devueltasNoVendibles: e.noVendibles,
    quedanVendibles: vendiblesDe(e),
    retiradas: e.retiradas,
    mermas: e.mermas,
    agotadaEl: e.agotadaEl,
    porDia: Object.fromEntries(Object.entries(e.porDia).filter(([, n]) => n !== 0)),
  }))

  /**
   * LA VELOCIDAD: lo que sale del almacén por día —ventas, retiradas y las pérdidas
   * netas—. Los ajustes van con su signo: los que suman no son ventas, y contarlos
   * como si lo fueran inflaba el ritmo.
   */
  const ventana = opciones.diasDeVelocidad ?? 30
  const desdeVelocidad = sumarDias(opciones.hoy, -ventana)
  let salidasEnVentana = 0
  let ajustesNetosEnVentana = 0
  for (const m of ordenados) {
    if (dia(m.fecha) < dia(desdeVelocidad)) continue
    if (m.tipo === 'Shipments' || m.tipo === 'VendorReturns') salidasEnVentana += Math.abs(m.cantidad)
    else if (m.tipo === 'Adjustments') ajustesNetosEnVentana += m.cantidad
  }
  salidasEnVentana += Math.max(0, -ajustesNetosEnVentana)

  const velocidad = ventana > 0 ? salidasEnVentana / ventana : 0
  const quedan = resultado.reduce((s, l) => s + l.quedan, 0)
  const quedanVendibles = resultado.reduce((s, l) => s + l.quedanVendibles, 0)
  // Los días de stock cuentan lo que se PUEDE vender: una devolución dañada no sostiene ninguna venta
  const diasDeCobertura = velocidad > 0 ? quedanVendibles / velocidad : null

  return {
    sku,
    lineas: resultado,
    enviadas: resultado.reduce((s, l) => s + l.enviadas, 0),
    quedan,
    quedanVendibles,
    sinAtribuir,
    velocidad: Math.round(velocidad * 100) / 100,
    diasDeCobertura: diasDeCobertura === null ? null : Math.round(diasDeCobertura * 10) / 10,
    seAgotaEl:
      diasDeCobertura === null ? null : sumarDias(opciones.hoy, Math.floor(diasDeCobertura)),
  }
}

/**
 * EL CUADRE CONTRA LA REALIDAD.
 *
 * El reparto de arriba es una convención; el stock que dice Amazon es un hecho.
 * Si no coinciden, el número que hay que creerse es el de Amazon, y la
 * diferencia hay que enseñarla el día que aparece — no descubrirla seis meses
 * después preguntándose desde cuándo.
 *
 * Que haya diferencia NO significa que el reparto esté mal. Lo normal es que
 * sobre stock: mercancía que ya estaba en Amazon antes de la primera remesa y
 * que nadie apuntó. Por eso se devuelve el número con su signo y sin juzgarlo.
 */
export function descuadre(quedanSegunRemesas: number, stockReal: number | null): number | null {
  if (stockReal === null) return null
  return stockReal - quedanSegunRemesas
}
