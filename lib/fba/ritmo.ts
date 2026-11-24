/**
 * RITMO ROBUSTO DE VENTA, ESTACIONALIDAD SEMANAL Y REPARTO POR TALLAS
 * (spec remesas-pro §2.3, corregido por §11 D5, D6, D7, D8, D12 y D15). Puro: `hoy` llega inyectado.
 *
 * Por qué no vale «vendidas en 30 días / 30»:
 *  - Un SKU que estuvo 15 días agotado vende la mitad en el papel, pero no porque
 *    lo pidan menos: no había. El ritmo se calcula solo sobre los días CON stock, y el
 *    stock de cada día se reconstruye hacia atrás desde las vendibles de hoy con el libro.
 *  - Una retirada (VendorReturns) o una merma (Adjustments) no es una venta.
 *  - Un pedido de 40 unidades un día suelto no es ritmo: se recorta.
 *  - Lo que lleva meses agotado no tiene ritmo reciente: se mira el último periodo con
 *    stock (hasta 365 días atrás) y se marca para preguntar si se repone (D8).
 *  - Si el libro va atrasado, los días sin libro no cuentan ni como con stock ni como
 *    sin stock (D15).
 *  - La talla suelta de un zapato casi nunca da ritmo: se calcula el del modelo con
 *    días-equivalentes y se reparte con la curva de tallas (D5, D6).
 *  - La estacionalidad va por semanas (D7): el año pasado, relativo al periodo del que
 *    sale el ritmo, y topado con el tope del cliente.
 *
 * El ritmo que se enseña es BRUTO (lo que se vende). El consumo neto (D12) descuenta
 * las devoluciones que vuelven vendibles y suma las mermas: es lo que gasta la simulación.
 */

import type { Confianza, Libro, RitmoSku, SerieSku } from './plan-tipos'

/**
 * Una fila del libro agregado por SKU, día, tipo y disposición (forma de la función
 * `fba_movimientos_diarios` de la migración 316). La define `lib/fba/libro-diario.ts`
 * (W1-I); mientras ese fichero no exista se declara aquí con la misma forma.
 */
export interface MovimientoDiario {
  sku: string
  /** 'YYYY-MM-DD' */
  fecha: string
  tipo: string
  disposicion: string | null
  /** Con signo, como lo manda Amazon (Shipments y VendorReturns negativos) */
  cantidad: number
}

/* ------------------------------------------------------------------ */
/* Constantes                                                          */
/* ------------------------------------------------------------------ */

export const UMBRALES_RITMO = {
  ventanas: [14, 30, 60, 90] as const,
  minDias: { 14: 7, 30: 12, 60: 20, 90: 30 } as Record<number, number>,
  /** Lo mínimo de días-equivalentes en 90 para el ritmo de 90 días de un MODELO (todas sus tallas juntas) */
  minDiasModelo90: 14,
  pesos: { 14: 0.3, 30: 0.4, 90: 0.3 } as Record<number, number>,
  /** r14 entra como mucho a 2 × r90 */
  r14TopeSobreR90: 2,
  /** Día atípico: max(3, 4 × mediana de los días con venta de 90) */
  topeAtipicoMin: 3,
  topeAtipicoMediana: 4,
  /** % de unidades recortadas en 90 días para decir «pedido grande» */
  pedidoGrandePct: 0.25,
  /** Con pedido grande y menos de esto fuera del pico: sin datos */
  pedidoGrandeMinFuera: 6,
  /** Serie de stock no fiable si más de este % de días sale negativo */
  negativosMaxPct: 0.2,
  /** Unidades de descuadre del libro que no se cuentan como «negativo» */
  toleranciaNegativo: 2,
  /** Descuadre que se absorbe subiendo el ancla: max(5 ud, 15 % del ancla) */
  descuadreMin: 5,
  descuadrePct: 0.15,
  /** Libro atrasado más de esto: se ancla con una estimación (D15) */
  atrasoAnclaje: 2,
  confianza: { alta: { dias: 45, ventas: 15 }, media: { dias: 21, ventas: 6 }, sinDatos: { dias: 14, ventas: 3 } },
  tendencia: { ventas60Min: 10, sube: 1.3, baja: 0.7 },
  /** Último periodo con stock (D8): cuántos días con stock se buscan y el mínimo */
  ultimoPeriodo: { dias: 90, minDias: 14, minVentas: 3 },
  devolucionTope: 0.3,
  /** La merma que se proyecta como consumo, como mucho este tanto del ritmo base */
  mermaTopeSobreBase: 0.3,
  /** Perfil semanal: unidades mínimas el año pasado y unidades «de prior» por semana (suavizado hacia 1) */
  perfil: { minUnidades: 12, priorPorSemana: 12 },
} as const

/* ------------------------------------------------------------------ */
/* Fechas (UTC, sin zona: son días de negocio)                         */
/* ------------------------------------------------------------------ */

const DIA_MS = 86_400_000
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

function aMs(f: string): number {
  return Date.UTC(Number(f.slice(0, 4)), Number(f.slice(5, 7)) - 1, Number(f.slice(8, 10)))
}
function deMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}
export function sumarDias(f: string, n: number): string {
  return deMs(aMs(f) + n * DIA_MS)
}
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((aMs(hasta) - aMs(desde)) / DIA_MS)
}
/** «3 ago» */
function fechaCorta(f: string): string {
  return `${Number(f.slice(8, 10))} ${MESES[Number(f.slice(5, 7)) - 1]}`
}
/** Semana ISO 1..53 */
export function semanaIso(f: string): number {
  const d = new Date(aMs(f))
  const diaSemana = (d.getUTCDay() + 6) % 7 // lunes 0
  d.setUTCDate(d.getUTCDate() - diaSemana + 3) // jueves de esa semana
  const primerJueves = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const diaPJ = (primerJueves.getUTCDay() + 6) % 7
  primerJueves.setUTCDate(primerJueves.getUTCDate() - diaPJ + 3)
  return 1 + Math.round((d.getTime() - primerJueves.getTime()) / (7 * DIA_MS))
}

/* ------------------------------------------------------------------ */
/* Números                                                             */
/* ------------------------------------------------------------------ */

function num(n: number, dec = 1): string {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: dec, minimumFractionDigits: 0 }).format(n)
}
function redondea(n: number, dec = 4): number {
  const f = 10 ** dec
  return Math.round(n * f) / f
}
function mediana(xs: number[]): number {
  if (xs.length === 0) return 0
  const o = [...xs].sort((a, b) => a - b)
  const m = Math.floor(o.length / 2)
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2
}

