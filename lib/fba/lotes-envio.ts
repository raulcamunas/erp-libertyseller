import type { LineaDePanel, PanelRemesas, RemesaDePanel } from './datos'
import { recepcionContada } from './fifo'
import type { LoteEnvio, ResumenLotes } from './plan-tipos'
import { ESTADOS_AMAZON_MALOS } from './vista'

/**
 * EL FIFO POR LOTES: CUÁNTO DURA CADA ENVÍO.
 * ==========================================
 * PURA: entra el panel que ya calcula `panelDeCliente` (con el reparto de `fifo.ts` hecho), el ritmo
 * del planificador por SKU y `hoy`; sale un `LoteEnvio` por envío y el `ResumenLotes` del cliente.
 * No toca la base ni la red, no usa `Date.now()` y no rehace el reparto: solo lo lee.
 * Se comprueba con lotes-envio.prueba.ts.
 *
 * Responde a «¿cuánto nos dura un envío?», «¿este se vende más rápido o más lento que los
 * anteriores?» y «¿qué se ha perdido por el camino?».
 *
 *
 * ============ VENTAS, Y SOLO VENTAS ============
 *
 * El reparto apunta en `porDia` TODO lo que sale de un lote en neto: ventas, retiradas y mermas,
 * menos lo que vuelve. Durante mucho tiempo la pantalla lo llamaba «vendidas». Aquí se separa como
 * hace `informe-pedido.ts`: vendidas = consumidas − retiradas − mermas.
 *
 * El reparto no guarda en qué día cayó cada retirada (solo el total), así que para los hitos y la
 * curva se quita de los días de más salida (ver `ventasDiariasDeLinea`). Los totales cuadran
 * exactos; lo único aproximado es el día de una retirada, y solo en las líneas que la tienen (son
 * pocas: 78 de 3.655 movimientos medidos).
 *
 *
 * ============ EL 100 % ES LO QUE SE PODÍA VENDER ============
 *
 * Los porcentajes de la curva y los hitos d50/d80/d100 se miden sobre lo recibido que se podía
 * vender: vendidas + lo vendible que queda (= recibidas − retiradas y mermas − inservibles).
 * Si se midieran sobre lo recibido a secas, un envío con una retirada no llegaría nunca al 100 %
 * aunque esté agotado, y su duración no existiría. Sin retiradas ni inservibles es lo recibido.
 *
 *
 * ============ CUÁNTO LE QUEDA A UN LOTE VIVO ============
 *
 * Amazon vende primero lo que llegó antes (es la convención del FIFO). Así que lo que queda de una
 * referencia en este envío no empieza a venderse hasta que se acabe lo que queda de esa referencia
 * en los envíos anteriores. Por referencia:
 *
 *     días que le quedan = (vendibles en lotes anteriores + vendibles en este) / ritmo previsto
 *
 * y el lote, la media de esos días ponderada por las unidades que quedan de cada referencia (la
 * «ponderación por unidades» de la spec). No se usa el máximo: una talla con 2 unidades que vende
 * una al mes alargaría el envío entero meses. Las referencias sin ritmo no cuentan; si ninguna lo
 * tiene, no se estima.
 *
 * Las fechas de lo vivo cuentan desde donde llega el libro (`leidoHasta`) y no desde hoy: lo que
 * queda es lo que quedaba ese día.
 */

const DIA = 86_400_000
/** Como mucho este número de puntos en la curva (uno por día) */
export const MAX_PUNTOS_CURVA = 180
/** Ventana de lo que «dura un envío»: los agotados de los últimos 12 meses */
const VENTANA_RESUMEN_DIAS = 365

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function ms(fecha: string): number {
  return Date.parse(`${fecha.slice(0, 10)}T00:00:00Z`)
}
function diasEntre(desde: string, hasta: string): number {
  return Math.round((ms(hasta) - ms(desde)) / DIA)
}
function sumarDias(fecha: string, dias: number): string {
  return new Date(ms(fecha) + dias * DIA).toISOString().slice(0, 10)
}
function fechaCorta(fecha: string): string {
  const [, m, d] = fecha.slice(0, 10).split('-').map(Number)
  return `${d} ${MESES[(m ?? 1) - 1]}`
}
function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null
  const v = [...valores].sort((a, b) => a - b)
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}
const r1 = (x: number) => Math.round(x * 10) / 10
const EPS = 1e-9

/** Las remesas que ya han salido: las únicas que entran en el reparto (como `panelDeCliente`) */
function esEnvioReal(r: RemesaDePanel): boolean {
  return r.estado === 'enviada' || r.estado === 'cerrada'
}

