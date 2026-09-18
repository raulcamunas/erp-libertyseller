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
 * QUÉ CONSUME UNA REMESA Y QUÉ NO.
 *
 * Medido sobre 259 movimientos reales de Creative Toys en una semana:
 *
 *   Shipments       180  -> SÍ. Es la venta.
 *   WhseTransfers    57  -> NO. Traslado entre almacenes de Amazon: no se ha
 *                           vendido nada. Es el 22 % de los movimientos, y
 *                           contarlos se comería las remesas sin dar ningún
 *                           error y sin que nadie entendiera por qué.
 *   CustomerReturns  10  -> DEVUELVE unidades. Signo contrario.
 *   Adjustments       8  -> SÍ. Mermas y correcciones. Si no se restan, ocho
 *                           unidades por semana y cliente desaparecen del cuadre.
 *   Receipts          2  -> NO consume: es la entrada de la propia remesa.
 *   VendorReturns     2  -> SÍ. Mercancía retirada del almacén.
 */
const CONSUMEN = new Set<string>(['Shipments', 'Adjustments', 'VendorReturns'])
const DEVUELVEN = new Set<string>(['CustomerReturns'])
const NI_UNA_COSA_NI_OTRA = new Set<string>(['Receipts', 'WhseTransfers'])

/** Lo que vuelve así no suma al stock que se puede vender */
const NO_VENDIBLE = new Set<string>(['DEFECTIVE', 'CUSTOMER_DAMAGED', 'WAREHOUSE_DAMAGED'])

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
  unidades: number
}

export interface Remesa {
  id: string
  /** 'YYYY-MM-DD'. Antes de esta fecha, esta remesa no existe para el reparto */
  fechaEnvio: string
  /** Confirmada por el libro mayor. Si está, manda sobre fechaEnvio */
  fechaLlegada?: string | null
}

export interface RepartoLinea {
  remesaId: string
  sku: string
  enviadas: number
  consumidas: number
  devueltas: number
  /**
   * enviadas - consumidas. `devueltas` NO se suma aquí: una devolución ya se
   * descuenta de `consumidas`, y sumarla otra vez devolvía la unidad dos veces.
   * `devueltas` es un recuento para la pantalla, no un término de la cuenta.
   */
  quedan: number
  /** De las devueltas, cuántas volvieron inservibles */
  devueltasNoVendibles: number
  /** Lo que de verdad se puede vender: `quedan` menos lo que volvió inservible */
  quedanVendibles: number
  agotadaEl: string | null
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
  /** Días hasta agotar lo que queda, o null si no se vende nada */
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

  const estado = vivas.map((v) => ({
    remesaId: v.linea.remesaId,
    desde: desdeCuando(v.remesa),
    enviadas: v.linea.unidades,
    consumidas: 0,
    devueltas: 0,
    devueltasNoVendibles: 0,
    agotadaEl: null as string | null,
  }))

  const ordenados = [...movimientos]
    .filter((m) => m.sku === sku && !NI_UNA_COSA_NI_OTRA.has(m.tipo))
    .sort((a, b) => dia(a.fecha) - dia(b.fecha))

  let sinAtribuir = 0

  for (const mov of ordenados) {
    const abiertas = estado.filter((e) => dia(e.desde) <= dia(mov.fecha))

    if (CONSUMEN.has(mov.tipo)) {
      let porRepartir = Math.abs(mov.cantidad)
      for (const e of abiertas) {
        if (porRepartir <= 0) break
        const hueco = e.enviadas - e.consumidas
        if (hueco <= 0) continue
        const toma = Math.min(hueco, porRepartir)
        e.consumidas += toma
        porRepartir -= toma
        if (e.enviadas - e.consumidas === 0) e.agotadaEl = mov.fecha
      }
      // Ventas de stock que ya estaba allí antes del primer envío, o remesas
      // que no llegaban. No es un error: es lo que el cuadre tiene que explicar.
      sinAtribuir += porRepartir
      continue
    }

    if (DEVUELVEN.has(mov.tipo)) {
      let porDevolver = Math.abs(mov.cantidad)
      const noVendible = NO_VENDIBLE.has((mov.disposicion ?? '').toUpperCase())
      // Al revés: se deshace el consumo más reciente. Ver la cabecera.
      for (const e of [...abiertas].reverse()) {
        if (porDevolver <= 0) break
        if (e.consumidas <= 0) continue
        const suelta = Math.min(e.consumidas, porDevolver)
        e.consumidas -= suelta
        e.devueltas += suelta
        if (noVendible) e.devueltasNoVendibles += suelta
        porDevolver -= suelta
        if (e.enviadas - e.consumidas > 0) e.agotadaEl = null
      }
      sinAtribuir -= Math.min(porDevolver, sinAtribuir)
    }
  }

  const resultado: RepartoLinea[] = estado.map((e) => ({
    remesaId: e.remesaId,
    sku,
    enviadas: e.enviadas,
    consumidas: e.consumidas,
    devueltas: e.devueltas,
    quedan: Math.max(0, e.enviadas - e.consumidas),
    devueltasNoVendibles: e.devueltasNoVendibles,
    quedanVendibles: Math.max(0, e.enviadas - e.consumidas - e.devueltasNoVendibles),
    agotadaEl: e.agotadaEl,
  }))

  const ventana = opciones.diasDeVelocidad ?? 30
  const desdeVelocidad = sumarDias(opciones.hoy, -ventana)
  const vendidasEnVentana = ordenados
    .filter((m) => CONSUMEN.has(m.tipo) && dia(m.fecha) >= dia(desdeVelocidad))
    .reduce((s, m) => s + Math.abs(m.cantidad), 0)

  const velocidad = ventana > 0 ? vendidasEnVentana / ventana : 0
  const quedan = resultado.reduce((s, l) => s + l.quedan, 0)
  const diasDeCobertura = velocidad > 0 ? quedan / velocidad : null

  return {
    sku,
    lineas: resultado,
    enviadas: resultado.reduce((s, l) => s + l.enviadas, 0),
    quedan,
    quedanVendibles: resultado.reduce((s, l) => s + l.quedanVendibles, 0),
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