/* ------------------------------------------------------------------ */
/* Libro: qué es venta, qué mueve las vendibles                        */
/* ------------------------------------------------------------------ */

function esVendible(disposicion: string | null | undefined): boolean {
  const d = (disposicion ?? '').trim().toUpperCase()
  return d === '' || d === 'SELLABLE'
}

/** Unidades vendidas del movimiento (solo Shipments; retiradas, ajustes y entradas no) */
function ventaDe(m: MovimientoDiario): number {
  return m.tipo === 'Shipments' ? Math.abs(Number(m.cantidad) || 0) : 0
}

/**
 * Lo que el movimiento suma o resta a las VENDIBLES (§2.3 b):
 * Receipts + CustomerReturns(SELLABLE) − Shipments − VendorReturns(SELLABLE) + Adjustments(SELLABLE, con signo).
 * WhseTransfers se compensan y no cuentan.
 */
function netoVendibleDe(m: MovimientoDiario): number {
  const c = Number(m.cantidad) || 0
  switch (m.tipo) {
    case 'Shipments':
      return -Math.abs(c)
    case 'Receipts':
      return esVendible(m.disposicion) ? c : 0
    case 'CustomerReturns':
      return esVendible(m.disposicion) ? Math.abs(c) : 0
    case 'VendorReturns':
      return esVendible(m.disposicion) ? -Math.abs(c) : 0
    case 'Adjustments':
      return esVendible(m.disposicion) ? c : 0
    default:
      return 0
  }
}

/** Primer Receipt del SKU en el libro (la «primera entrada»); null si no hay */
export function primeraEntradaDe(movs: MovimientoDiario[], sku: string): string | null {
  let primera: string | null = null
  for (const m of movs) {
    if (m.sku !== sku || m.tipo !== 'Receipts' || !(Number(m.cantidad) > 0)) continue
    if (primera === null || m.fecha < primera) primera = m.fecha
  }
  return primera
}

/** Primer día con actividad del SKU en el libro: su primera entrada o su primera venta (lo que antes llegue); null si no hay */
export function primeraActividadDe(movs: readonly MovimientoDiario[], sku: string): string | null {
  let primera: string | null = null
  for (const m of movs) {
    if (m.sku !== sku) continue
    const c = Number(m.cantidad) || 0
    if (!((m.tipo === 'Receipts' && c > 0) || (m.tipo === 'Shipments' && c !== 0))) continue
    if (primera === null || m.fecha < primera) primera = m.fecha
  }
  return primera
}

/**
 * Devoluciones que vuelven vendibles y mermas de los 90 días hasta `leidoHasta` (D12).
 * - `mermas90` (bruto, para el aviso «pierde X ud»): Adjustments SELLABLE netos negativos + VendorReturns SELLABLE (en positivo).
 * - `mermasRecurrentes90` (lo que se proyecta como consumo diario): solo los Adjustments, y robustos. Las retiradas que pide el
 *   vendedor (VendorReturns) son una decisión puntual, no un ritmo: no se repiten cada día. De los ajustes se cuenta lo que se
 *   pierde semana a semana con cada semana topada a max(1, 2 × la mediana semanal): un ajuste de golpe no se vuelve demanda.
 */
export function devolucionesYMermas(
  movs: MovimientoDiario[], sku: string, leidoHasta: string, dias = 90,
): { devolucionesVendibles90: number; mermas90: number; mermasRecurrentes90: number } {
  const desde = sumarDias(leidoHasta, -(dias - 1))
  const semanas = Math.max(1, Math.ceil(dias / 7))
  const ajustesSemana = new Array<number>(semanas).fill(0)
  let devueltas = 0
  let ajustes = 0
  let retiradas = 0
  for (const m of movs) {
    if (m.sku !== sku || m.fecha < desde || m.fecha > leidoHasta || !esVendible(m.disposicion)) continue
    const c = Number(m.cantidad) || 0
    if (m.tipo === 'CustomerReturns') devueltas += Math.abs(c)
    else if (m.tipo === 'Adjustments') {
      ajustes += c
      const w = Math.min(semanas - 1, Math.floor(diasEntre(m.fecha, leidoHasta) / 7))
      ajustesSemana[w] += c
    } else if (m.tipo === 'VendorReturns') retiradas += Math.abs(c)
  }
  const perdidas = ajustesSemana.map((x) => Math.max(0, -x))
  const topeSemana = Math.max(1, 2 * mediana(perdidas))
  const recurrentes = perdidas.reduce((a, x) => a + Math.min(x, topeSemana), 0)
  return {
    devolucionesVendibles90: devueltas,
    mermas90: Math.max(0, -ajustes) + retiradas,
    mermasRecurrentes90: Math.min(Math.max(0, -ajustes), recurrentes),
  }
}

/* ------------------------------------------------------------------ */
/* a-b-c · Serie diaria                                                */
/* ------------------------------------------------------------------ */

/** Tope de un día atípico a partir de las ventas de los días con venta */
function topeAtipico(ventasConVenta: number[]): number {
  const U = UMBRALES_RITMO
  return Math.max(U.topeAtipicoMin, U.topeAtipicoMediana * mediana(ventasConVenta))
}

/**
 * La serie diaria de un SKU: ventas, stock al empezar cada día y si había stock.
 *
 * - Va de `hoy − dias + 1` a `hoy`. Los días antes del primer movimiento del libro
 *   (de cualquier SKU: el libro empieza ahí) y los posteriores a `leidoHasta` quedan
 *   con `conStock = null`: no hay libro y no cuentan ni a favor ni en contra.
 * - El stock se reconstruye hacia atrás desde `leidoHasta`. Si el libro va atrasado
 *   más de 2 días, el ancla es `vendibles + ritmo × días de atraso` (lo que se ha
 *   vendido desde que no hay libro) y se marca `anclajeEstimado` (D15).
 * - Si más del 20 % de los días el stock reconstruido sale negativo (el libro no
 *   cuadra con las vendibles), `fiable = false`.
 */