/* ------------------------------------------------------------------ */
/* Cuentas por línea                                                   */
/* ------------------------------------------------------------------ */

interface CuentaLinea {
  linea: LineaDePanel
  /** La base del reparto: lo recibido si Amazon ya ha contado, lo declarado si no (como fifo.ts) */
  recibidas: number
  noLlegaron: number
  ventas: number
  retiradasYMermas: number
  quedanVendibles: number
  noVendibles: number
}

function cuentaDeLinea(l: LineaDePanel, contada: boolean): CuentaLinea {
  const recibidas = contada && l.recibidas !== null ? l.recibidas : l.enviadas
  // Como informe-pedido.ts: solo las líneas que se quedaron cortas, y solo cuando Amazon ya ha contado
  const noLlegaron = contada && l.recibidas !== null && l.recibidas < l.enviadas ? l.enviadas - l.recibidas : 0
  const retiradasYMermas = Math.max(0, l.retiradas) + Math.max(0, l.mermas)
  const ventas = Math.max(0, l.consumidas - retiradasYMermas)
  const quedanVendibles = Math.max(0, l.quedanVendibles)
  const noVendibles = Math.max(0, l.quedan - l.quedanVendibles)
  return { linea: l, recibidas, noLlegaron, ventas, retiradasYMermas, quedanVendibles, noVendibles }
}

/**
 * LAS VENTAS DE CADA DÍA DE UNA LÍNEA: `porDia` sin las retiradas ni las mermas.
 *
 * El reparto sabe cuánto se retiró, pero no qué día. Una retirada es casi siempre un bulto de un
 * solo día (una orden de retirada), mucho mayor que lo que se vende en un día normal; así que se
 * quita de los días de más salida primero (y, si empatan, del más reciente). Lo que queda es venta.
 * El total cuadra exacto: Σ ventas por día = vendidas. Prorratear la retirada entre todos los días
 * movía los hitos varios días (un d50 real de 14 salía 19).
 */
function ventasDiariasDeLinea(c: CuentaLinea): Array<[string, number]> {
  const dias = Object.entries(c.linea.porDia)
  let porQuitar = c.retiradasYMermas
  if (porQuitar <= 0) return dias
  const quitado = new Map<string, number>()
  const orden = dias.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))
  for (const [fecha, n] of orden) {
    if (porQuitar <= 0) break
    const q = Math.min(n, porQuitar)
    quitado.set(fecha, q)
    porQuitar -= q
  }
  return dias.map(([fecha, n]) => [fecha, n - (quitado.get(fecha) ?? 0)])
}

/** Ventas por día de un conjunto de líneas (solo ventas, en neto de devoluciones) */
function ventasPorDia(cuentas: CuentaLinea[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const c of cuentas) {
    if (c.ventas <= 0) continue
    for (const [fecha, n] of ventasDiariasDeLinea(c)) {
      if (n !== 0) m.set(fecha, (m.get(fecha) ?? 0) + n)
    }
  }
  return m
}

/**
 * Ventas acumuladas desde el día 0 (`desde`) hasta `fin` días después, una por día.
 * Lo que caiga antes del día 0 (no debería: el reparto no deja vender antes de que el lote cuente) va al día 0.
 */
function acumuladoPorDia(porDia: Map<string, number>, desde: string, fin: number): number[] {
  const porIndice = new Array<number>(Math.max(0, fin + 1)).fill(0)
  for (const [fecha, n] of porDia) {
    const i = Math.max(0, diasEntre(desde, fecha))
    if (i <= fin) porIndice[i] += n
  }
  let acc = 0
  return porIndice.map((n) => (acc += n))
}

/** Primer día en que lo acumulado llega a `objetivo` */
function primerDiaQueLlega(acumulado: number[], objetivo: number): number | null {
  for (let i = 0; i < acumulado.length; i++) if (acumulado[i] >= objetivo - EPS) return i
  return null
}

/* ------------------------------------------------------------------ */
/* Contexto FIFO por SKU: qué tiene delante cada lote                   */
/* ------------------------------------------------------------------ */

interface LoteEnCola {
  remesaId: string
  cuentaDesde: string
  quedanVendibles: number
  enCamino: boolean
}