export function serieDiaria(
  movs: MovimientoDiario[], sku: string, vendibles: number, leidoHasta: string, hoy: string, dias = 365,
): SerieSku {
  const U = UMBRALES_RITMO
  const n = Math.max(1, Math.floor(dias))
  const inicio = sumarDias(hoy, -(n - 1))
  const fechas: string[] = []
  for (let i = 0; i < n; i++) fechas.push(sumarDias(inicio, i))

  // Dónde empieza el libro: el primer movimiento de cualquier SKU
  let libroDesde: string | null = null
  for (const m of movs) if (libroDesde === null || m.fecha < libroDesde) libroDesde = m.fecha
  const desdeLibro = libroDesde ?? inicio

  const ventas = new Array<number>(n).fill(0)
  const neto = new Array<number>(n).fill(0)
  for (const m of movs) {
    if (m.sku !== sku) continue
    const i = diasEntre(inicio, m.fecha)
    if (i < 0 || i >= n || m.fecha > leidoHasta) continue
    ventas[i] += ventaDe(m)
    neto[i] += netoVendibleDe(m)
  }

  const idxLeido = Math.min(n - 1, diasEntre(inicio, leidoHasta))
  const hayLibro = (i: number) => i <= idxLeido && fechas[i] >= desdeLibro
  const v = Math.max(0, Number(vendibles) || 0)

  /** Reconstrucción hacia atrás con un ancla al final de `leidoHasta` */
  const reconstruir = (ancla: number) => {
    const inicioDia = new Array<number>(n).fill(0)
    let negativos = 0
    let diasLibro = 0
    let minimo = 0
    if (idxLeido >= 0) {
      let fin = ancla // stock al acabar el día i
      for (let i = idxLeido; i >= 0; i--) {
        const alEmpezar = fin - neto[i]
        inicioDia[i] = alEmpezar
        if (hayLibro(i)) {
          diasLibro++
          if (alEmpezar < -U.toleranciaNegativo) negativos++
          if (alEmpezar < minimo) minimo = alEmpezar
        }
        fin = alEmpezar
      }
    }
    return { inicioDia, negativos, diasLibro, minimo }
  }

  /**
   * Descuadre pequeño: el libro cuenta como vendibles unidades que el listing no da
   * (reservadas para traslado entre centros, en proceso). Si para no salir negativo
   * basta con subir el ancla un poco (≤ max(5, 15 % del ancla)), se sube: el día del
   * mínimo queda a 0, que es justo cuando se agotó. Si hace falta más, el libro no
   * cuadra y la serie no es fiable.
   */
  const conDescuadre = (ancla: number) => {
    const r = reconstruir(ancla)
    const deficit = Math.ceil(-r.minimo - 1e-9)
    if (r.negativos > 0 && deficit > 0 && deficit <= Math.max(U.descuadreMin, U.descuadrePct * ancla)) {
      return { ...reconstruir(ancla + deficit), ancla: ancla + deficit }
    }
    return { ...r, ancla }
  }

  const atraso = Math.max(0, diasEntre(leidoHasta, hoy))
  let ancla = v
  let anclajeEstimado = false
  if (atraso > U.atrasoAnclaje && idxLeido >= 0) {
    // Primera pasada con el ancla en las vendibles para medir el ritmo reciente del libro
    const p = conDescuadre(v)
    const desde = Math.max(0, idxLeido - 29)
    const conVenta: number[] = []
    for (let i = desde; i <= idxLeido; i++) if (hayLibro(i) && ventas[i] > 0) conVenta.push(ventas[i])
    const tope = topeAtipico(conVenta)
    let suma = 0
    let diasCon = 0
    let diasLibro = 0
    for (let i = desde; i <= idxLeido; i++) {
      if (!hayLibro(i)) continue
      diasLibro++
      suma += Math.min(ventas[i], tope)
      if (p.inicioDia[i] > 0 || ventas[i] > 0) diasCon++
    }
    const ritmo = diasLibro === 0 ? 0 : suma / Math.max(diasCon >= 7 ? diasCon : diasLibro, 1)
    ancla = v + Math.round(ritmo * atraso)
    anclajeEstimado = true
  }

  const reconstruida = conDescuadre(ancla)
  const { inicioDia, negativos, diasLibro } = reconstruida
  ancla = reconstruida.ancla
  const stockInicio: number[] = new Array<number>(n).fill(0)
  const conStock: Array<boolean | null> = new Array<boolean | null>(n).fill(null)
  for (let i = 0; i < n; i++) {
    if (i <= idxLeido) {
      stockInicio[i] = Math.max(0, Math.round(inicioDia[i] * 1000) / 1000)
      conStock[i] = hayLibro(i) ? stockInicio[i] > 0 || ventas[i] > 0 : null
    } else {
      // Sin libro: del ancla a las vendibles de hoy, en línea recta (solo para dibujar)
      const k = i - idxLeido
      const tramo = Math.max(1, n - 1 - idxLeido)
      stockInicio[i] = Math.max(0, Math.round(ancla + ((v - ancla) * (k - 1)) / tramo))
      conStock[i] = null
    }
  }
  const fiable = diasLibro === 0 ? true : negativos / diasLibro <= U.negativosMaxPct
  return { fechas, ventas, stockInicio, conStock, fiable, anclajeEstimado }
}

/* ------------------------------------------------------------------ */
/* h · Perfil semanal (D7)                                             */
/* ------------------------------------------------------------------ */

/** Semanas con stock que hacen falta para sacar un perfil propio (si no, el del cliente) */
export const SEMANAS_MINIMAS_PERFIL = 30

/** Un perfil plano (todos 1): índice 0 sin usar, 1..53 */
function perfilPlano(): number[] {
  return new Array<number>(54).fill(1)
}

/** Normaliza un perfil 1..53 a media 1 sobre las semanas 1..52 (la 53 no existe todos los años) */
function normalizarPerfil(p: number[]): number[] {
  let suma = 0
  for (let w = 1; w <= 52; w++) suma += p[w]
  const media = suma / 52
  const salida = perfilPlano()
  if (!(media > 0)) return salida
  for (let w = 1; w <= 53; w++) salida[w] = redondea(p[w] / media, 4)
  return salida
}

/**
 * El perfil semanal del año pasado: 53 factores (índice 1..53, el 0 no se usa) con
 * media 1. `null` si el año pasado vendió menos de 12 ud. `pico` = el factor más alto,
 * SIN topar (para la frase «×5,8: el plan usa ×1,8»).
 *
 * Con pocas unidades una semana suelta es ruido: se suaviza con la semana anterior y
 * la siguiente (¼ · ½ · ¼) y a cada semana se le suman 12 ud «de prior» repartidas por
 * igual: `factor = (semana + 12) / (media + 12)`. Con 12 ud en un año el perfil es casi
 * plano; con miles (Creative Toys) sale el pico de verdad. Lo prudente: se compra mercancía.
 *
 * Se supone que la entrada cubre el año entero (los días sin venta no hace falta mandarlos). Con `diasSinStock`, las semanas
 * sin stock llevan factor neutro; si quedan menos de 30 semanas con stock, null (el SKU no tiene año que enseñe nada).
 */
export function perfilSemanal(
  ventasAnoPasadoPorDia: Array<{ fecha: string; unidades: number }>,
  opciones?: { diasSinStock?: Iterable<string> },
): { perfil: number[]; pico: number } | null {
  const U = UMBRALES_RITMO.perfil
  const porSemana = new Array<number>(54).fill(0)
  let total = 0
  for (const d of ventasAnoPasadoPorDia) {
    const u = Math.max(0, Number(d.unidades) || 0)
    if (!u) continue
    porSemana[semanaIso(d.fecha)] += u
    total += u
  }
  if (total < U.minUnidades) return null
  // La 53 solo existe algunos años: se reparte con la 52 y la 1 para no inventar un pico
  if (porSemana[53] > 0) {
    porSemana[52] += porSemana[53] / 2
    porSemana[1] += porSemana[53] / 2
    porSemana[53] = 0
  }
  // Las semanas sin stock (o en las que el producto aún no existía) no son «demanda cero»: llevan la media de las
  // semanas con stock (factor neutro). Una semana cuenta como sin stock si le faltan ≥ 4 de sus 7 días.
  if (opciones?.diasSinStock) {
    const sinStock = new Array<number>(54).fill(0)
    for (const f of opciones.diasSinStock) sinStock[semanaIso(f)]++
    sinStock[52] += sinStock[53] / 2
    sinStock[1] += sinStock[53] / 2
    const validas: number[] = []
    for (let w = 1; w <= 52; w++) if (sinStock[w] < 4) validas.push(w)
    if (validas.length < 52) {
      if (validas.length < SEMANAS_MINIMAS_PERFIL) return null
      const totalValidas = validas.reduce((t, w) => t + porSemana[w], 0)
      if (totalValidas < U.minUnidades) return null
      const mediaValidas = totalValidas / validas.length
      const esValida = new Set(validas)
      total = 0
      for (let w = 1; w <= 52; w++) {
        if (!esValida.has(w)) porSemana[w] = mediaValidas
        total += porSemana[w]
      }
    }
  }
  const prev = (w: number) => (w === 1 ? 52 : w - 1)
  const sig = (w: number) => (w === 52 ? 1 : w + 1)
  const suave = perfilPlano()
  for (let w = 1; w <= 52; w++) suave[w] = 0.25 * porSemana[prev(w)] + 0.5 * porSemana[w] + 0.25 * porSemana[sig(w)]
  const media = total / 52
  const prior = U.priorPorSemana
  const crudo = perfilPlano()
  for (let w = 1; w <= 52; w++) crudo[w] = (suave[w] + prior) / (media + prior)
  crudo[53] = (crudo[52] + crudo[1]) / 2
  const perfil = normalizarPerfil(crudo)
  let pico = 0
  for (let w = 1; w <= 52; w++) pico = Math.max(pico, perfil[w])
  return { perfil, pico: redondea(pico, 2) }
}

/**
 * El perfil del cliente: media ponderada de los perfiles de sus SKU (peso = unidades del
 * año pasado, por ejemplo), normalizada a media 1. null si no hay ninguno con peso.
 */
export function perfilDelCliente(perfiles: Array<{ perfil: number[]; peso: number }>): number[] | null {
  const validos = perfiles.filter((p) => Array.isArray(p.perfil) && p.perfil.length >= 53 && p.peso > 0)
  if (validos.length === 0) return null
  const suma = new Array<number>(54).fill(0)
  let pesos = 0
  for (const { perfil, peso } of validos) {
    pesos += peso
    for (let w = 1; w <= 53; w++) suma[w] += (perfil[w] ?? 1) * peso
  }
  const media = perfilPlano()
  for (let w = 1; w <= 53; w++) media[w] = suma[w] / pesos
  return normalizarPerfil(media)
}

/** El factor de un perfil para una fecha (1 si no hay perfil) */
export function factorDeFecha(perfil: number[] | null | undefined, fecha: string): number {
  if (!perfil || perfil.length < 53) return 1
  const f = perfil[semanaIso(fecha)]
  return Number.isFinite(f) ? f : 1
}

/**
 * Lo que la simulación gasta un día: `base × factor de su semana × (1 − devolución) + merma`.
 * El perfil que lleva `RitmoSku` ya está relativo al periodo del que sale la base y topado.
 */
export function consumoDelDia(ritmo: RitmoSku, fecha: string): number {
  if (ritmo.base === null) return 0
  return Math.max(0, ritmo.base * factorDeFecha(ritmo.perfilSemanal, fecha) * (1 - ritmo.tasaDevolucionVendible) + ritmo.mermaDiaria)
}

/** Ritmo bruto de un día (sin devoluciones ni mermas) */
export function ritmoDelDia(ritmo: RitmoSku, fecha: string): number {
  if (ritmo.base === null) return 0
  return Math.max(0, ritmo.base * factorDeFecha(ritmo.perfilSemanal, fecha))
}

/* ------------------------------------------------------------------ */
/* d-i · El cálculo, sobre una serie con «peso» por día                */
/* ------------------------------------------------------------------ */

export interface OpcionesRitmo {
  /** Primera entrada al almacén (primer Receipt); con la serie no fiable, los días con stock cuentan desde aquí */
  primeraEntrada: string | null
  /** Perfil semanal (media 1 sobre el año) o null = plano */
  perfil: number[] | null
  origenPerfil: 'sku' | 'cliente' | 'modelo' | null
  /** Factor de pico del año pasado sin topar (de perfilSemanal) */
  picoAnoPasado: number | null
  topeEstacional: number
  /** [desde, hasta] del horizonte (`[hoy, hoy + L + T]`) para el factor informativo y el previsto */
  horizonte: [string, string]
  libro: Libro
  devolucionesVendibles90: number
  /** Mermas brutas de 90 días (ajustes + retiradas): solo para el aviso */
  mermas90: number
  /** Mermas que se proyectan como consumo (ajustes recurrentes, sin retiradas); si falta, se usa `mermas90` */
  mermasRecurrentes90?: number
}

/**
 * La serie que entiende el cálculo: ventas por día y un «peso» por día:
 *  - SKU: 1 con stock, 0 sin stock, null sin libro.
 *  - Modelo: los días-equivalentes del día (Σ cuota de las tallas con stock), 0..1.
 */
interface SeriePonderada {
  fechas: string[]
  ventas: number[]
  peso: Array<number | null>
  fiable: boolean
  anclajeEstimado: boolean
}