/** ¿Va todavía de camino? Sin llegada, sin recepción contada, con un estado vivo de Amazon y sin nada repartido */
function vaDeCamino(r: RemesaDePanel): boolean {
  if (r.llegadaAt) return false
  if (recepcionContada(r.estadoAmazon)) return false
  if (!r.estadoAmazon || ESTADOS_AMAZON_MALOS.includes(r.estadoAmazon)) return false
  // Si el reparto ya le ha atribuido salidas, para el FIFO está vendiendo: se trata como llegado
  return r.lineas.every((l) => l.consumidas === 0)
}

function colasPorSku(remesas: RemesaDePanel[]): Map<string, LoteEnCola[]> {
  const colas = new Map<string, LoteEnCola[]>()
  for (const r of remesas) {
    const enCamino = vaDeCamino(r)
    for (const l of r.lineas) {
      const cola = colas.get(l.sku) ?? []
      cola.push({ remesaId: r.id, cuentaDesde: r.cuentaDesde, quedanVendibles: Math.max(0, l.quedanVendibles), enCamino })
      colas.set(l.sku, cola)
    }
  }
  // El mismo orden que el reparto: por fecha desde la que cuenta y, si empatan, por id
  for (const cola of colas.values()) {
    cola.sort((a, b) => ms(a.cuentaDesde) - ms(b.cuentaDesde) || a.remesaId.localeCompare(b.remesaId))
  }
  return colas
}

/** Vendibles de esa referencia en los lotes que se venden antes que este */
function delanteDe(cola: LoteEnCola[] | undefined, remesaId: string): number {
  if (!cola) return 0
  let suma = 0
  for (const e of cola) {
    if (e.remesaId === remesaId) break
    if (!e.enCamino) suma += e.quedanVendibles
  }
  return suma
}

/** El lote que está vendiendo ahora esa referencia: el más antiguo ya llegado con algo vendible */
function loteVivoDe(cola: LoteEnCola[] | undefined): string | null {
  return cola?.find((e) => !e.enCamino && e.quedanVendibles > 0)?.remesaId ?? null
}

/* ------------------------------------------------------------------ */
/* Un lote                                                             */
/* ------------------------------------------------------------------ */