interface Extra {
  /** Para la frase del modelo */
  etiquetaDias: 'días con stock' | 'días-equivalentes'
  ventas180?: number
  /** Es la serie de un MODELO (todas sus tallas juntas): la confianza se mide con sus días-equivalentes y sus ventas (24 nov 2026) */
  modelo?: boolean
}

function pesoDeSerie(serie: SerieSku, primeraEntrada: string | null): Array<number | null> {
  if (serie.fiable) return serie.conStock.map((c) => (c === null ? null : c ? 1 : 0))
  // Serie no fiable: todos los días con libro desde la primera entrada cuentan con stock (prudente)
  let desde = primeraEntrada
  if (!desde) {
    const i = serie.conStock.findIndex((c) => c !== null)
    desde = i >= 0 ? serie.fechas[i] : null
  }
  return serie.conStock.map((c, i) => {
    if (c === null) return null
    if (serie.ventas[i] > 0) return 1
    return desde !== null && serie.fechas[i] >= desde ? 1 : 0
  })
}

const ORDEN_CONFIANZA: Confianza[] = ['sin_datos', 'baja', 'media', 'alta']
function minConfianza(a: Confianza, b: Confianza): Confianza {
  return ORDEN_CONFIANZA.indexOf(a) <= ORDEN_CONFIANZA.indexOf(b) ? a : b
}

function ritmoVacio(explicacion: string, extra?: Partial<RitmoSku>): RitmoSku {
  return {
    base: null, previsto: null, factorEstacional: 1, perfilSemanal: null, origenPerfil: null, picoAnoPasado: null,
    r14: null, r30: null, r60: null, r90: null,
    diasConStock90: 0, ventas90: 0, ventas30: 0, ventas180: 0,
    tendencia: null, confianza: 'sin_datos', origen: 'sku', ultimoPeriodoHasta: null,
    pedidoGrande: false, serieDeStockFiable: true, anclajeEstimado: false,
    tasaDevolucionVendible: 0, mermaDiaria: 0, consumoNeto: null,
    explicacion,
    ...extra,
  }
}

function calcular(sp: SeriePonderada, op: OpcionesRitmo, extra: Extra): RitmoSku {
  const U = UMBRALES_RITMO
  const n = sp.fechas.length
  let idxRef = -1
  for (let i = n - 1; i >= 0; i--) if (sp.peso[i] !== null) { idxRef = i; break }

  if (op.libro === 'sin_leer' || idxRef < 0) {
    return ritmoVacio(op.libro === 'sin_leer' ? 'Sin datos: las ventas de Amazon no se han leído' : 'Sin datos: no hay libro de movimientos', {
      serieDeStockFiable: sp.fiable, anclajeEstimado: sp.anclajeEstimado,
    })
  }
  /** Índices del calendario de los últimos W días hasta la referencia */
  const desdeIdx = (w: number) => Math.max(0, idxRef - w + 1)

  // Ventas brutas por ventana (solo días con libro)
  const ventasEn = (w: number) => {
    let s = 0
    for (let i = desdeIdx(w); i <= idxRef; i++) if (sp.peso[i] !== null) s += sp.ventas[i]
    return s
  }
  const ventas30 = ventasEn(30)
  const ventas60 = ventasEn(60)
  const ventas90 = ventasEn(90)
  const ventas180 = extra.ventas180 ?? ventasEn(180)

  // d · Recorte de días atípicos
  const conVenta90: number[] = []
  for (let i = desdeIdx(90); i <= idxRef; i++) if (sp.peso[i] !== null && sp.ventas[i] > 0) conVenta90.push(sp.ventas[i])
  let conVentaRef = conVenta90
  if (conVentaRef.length === 0) {
    conVentaRef = []
    for (let i = idxRef; i >= 0 && conVentaRef.length < 90; i--) if (sp.peso[i] !== null && sp.ventas[i] > 0) conVentaRef.push(sp.ventas[i])
  }
  const tope = topeAtipico(conVentaRef)
  const recortadas = sp.ventas.map((v) => Math.min(v, tope))
  let recortado90 = 0
  let fueraDelPico90 = 0
  let diaMasGrande: { fecha: string; ud: number } | null = null
  for (let i = desdeIdx(90); i <= idxRef; i++) {
    if (sp.peso[i] === null) continue
    const v = sp.ventas[i]
    if (v > tope) {
      recortado90 += v - tope
      if (!diaMasGrande || v > diaMasGrande.ud) diaMasGrande = { fecha: sp.fechas[i], ud: v }
    } else fueraDelPico90 += v
  }
  const pedidoGrande = ventas90 > 0 && recortado90 > U.pedidoGrandePct * ventas90

  // e · Ventanas
  const r: Record<number, number | null> = {}
  const diasCon: Record<number, number> = {}
  for (const w of U.ventanas) {
    let d = 0
    let s = 0
    for (let i = desdeIdx(w); i <= idxRef; i++) {
      const p = sp.peso[i]
      if (p === null) continue
      d += p
      s += recortadas[i]
    }
    diasCon[w] = d
    // Un modelo junta todas sus tallas: con 14 días-equivalentes en 90 ya tiene sus 90 días (una talla suelta necesita 30). Si no, se iba a su
    // «último periodo con stock» hacia atrás y mezclaba meses viejos con un lanzamiento reciente (725A BURDEOS de Cobo)
    const minimo = extra.modelo && w === 90 ? U.minDiasModelo90 : U.minDias[w]
    r[w] = d >= minimo && d > 0 ? s / d : null
  }
  const diasConStock90 = redondea(diasCon[90], 1)

  // f · Base ponderada
  let base: number | null = null
  let soloR90 = false
  const r14Usado = r[14] !== null && r[90] !== null ? Math.min(r[14]!, U.r14TopeSobreR90 * r[90]!) : r[14]
  {
    const partes: Array<[number, number]> = []
    if (r14Usado !== null) partes.push([r14Usado, U.pesos[14]])
    if (r[30] !== null) partes.push([r[30]!, U.pesos[30]])
    if (r[90] !== null) partes.push([r[90]!, U.pesos[90]])
    const sumaPesos = partes.reduce((a, [, p]) => a + p, 0)
    if (sumaPesos > 0) base = partes.reduce((a, [x, p]) => a + x * p, 0) / sumaPesos
    soloR90 = r[90] !== null && r14Usado === null && r[30] === null
  }

  // D8 · Sin ninguna ventana: el último periodo con stock (hasta donde llegue la serie)
  let origen: RitmoSku['origen'] = 'sku'
  let ultimoPeriodoHasta: string | null = null
  let indicesBase: number[] = []
  let diasUltimo = 0
  let ventasUltimo = 0
  if (base === null) {
    let d = 0
    let s = 0
    let ventasP = 0
    const idx: number[] = []
    for (let i = idxRef; i >= 0 && d < U.ultimoPeriodo.dias; i--) {
      const p = sp.peso[i]
      if (p === null || p <= 0) continue
      if (ultimoPeriodoHasta === null) ultimoPeriodoHasta = sp.fechas[i]
      d += p
      s += recortadas[i]
      ventasP += sp.ventas[i]
      idx.push(i)
    }
    if (d >= U.ultimoPeriodo.minDias && ventasP >= U.ultimoPeriodo.minVentas && s > 0) {
      base = s / d
      origen = 'ultimo_periodo'
      indicesBase = idx
      diasUltimo = d
      ventasUltimo = ventasP
    } else {
      ultimoPeriodoHasta = null
    }
  } else {
    for (let i = desdeIdx(90); i <= idxRef; i++) if ((sp.peso[i] ?? 0) > 0) indicesBase.push(i)
  }

  // i · Confianza
  const C = U.confianza
  let confianza: Confianza
  if (base === null) confianza = 'sin_datos'
  // Un modelo que ha vendido bastante en su último periodo con stock (≥ 21 días-equivalentes y ≥ 15 ud) no es un dato flojo: es que se ha
  // agotado hace poco. Para una talla suelta sigue siendo baja
  else if (origen === 'ultimo_periodo') confianza = extra.modelo && diasUltimo >= C.media.dias && ventasUltimo >= C.alta.ventas ? 'media' : 'baja'
  else if (diasConStock90 < C.sinDatos.dias || ventas90 < C.sinDatos.ventas) confianza = 'sin_datos'
  else if (pedidoGrande && fueraDelPico90 < U.pedidoGrandeMinFuera) confianza = 'sin_datos'
  // «Solo hay 90 días» rebaja a una talla (sus 14/30 días no llegan), pero un modelo con sus días-equivalentes y sus ventas se mide por ellos:
  // F0047 BURDEOS de ShoesF, 36 pares en 33 días-equivalentes, salía «baja» porque se agotó en las últimas semanas
  else if (soloR90 && !extra.modelo) confianza = 'baja'
  else if (diasConStock90 >= C.alta.dias && ventas90 >= C.alta.ventas) confianza = 'alta'
  else if (diasConStock90 >= C.media.dias && ventas90 >= C.media.ventas) confianza = 'media'
  else confianza = 'baja'
  if (!sp.fiable) confianza = minConfianza(confianza, 'media')

  // g · Tendencia (solo se informa)
  let tendencia: RitmoSku['tendencia'] = null
  if (ventas60 >= U.tendencia.ventas60Min && r[14] !== null && r[60] !== null && r[60]! > 0) {
    const q = r[14]! / r[60]!
    tendencia = q >= U.tendencia.sube ? 'sube' : q <= U.tendencia.baja ? 'baja' : 'estable'
  }

  // h · Estacionalidad: perfil relativo al periodo del que sale la base, topado
  let perfilRel: number[] | null = null
  let factorEstacional = 1
  let previsto = base
  let maxSinTopar: { factor: number; semana: number } | null = null
  if (base !== null && op.perfil && op.perfil.length >= 53) {
    let sumaP = 0
    let sumaW = 0
    for (const i of indicesBase) {
      const w = sp.peso[i] ?? 0
      sumaP += factorDeFecha(op.perfil, sp.fechas[i]) * w
      sumaW += w
    }
    const mediaVentana = sumaW > 0 ? Math.max(0.05, sumaP / sumaW) : 1
    const tope = Math.max(1, op.topeEstacional || 1)
    perfilRel = perfilPlano()
    const sinTopar = perfilPlano()
    for (let w = 1; w <= 53; w++) {
      const f = (op.perfil[w] ?? 1) / mediaVentana
      sinTopar[w] = f
      perfilRel[w] = redondea(Math.min(tope, f), 4)
    }
    const [hDesde, hHasta] = op.horizonte
    const diasH = Math.max(0, diasEntre(hDesde, hHasta)) + 1
    if (hHasta >= hDesde) {
      let suma = 0
      let max = -Infinity
      for (let k = 0; k < diasH; k++) {
        const f = sumarDias(hDesde, k)
        const w = semanaIso(f)
        suma += perfilRel[w]
        max = Math.max(max, perfilRel[w])
        if (sinTopar[w] > tope && (!maxSinTopar || sinTopar[w] > maxSinTopar.factor)) maxSinTopar = { factor: sinTopar[w], semana: w }
      }
      factorEstacional = redondea(max, 2)
      previsto = base * (suma / diasH)
    }
  }

  // D12 · Consumo neto
  const tasaDevolucionVendible = ventas90 > 0 ? Math.min(U.devolucionTope, Math.max(0, op.devolucionesVendibles90) / ventas90) : 0
  // La merma que se proyecta: solo la recurrente y nunca más del 30 % de lo que vende (una retirada no es demanda)
  const mermaProyectable = Math.max(0, op.mermasRecurrentes90 ?? op.mermas90) / 90
  const mermaDiaria = base === null ? 0 : Math.min(mermaProyectable, U.mermaTopeSobreBase * base)
  const consumoNeto = previsto === null ? null : previsto * (1 - tasaDevolucionVendible) + mermaDiaria

  // Frase
  const frases: string[] = []
  if (base === null) {
    frases.push(`Sin datos suficientes: ${num(ventas90, 0)} ud en 90 días con ${num(diasConStock90, 0)} ${extra.etiquetaDias}`)
  } else if (origen === 'ultimo_periodo') {
    frases.push(`${num(base, 2)} ud/día en el último periodo con stock (${num(diasUltimo, 0)} ${extra.etiquetaDias}, hasta el ${fechaCorta(ultimoPeriodoHasta!)}): lleva agotado desde entonces`)
  } else {
    const ventanas = [r14Usado !== null ? '14' : null, r[30] !== null ? '30' : null, r[90] !== null ? '90' : null].filter(Boolean).join('/')
    frases.push(`${num(base, base < 1 ? 2 : 1)} ud/día · media de ${ventanas} días con stock (${num(diasConStock90, 0)} de 90${extra.etiquetaDias === 'días-equivalentes' ? ' en días-equivalentes' : ''})`)
    if (r[14] !== null && r14Usado !== null && r14Usado < r[14]!) frases.push(`las 2 últimas semanas (${num(r[14]!, 1)} ud/día) cuentan como mucho el doble de 90 días`)
  }
  if (base !== null && confianza === 'sin_datos') {
    frases.unshift(`Sin datos suficientes (${num(ventas90, 0)} ud en 90 días con ${num(diasConStock90, 0)} ${extra.etiquetaDias})`)
  }
  if (pedidoGrande && diaMasGrande) frases.push(`un pedido de ${num(diaMasGrande.ud, 0)} ud el ${fechaCorta(diaMasGrande.fecha)} no cuenta como ritmo (se cuenta hasta ${num(tope, 0)})`)
  if (tendencia === 'sube') frases.push('tendencia al alza')
  if (tendencia === 'baja') frases.push('tendencia a la baja')
  if (perfilRel && base !== null) {
    const orig = op.origenPerfil === 'cliente' ? 'del cliente' : op.origenPerfil === 'modelo' ? 'del modelo' : 'del año pasado'
    if (maxSinTopar) frases.push(`el año pasado ×${num(maxSinTopar.factor, 1)} en la semana ${maxSinTopar.semana}: el plan usa ×${num(Math.max(1, op.topeEstacional), 1)} (tope del cliente)`)
    else if (Math.abs((previsto ?? 0) - base) / Math.max(base, 1e-9) >= 0.05) frases.push(`estacionalidad ${orig}: ${num(previsto!, base < 1 ? 2 : 1)} ud/día en el horizonte`)
  }
  if (tasaDevolucionVendible >= 0.05) frases.push(`vuelve vendible el ${num(tasaDevolucionVendible * 100, 0)} % de lo vendido`)
  if (op.mermas90 > 0 && ventas90 > 0 && op.mermas90 / ventas90 >= 0.05) frases.push(`pierde ${num(op.mermas90, 0)} ud en 90 días por mermas y retiradas`)
  if (!sp.fiable) frases.push('el libro no cuadra con el stock: se cuentan con stock todos los días desde la primera entrada')
  if (sp.anclajeEstimado) frases.push('el libro va atrasado: el stock de esos días es estimado')
  const explicacion = frases.join(' · ').replace(/^./, (c) => c.toUpperCase())

  const r4 = (x: number | null) => (x === null ? null : redondea(x, 4))
  return {
    base: r4(base), previsto: r4(previsto), factorEstacional,
    perfilSemanal: perfilRel, origenPerfil: perfilRel ? op.origenPerfil : null, picoAnoPasado: op.picoAnoPasado,
    r14: r4(r[14]), r30: r4(r[30]), r60: r4(r[60]), r90: r4(r[90]),
    diasConStock90, ventas90, ventas30, ventas180,
    tendencia, confianza, origen, ultimoPeriodoHasta,
    pedidoGrande, serieDeStockFiable: sp.fiable, anclajeEstimado: sp.anclajeEstimado,
    tasaDevolucionVendible: redondea(tasaDevolucionVendible, 4), mermaDiaria: redondea(mermaDiaria, 4),
    consumoNeto: r4(consumoNeto),
    explicacion,
  }
}