function loteDeRemesa(
  r: RemesaDePanel,
  colas: Map<string, LoteEnCola[]>,
  ritmoPorSku: Map<string, number>,
  hoy: string,
  leidoHasta: string | null
): LoteEnvio {
  const contada = recepcionContada(r.estadoAmazon)
  const enCamino = vaDeCamino(r)
  const cuentas = r.lineas.map((l) => cuentaDeLinea(l, contada))
  const suma = (f: (c: CuentaLinea) => number) => cuentas.reduce((s, c) => s + f(c), 0)

  const enviadas = suma((c) => c.linea.enviadas)
  const recibidas = suma((c) => c.recibidas)
  const vendidas = suma((c) => c.ventas)
  const retiradasYMermas = suma((c) => c.retiradasYMermas)
  const quedanVendibles = suma((c) => c.quedanVendibles)
  const noVendibles = suma((c) => c.noVendibles)
  const devueltas = suma((c) => Math.max(0, c.linea.devueltas))
  // Las devoluciones que volvieron rotas son, como mucho, las inservibles que siguen en el lote
  const devueltasVendibles = Math.max(0, devueltas - noVendibles)

  const fechaEnvio = r.fechaEnvio ? r.fechaEnvio.slice(0, 10) : null
  const fechaLlegada = r.llegadaAt ? r.llegadaAt.slice(0, 10) : null
  const diasTransito = fechaEnvio && fechaLlegada ? Math.max(0, diasEntre(fechaEnvio, fechaLlegada)) : null
  const desde = r.cuentaDesde.slice(0, 10)
  // Lo vivo se mide hasta donde llega el libro: después de eso no se sabe qué se ha vendido
  const hasta = leidoHasta && leidoHasta < hoy ? leidoHasta : hoy

  /** Lo que se podía vender de este lote: ver «EL 100 % ES LO QUE SE PODÍA VENDER» */
  const baseVenta = vendidas + quedanVendibles
  const empezado = !enCamino && recibidas > 0 && ms(desde) <= ms(hasta)
  const agotado = empezado && quedanVendibles === 0 && baseVenta > 0

  // Cuándo se agotó: la última de sus líneas (con algo que vender) en agotarse
  let fechaAgotado: string | null = null
  if (agotado) {
    for (const c of cuentas) {
      if (c.recibidas <= 0) continue
      const a = c.linea.agotadaEl
      if (a && (!fechaAgotado || a > fechaAgotado)) fechaAgotado = a
    }
    if (!fechaAgotado) {
      // Sin fecha en el reparto: el último día con movimiento
      for (const c of cuentas) for (const f of Object.keys(c.linea.porDia)) if (!fechaAgotado || f > fechaAgotado) fechaAgotado = f
    }
  }

  const porDia = ventasPorDia(cuentas)
  const finVida = agotado && fechaAgotado ? Math.max(0, diasEntre(desde, fechaAgotado)) : Math.max(0, diasEntre(desde, hasta))
  // Para los hitos se mira la vida entera; para la curva, como mucho 180 días
  const ultimoMov = [...porDia.keys()].reduce((m, f) => Math.max(m, diasEntre(desde, f)), 0)
  const acumulado = empezado ? acumuladoPorDia(porDia, desde, Math.max(finVida, ultimoMov)) : []

  let d50: number | null = null
  let d80: number | null = null
  let d100: number | null = null
  if (empezado && baseVenta > 0) {
    d50 = primerDiaQueLlega(acumulado, 0.5 * baseVenta)
    d80 = primerDiaQueLlega(acumulado, 0.8 * baseVenta)
    if (agotado) d100 = finVida
    // El reparto en el tiempo de una retirada es aproximado (ver cabecera): los hitos nunca después del agotado
    if (d100 !== null) {
      if (d50 !== null) d50 = Math.min(d50, d100)
      else d50 = d100
      if (d80 !== null) d80 = Math.min(d80, d100)
      else d80 = d100
    }
  }

  const curva: LoteEnvio['curva'] = []
  if (empezado && baseVenta > 0) {
    const ultimo = Math.min(finVida, MAX_PUNTOS_CURVA - 1)
    for (let dia = 0; dia <= ultimo; dia++) {
      const pct = Math.min(100, Math.max(0, (acumulado[dia] ?? acumulado[acumulado.length - 1] ?? 0) / baseVenta * 100))
      curva.push({ dia, pctVendido: r1(pct) })
    }
    if (agotado && finVida <= MAX_PUNTOS_CURVA - 1 && curva.length > 0) curva[curva.length - 1].pctVendido = 100
  }

  /* ---------- por SKU ---------- */
  const diasHastaLeido = Math.max(0, diasEntre(desde, hasta))
  const porSku: LoteEnvio['porSku'] = []
  let pesoEstimado = 0
  let sumaEstimada = 0
  for (const c of cuentas) {
    const l = c.linea
    const cola = colas.get(l.sku)
    let d100Sku: number | null = null
    let estimada: number | null = null
    if (empezado && c.recibidas > 0 && c.quedanVendibles === 0 && l.agotadaEl) {
      d100Sku = Math.max(0, diasEntre(desde, l.agotadaEl))
    } else if (empezado && c.quedanVendibles > 0) {
      const ritmo = ritmoPorSku.get(l.sku) ?? 0
      if (ritmo > 0) {
        const restantes = (delanteDe(cola, r.id) + c.quedanVendibles) / ritmo
        estimada = Math.round(diasHastaLeido + restantes)
        pesoEstimado += c.quedanVendibles
        sumaEstimada += c.quedanVendibles * restantes
      }
    }
    porSku.push({
      sku: l.sku,
      nombre: l.nombre,
      enviadas: l.enviadas,
      recibidas: c.recibidas,
      vendidas: Math.round(c.ventas),
      retiradasYMermas: c.retiradasYMermas,
      quedan: Math.max(0, l.quedan),
      d100: d100Sku,
      estimada,
      loteVivo: !enCamino && c.quedanVendibles > 0 && loteVivoDe(cola) === r.id,
    })
  }
  porSku.sort((a, b) => b.vendidas - a.vendidas || b.quedan - a.quedan || a.sku.localeCompare(b.sku))

  /* ---------- duración ---------- */
  const duracionDias = agotado ? d100 : null
  let duracionEstimada: number | null = null
  let agotaraElEstimado: string | null = null
  if (!agotado && empezado && quedanVendibles > 0 && pesoEstimado > 0) {
    const restantes = sumaEstimada / pesoEstimado
    agotaraElEstimado = sumarDias(hasta, Math.ceil(restantes))
    // Con el libro atrasado la fecha podría caer antes de hoy: no se ha agotado, así que como pronto hoy
    if (agotaraElEstimado < hoy) agotaraElEstimado = hoy
    duracionEstimada = Math.max(0, diasEntre(desde, agotaraElEstimado))
  }

  return {
    remesaId: r.id,
    nombre: r.nombre?.trim() || (fechaEnvio ? `Envío del ${fechaCorta(fechaEnvio)}` : 'Envío'),
    referenciaEnvio: r.referenciaEnvio?.trim() || null,
    fechaEnvio,
    fechaLlegada,
    diasTransito,
    estadoAmazon: r.estadoAmazon,
    referencias: r.lineas.length,
    embudo: {
      enviadas,
      noLlegaron: suma((c) => c.noLlegaron),
      recibidas,
      vendidas: Math.round(vendidas),
      retiradasYMermas,
      devueltasVendibles,
      quedanVendibles,
      noVendibles,
    },
    hitos: { d50, d80, d100 },
    duracionDias,
    duracionEstimada,
    agotaraElEstimado,
    estimado: duracionEstimada !== null,
    curva,
    porSku,
    vivo: empezado && quedanVendibles > 0,
  }
}

/* ------------------------------------------------------------------ */
/* El resumen del cliente                                              */
/* ------------------------------------------------------------------ */

export function resumenDeLotes(lotes: LoteEnvio[], hoy: string): ResumenLotes {
  const desde = sumarDias(hoy, -VENTANA_RESUMEN_DIAS)
  const recientes = lotes.filter((l) => (l.fechaLlegada ?? l.fechaEnvio ?? '') >= desde)

  // Lo que «dura un envío»: los agotados de los últimos 12 meses (por la fecha en que se agotaron)
  const duraciones = lotes
    .filter((l) => l.duracionDias !== null)
    .filter((l) => {
      const inicio = l.fechaLlegada ?? l.fechaEnvio
      return !!inicio && sumarDias(inicio, l.duracionDias as number) >= desde
    })
    .map((l) => l.duracionDias as number)
  const duracionMediana = mediana(duraciones)

  const transitos = recientes.filter((l) => l.diasTransito !== null).map((l) => l.diasTransito as number)
  const transitoMediano = mediana(transitos)

  // Ponderado por unidades (Σ no llegaron / Σ enviadas) de los envíos ya contados: un envío de 3 ud
  // con 1 perdida no pesa como uno de 300
  const contados = recientes.filter((l) => recepcionContada(l.estadoAmazon))
  const enviadasContadas = contados.reduce((s, l) => s + l.embudo.enviadas, 0)
  const pctNoLlegadoMedio =
    enviadasContadas > 0 ? r1((contados.reduce((s, l) => s + l.embudo.noLlegaron, 0) / enviadasContadas) * 100) : null

  // Más rápido (+) o más lento (−) que la mediana: velocidad = 1 / duración
  const velocidadComparada: ResumenLotes['velocidadComparada'] = []
  if (duracionMediana !== null && duracionMediana > 0) {
    for (const l of lotes) {
      const dur = l.duracionDias ?? l.duracionEstimada
      if (dur === null) continue
      velocidadComparada.push({ remesaId: l.remesaId, pct: Math.round((duracionMediana / Math.max(1, dur) - 1) * 100) })
    }
  }

  return {
    duracionMediana: duracionMediana === null ? null : Math.round(duracionMediana),
    transitoMediano: transitoMediano === null ? null : Math.round(transitoMediano),
    pctNoLlegadoMedio,
    vivos: lotes.filter((l) => l.vivo).length,
    velocidadComparada,
  }
}

/* ------------------------------------------------------------------ */
/* La entrada                                                          */
/* ------------------------------------------------------------------ */

/**
 * Los lotes de un cliente, del envío más reciente al más antiguo, y su resumen.
 *
 * @param panel lo que devuelve `panelDeCliente` (solo se miran las remesas `enviada|cerrada`)
 * @param ritmoPorSku ud/día previstas por el planificador (`LineaPlan.ritmo.previsto`); sin ritmo, no se estima
 * @param hoy 'YYYY-MM-DD' (Europe/Madrid)
 */
export function lotesDeEnvios(
  panel: PanelRemesas,
  ritmoPorSku: Map<string, number>,
  hoy: string
): { lotes: LoteEnvio[]; resumen: ResumenLotes } {
  const reales = panel.remesas.filter(esEnvioReal)
  const colas = colasPorSku(reales)
  const lotes = reales
    .map((r) => loteDeRemesa(r, colas, ritmoPorSku, hoy, panel.leidoHasta))
    .sort(
      (a, b) =>
        (b.fechaEnvio ?? '').localeCompare(a.fechaEnvio ?? '') || a.remesaId.localeCompare(b.remesaId)
    )
  return { lotes, resumen: resumenDeLotes(lotes, hoy) }
}