/** El ritmo robusto de un SKU sobre su serie diaria (§2.3 d-i, D8, D12) */
export function ritmoRobusto(serie: SerieSku, opciones: OpcionesRitmo): RitmoSku {
  return calcular(
    { fechas: serie.fechas, ventas: serie.ventas, peso: pesoDeSerie(serie, opciones.primeraEntrada), fiable: serie.fiable, anclajeEstimado: serie.anclajeEstimado },
    opciones,
    { etiquetaDias: 'días con stock' },
  )
}

/* ------------------------------------------------------------------ */
/* j · Modelo repartido por tallas (D5.2, D6)                          */
/* ------------------------------------------------------------------ */

export interface OpcionesModelo {
  /** Nombre del modelo para la frase («262 BURDEO») */
  modelo: string
  /** Lo común a todas las tallas */
  comun: Omit<OpcionesRitmo, 'primeraEntrada' | 'devolucionesVendibles90' | 'mermas90' | 'mermasRecurrentes90'>
  /** Lo propio de cada talla (si falta: sin primera entrada, sin devoluciones ni mermas) */
  porSku?: Record<string, { primeraEntrada: string | null; devolucionesVendibles90: number; mermas90: number; mermasRecurrentes90?: number }>
}

/**
 * El ritmo de cada talla de un modelo. Devuelve una entrada por cada talla recibida:
 *
 * - Tallas con `continuidad = false`: su ritmo propio (origen 'sku'); no entran en el reparto.
 * - Curva de tallas (180 días): Laplace SOLO entre las tallas activas con ≥ 1 venta en
 *   180 días: `cuota = (ventas180 + 1) / (Σ ventas180 + n)`. Las activas sin ventas en
 *   180 días tienen cuota 0 (el planificador las saca como `talla_sin_ventas`).
 * - Ritmo del modelo con días-equivalentes (D6): cada día cuenta Σ cuota de las tallas
 *   con stock ese día. Si solo queda la mitad de la curva, el día vale medio.
 * - Si el modelo tiene confianza ≥ media: la talla con confianza propia alta usa la suya;
 *   las demás, `ritmo del modelo × cuota` con origen 'modelo'. Si no, cada una la suya.
 */
export function ritmoPorModelo(
  tallas: Array<{ sku: string; serie: SerieSku; continuidad: boolean; ventas180: number }>,
  opciones: OpcionesModelo,
): Map<string, RitmoSku> {
  const salida = new Map<string, RitmoSku>()
  const deSku = (sku: string) => opciones.porSku?.[sku] ?? { primeraEntrada: null, devolucionesVendibles90: 0, mermas90: 0 }
  const propios = new Map<string, RitmoSku>()
  for (const t of tallas) propios.set(t.sku, ritmoRobusto(t.serie, { ...opciones.comun, ...deSku(t.sku) }))

  const activas = tallas.filter((t) => t.continuidad)
  for (const t of tallas) if (!t.continuidad) salida.set(t.sku, propios.get(t.sku)!)
  if (activas.length === 0) return salida

  // Curva de 180 días
  const conVenta = activas.filter((t) => t.ventas180 >= 1)
  const totalVentas = conVenta.reduce((a, t) => a + t.ventas180, 0)
  const cuota = new Map<string, number>()
  for (const t of activas) cuota.set(t.sku, t.ventas180 >= 1 ? (t.ventas180 + 1) / (totalVentas + conVenta.length) : 0)
  if (conVenta.length === 0) {
    for (const t of activas) salida.set(t.sku, propios.get(t.sku)!)
    return salida
  }

  // Serie del modelo, alineada por fecha con la de la primera talla activa
  const fechas = activas[0].serie.fechas
  const ventas = new Array<number>(fechas.length).fill(0)
  const peso: Array<number | null> = new Array<number | null>(fechas.length).fill(null)
  for (const t of activas) {
    const pesoT = pesoDeSerie(t.serie, deSku(t.sku).primeraEntrada)
    const indice = new Map<string, number>()
    t.serie.fechas.forEach((f, i) => indice.set(f, i))
    const q = cuota.get(t.sku) ?? 0
    for (let i = 0; i < fechas.length; i++) {
      const j = indice.get(fechas[i])
      if (j === undefined) continue
      const p = pesoT[j]
      if (p === null) continue
      // Las ventas de una talla sin cuota (nada en 180 días) no suman: su día no cuenta
      if (q > 0) ventas[i] += t.serie.ventas[j]
      peso[i] = (peso[i] ?? 0) + q * p
    }
  }
  const sumaPor = (campo: 'devolucionesVendibles90' | 'mermas90') => activas.reduce((a, t) => a + (deSku(t.sku)[campo] || 0), 0)
  const recurrentesModelo = activas.reduce((a, t) => { const d = deSku(t.sku); return a + (d.mermasRecurrentes90 ?? d.mermas90 ?? 0) }, 0)
  const ritmoModelo = calcular(
    {
      fechas, ventas, peso: peso.map((p) => (p === null ? null : Math.min(1, p))),
      fiable: activas.every((t) => t.serie.fiable),
      anclajeEstimado: activas.some((t) => t.serie.anclajeEstimado),
    },
    { ...opciones.comun, primeraEntrada: null, devolucionesVendibles90: sumaPor('devolucionesVendibles90'), mermas90: sumaPor('mermas90'), mermasRecurrentes90: recurrentesModelo },
    { etiquetaDias: 'días-equivalentes', ventas180: totalVentas, modelo: true },
  )

  // Cuándo manda el modelo (24 nov 2026): siempre que tenga ritmo y su confianza no sea PEOR que la de la talla, salvo que la talla tenga la suya
  // alta. Antes solo mandaba con confianza media o alta del modelo, y una talla con 5 ventas en 90 días se quedaba con su ritmo suelto (o el de
  // su último periodo con stock) aunque el modelo tuviera 36: en ShoesF, 135 de 413 tallas
  const rango = (c: Confianza) => ORDEN_CONFIANZA.indexOf(c)
  const delPeriodo = ritmoModelo.origen === 'ultimo_periodo'
  for (const t of activas) {
    const propio = propios.get(t.sku)!
    const modeloVale = ritmoModelo.base !== null && ritmoModelo.confianza !== 'sin_datos' && rango(ritmoModelo.confianza) >= rango(propio.confianza)
    // Una talla con sus propias ventanas de 14/30/90 días (confianza media o más) no se pisa con el ritmo de un periodo VIEJO del modelo: 725A BURDEOS
    // de Cobo salió el 3 nov y vendió 9 pares en 7 días; el periodo del modelo hacia atrás lo diluía con meses flojos
    const periodoViejoContraVentanas = delPeriodo && propio.origen === 'sku' && rango(propio.confianza) >= rango('media')
    if (!modeloVale || propio.confianza === 'alta' || periodoViejoContraVentanas) {
      salida.set(t.sku, propio)
      continue
    }
    const q = cuota.get(t.sku) ?? 0
    const tallaAgotada = propio.origen === 'ultimo_periodo' && propio.ultimoPeriodoHasta !== null
    const escala = (x: number | null) => (x === null ? null : redondea(x * q, 4))
    const tasa = ritmoModelo.tasaDevolucionVendible
    const merma = propio.mermaDiaria
    const previsto = escala(ritmoModelo.previsto)
    const ventasTalla180 = t.ventas180
    const explicacion = q === 0
      ? `La talla ${tallaDeSku(t.sku)} no ha vendido en 180 días: cuota 0 en el reparto del modelo ${opciones.modelo}`
      : `Ritmo del modelo ${opciones.modelo}${delPeriodo ? ` en su último periodo con stock (hasta el ${fechaCorta(ritmoModelo.ultimoPeriodoHasta!)})` : ''}${tallaAgotada ? ` (esta talla, sin stock desde el ${fechaCorta(propio.ultimoPeriodoHasta!)})` : ''} repartido por tallas: ${num(ritmoModelo.base!, 2)} ud/día del modelo × cuota ${num(q * 100, 1)} % (${num(ventasTalla180, 0)} de ${num(totalVentas, 0)} ud en 180 días) = ${num(ritmoModelo.base! * q, 2)} ud/día`
    salida.set(t.sku, {
      ...propio,
      base: escala(ritmoModelo.base),
      previsto,
      factorEstacional: ritmoModelo.factorEstacional,
      perfilSemanal: ritmoModelo.perfilSemanal,
      origenPerfil: ritmoModelo.origenPerfil,
      picoAnoPasado: ritmoModelo.picoAnoPasado,
      r14: escala(ritmoModelo.r14), r30: escala(ritmoModelo.r30), r60: escala(ritmoModelo.r60), r90: escala(ritmoModelo.r90),
      ventas180: ventasTalla180,
      tendencia: ritmoModelo.tendencia,
      confianza: ritmoModelo.confianza,
      // Agotada: con la fecha en que ESTA talla tuvo stock por última vez (o, si la talla no la tiene, la del modelo). El planificador pregunta
      // «¿se repone?» por talla si lleva más de 76 días sin stock: en ShoesF, 7 tallas de 8674 OCEANO agotadas desde julio no se proponen a ciegas
      // porque la 44 tuviera stock hasta el 26 oct
      origen: tallaAgotada || delPeriodo ? 'ultimo_periodo' : 'modelo',
      ultimoPeriodoHasta: tallaAgotada ? propio.ultimoPeriodoHasta : delPeriodo ? ritmoModelo.ultimoPeriodoHasta : null,
      deModelo: true,
      pedidoGrande: propio.pedidoGrande || ritmoModelo.pedidoGrande,
      tasaDevolucionVendible: tasa,
      consumoNeto: previsto === null ? null : redondea(previsto * (1 - tasa) + merma, 4),
      explicacion,
    })
  }
  return salida
}

/** La parte final del SKU que parece una talla («FBA035188-38» → «38»), o el SKU */
function tallaDeSku(sku: string): string {
  const m = /(\d{2}(?:[.,]5)?)(?:\s*FBA)?\s*$/i.exec(sku)
  return m ? m[1].replace(',', '.') : sku
}
