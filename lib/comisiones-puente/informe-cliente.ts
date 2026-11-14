/**
 * EL INFORME DE COMISIÓN QUE VE EL CLIENTE, YA CONVERTIDO EN LO QUE SE PINTA.
 *
 * Cada cliente tiene su concepto: unos pagan un porcentaje de lo que venden (Ham Master, Bodegas Valhalla), otros solo el
 * EXCEDENTE sobre el año anterior (ShoesF, Farmacia Garrachón) o sobre una base mensual pactada (Shoplamp), uno paga sobre
 * el BENEFICIO (Creative Toys, DIRU, SAUSI) y uno parte la comisión por marcas (Keslem). Pintarlos todos con las mismas
 * cuatro tarjetas es lo que hacía que un cliente leyera «Base neta» donde su base era el beneficio.
 *
 * Esto es una función PURA: recibe lo guardado en `commission_reports.data` y devuelve textos ya formateados, con las
 * columnas que le tocan a ese concepto. La pantalla solo los pone en la página, y así lo que se comprueba en las pruebas
 * es lo que sale.
 *
 *
 * ============ NADA DE ARITMÉTICA QUE NO CUADRE ============
 *
 * La cadena «ventas − devoluciones − IVA = base neta» solo se escribe si los números del informe de verdad la cumplen
 * (con unos céntimos de margen). Si no cuadran, se enseñan las cifras sueltas y NO se pone un «=» que el cliente podría
 * comprobar con la calculadora y ver que miente.
 *
 *
 * ============ LO QUE NO SE ENSEÑA ============
 *
 * El fee, los nombres internos de los procesos y qué tipos de transacción se suman o se ignoran. Un documento para el cliente
 * describe lo que ha pasado con SUS números, con la cifra delante.
 */

export type ModoInforme = 'estandar' | 'lineas' | 'beneficio' | 'beneficio_simple' | 'comparacion_anual' | 'baseline' | 'por_marca'

export interface ColumnaInforme {
  id: string
  titulo: string
  alinear: 'izq' | 'der'
}

export interface TablaInforme {
  titulo: string
  subtitulo?: string
  columnas: ColumnaInforme[]
  filas: string[][]
  /** Fila de totales, con una celda por columna ('' donde no aplique) */
  total?: string[]
  /** Texto del buscador, si lo que se puede buscar no es lo de siempre (producto, ASIN, pedido o fecha) */
  buscador?: string
}

export interface PasoDeCalculo {
  texto: string
  valor: string
  /** `resta` se pinta con el signo, `resultado` en negrita y con la línea encima */
  tipo?: 'normal' | 'resta' | 'resultado'
}

export interface InformeCliente {
  modo: ModoInforme
  cliente: string
  periodo: string
  principal: { rotulo: string; valor: string; detalle: string }
  cifras: Array<{ rotulo: string; valor: string; nota?: string }>
  calculo: { titulo: string; pasos: PasoDeCalculo[]; nota?: string }
  tablas: TablaInforme[]
  detalle: TablaInforme | null
  lectura: string[]
  avisos: string[]
}

/* ------------------------------------------------------------------ */
/* Formato                                                             */
/* ------------------------------------------------------------------ */

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const hay = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** 1.234,56 € — con separador de miles también en cuatro cifras, que `es-ES` por defecto no pone */
export function dinero(valor: number, moneda = 'EUR'): string {
  try {
    return conMiles(
      new Intl.NumberFormat('es-ES', {
        style: 'currency',
        currency: moneda || 'EUR',
        currencyDisplay: 'narrowSymbol',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(valor)
    )
  } catch {
    return valor.toFixed(2).replace('.', ',')
  }
}

/** Para un importe que se resta: el signo delante, sin que el cero salga como «-0,00 €» */
const menos = (valor: number, moneda?: string) => (Math.abs(valor) < 0.005 ? dinero(0, moneda) : `−\u00a0${dinero(Math.abs(valor), moneda)}`)

export function porcentaje(tasa: number): string {
  return `${(tasa * 100).toLocaleString('es-ES', { maximumFractionDigits: 2 })} %`
}

/** `es-ES` no pone el punto de miles en cuatro cifras («1158»): se añade para que todas las cifras del informe se lean igual */
const conMiles = (texto: string) => texto.replace(/^(-?\d)(\d{3})(?!\d)/, '$1.$2')
const entero = (v: unknown) => conMiles(num(v).toLocaleString('es-ES', { maximumFractionDigits: 0 }))

const MESES_ABREVIADOS: Record<string, string> = {
  jan: '01', ene: '01', feb: '02', mar: '03', apr: '04', abr: '04', may: '05', jun: '06', jul: '07', aug: '08', ago: '08',
  sep: '09', sept: '09', oct: '10', nov: '11', dec: '12', dic: '12',
}

/** «20-Sept-2026 UTC» (así lo da Amazon) -> «20/09/2026». Lo que no se reconozca se deja como venga */
export function fechaCorta(texto: unknown): string {
  if (typeof texto !== 'string' || !texto.trim()) return '—'
  const m = texto.trim().match(/^(\d{1,2})-([A-Za-z]{3,4})-(\d{4})/)
  const mes = m ? MESES_ABREVIADOS[m[2].toLowerCase()] : undefined
  return m && mes ? `${m[1].padStart(2, '0')}/${mes}/${m[3]}` : texto.trim()
}

/** Margen de céntimos con el que se acepta que una cadena de cuentas «cuadra» */
const CUADRA = 0.05
const cuadra = (a: number, b: number) => Math.abs(a - b) <= CUADRA

/**
 * Corta el nombre del producto en la primera coma, « - » o « | »: el título de Amazon es larguísimo. Antes le quita la cola
 * que añade Sellerboard («COG: 3,25 / Price: 19,99»), que además lleva una coma donde se partía el nombre.
 */
export function nombreCorto(titulo: unknown): string {
  const s = typeof titulo === 'string' ? titulo.replace(/\s*(COG:|\/\s*Price:).*$/i, '').trim() : ''
  if (!s) return '—'
  const cortes = [s.indexOf(','), s.indexOf(' - '), s.indexOf(' | ')].filter((i) => i >= 0)
  return cortes.length > 0 ? s.slice(0, Math.min(...cortes)).trim() : s
}

/* ------------------------------------------------------------------ */
/* Lo guardado, con la forma que tiene                                 */
/* ------------------------------------------------------------------ */

interface Fila {
  asin?: string
  productTitle?: string
  orderId?: string
  date?: string
  currency?: string
  transactionTypeLabel?: string
  quantity?: number
  grossSales?: number
  refunds?: number
  netBase?: number
  iva?: number
  taxAmount?: number
  baseProductNet?: number
  baseShippingNet?: number
  promoNet?: number
  netLine?: number
  commission?: number
  commissionRate?: number
  currentYearNetBase?: number
  previousYearNetBase?: number
  costOfGoods?: number
  amazonFees?: number
  adsSpend?: number
  netProfit?: number
  margin?: number
  rowNumber?: number
}

interface AnoDelCalculo {
  netBase?: number
  grossProduct?: number
  grossShipping?: number
  refundsProduct?: number
  refundsShipping?: number
}

interface Resumen {
  totalSales?: number
  totalRefunds?: number
  realTurnover?: number
  totalIva?: number
  netBase?: number
  totalCommission?: number
  averageCommissionRate?: number
  commissionRateUsed?: number
  totalOrders?: number
  modoCalculo?: string
  totalBenefits?: number
  totalCostOfGoods?: number
  totalAmazonFees?: number
  totalAds?: number
  baselineAmount?: number
  excessAmount?: number
  /** Shoplamp: el envío del mes (Sellerboard) que se resta de la base neta antes de la base acordada */
  shippingDeducted?: number
  previousYearNetBase?: number
  currentYearNetBase?: number
  byCurrency?: Record<string, { currency?: string; unitsGross?: number; unitsNet?: number; netBase?: number; iva?: number; totalInclusive?: number; commission?: number }>
  byJurisdiction?: Record<string, { jurisdiction?: string; previousYearNetBase?: number; currentYearNetBase?: number; excessAmount?: number }>
  calculationBreakdown?: { currentYear?: AnoDelCalculo; previousYear?: AnoDelCalculo }
}

interface DatosPorMarca {
  modo: 'por_marca'
  marca?: string | null
  catalogoReferencias?: number
  bloques: Array<{ etiqueta: string; anterior: number; actual: number; excedente: number; tasa: number; comision: number }>
  sinUbicar?: { anterior: number; actual: number; total: number }
  totalComision: number
}

const esPorMarca = (d: unknown): d is DatosPorMarca =>
  typeof d === 'object' && d !== null && (d as { modo?: unknown }).modo === 'por_marca' && Array.isArray((d as { bloques?: unknown }).bloques)

export function modoDe(data: unknown): ModoInforme {
  if (esPorMarca(data)) return 'por_marca'
  const d = data as { summary?: Resumen; rows?: Fila[] } | null
  const s = d?.summary ?? {}
  const filas = d?.rows ?? []
  if (s.modoCalculo === 'beneficio') return 'beneficio'
  if (s.baselineAmount !== undefined) return 'baseline'
  if (s.excessAmount !== undefined && s.previousYearNetBase !== undefined) return 'comparacion_anual'
  // DIRU y SAUSI: la comisión se calcula sobre el beneficio, aunque el informe no lleve la marca de Sellerboard
  if (s.totalBenefits !== undefined) return 'beneficio_simple'
  if (filas.length > 0 && filas[0].transactionTypeLabel != null) return 'lineas'
  return 'estandar'
}

const PAISES: Record<string, string> = {
  SPAIN: 'España', PORTUGAL: 'Portugal', FRANCE: 'Francia', GERMANY: 'Alemania', ITALY: 'Italia', 'UNITED KINGDOM': 'Reino Unido',
  NETHERLANDS: 'Países Bajos', BELGIUM: 'Bélgica', POLAND: 'Polonia', SWEDEN: 'Suecia', IRELAND: 'Irlanda', AUSTRIA: 'Austria',
  'UNITED STATES': 'Estados Unidos', 'CZECH REPUBLIC': 'Chequia', DENMARK: 'Dinamarca', SWITZERLAND: 'Suiza', ROMANIA: 'Rumanía',
}
/** El país como lo da Amazon («SPAIN») en español; lo que no esté en la lista se deja con la inicial en mayúscula */
export function nombreDePais(p: unknown): string {
  const t = typeof p === 'string' ? p.trim() : ''
  if (!t) return '—'
  return PAISES[t.toUpperCase()] ?? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()
}

/** Las tasas distintas que aparecen en las líneas, de más a menos usadas: «3 % (35 líneas) · 1 % (4)» */
function tasasDeLasLineas(filas: Fila[]): Array<{ tasa: number; lineas: number }> {
  const cuenta = new Map<number, number>()
  for (const f of filas) {
    if (!hay(f.commissionRate) || f.commissionRate <= 0) continue
    const t = Math.round(f.commissionRate * 10000) / 10000
    cuenta.set(t, (cuenta.get(t) ?? 0) + 1)
  }
  return [...cuenta.entries()].map(([tasa, lineas]) => ({ tasa, lineas })).sort((a, b) => b.lineas - a.lineas)
}

const sumar = (filas: Fila[], campo: keyof Fila): number => filas.reduce((s, f) => s + num(f[campo]), 0)

/**
 * UNA FILA POR PRODUCTO, NO POR VENTA.
 *
 * El informe de pedidos de Sellerboard trae una línea por venta: 762 filas de 41 productos, con el mismo juego repetido 153
 * veces. Aquí se juntan por ASIN y se suma todo, así que el pie de la tabla sigue dando lo mismo. El margen se recalcula sobre
 * lo sumado (no se suman porcentajes). El título es el más repetido: el mismo ASIN llega con varios, y una línea que solo es
 * una devolución no trae ninguno.
 */
function agruparPorProducto(filas: Fila[]): Fila[] {
  const grupos = new Map<string, Fila[]>()
  for (const f of filas) {
    const clave = f.asin || nombreCorto(f.productTitle)
    grupos.set(clave, [...(grupos.get(clave) ?? []), f])
  }
  return [...grupos.values()].map((g) => {
    const titulos = new Map<string, number>()
    for (const f of g) {
      if (typeof f.productTitle !== 'string' || !f.productTitle.trim()) continue
      const t = nombreCorto(f.productTitle)
      titulos.set(t, (titulos.get(t) ?? 0) + 1)
    }
    const beneficio = g.reduce((a, f) => a + num(f.netProfit ?? f.netBase), 0)
    const ventas = sumar(g, 'grossSales')
    return {
      asin: g[0].asin,
      productTitle: [...titulos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0],
      quantity: g.some((f) => hay(f.quantity)) ? sumar(g, 'quantity') : undefined,
      grossSales: ventas,
      refunds: sumar(g, 'refunds'),
      costOfGoods: sumar(g, 'costOfGoods'),
      amazonFees: sumar(g, 'amazonFees'),
      adsSpend: sumar(g, 'adsSpend'),
      netProfit: beneficio,
      netBase: sumar(g, 'netBase'),
      margin: ventas > 0 ? beneficio / ventas : undefined,
      commission: sumar(g, 'commission'),
      commissionRate: g.find((f) => hay(f.commissionRate))?.commissionRate,
    }
  })
}

/* ------------------------------------------------------------------ */
/* El constructor                                                      */
/* ------------------------------------------------------------------ */

export function construirInforme(entrada: { cliente: string; periodo: string | null; data: unknown }): InformeCliente {
  const periodo = entrada.periodo?.trim() || ''
  const cliente = entrada.cliente?.trim() || 'Cliente'
  const modo = modoDe(entrada.data)

  if (modo === 'por_marca') return informePorMarca(cliente, periodo, entrada.data as DatosPorMarca)

  const d = entrada.data as { summary: Resumen; rows: Fila[] }
  const s = d.summary ?? {}
  const filas = d.rows ?? []
  const comision = num(s.totalCommission)
  const rotuloComision = periodo ? `Comisión de ${periodo}` : 'Comisión'

  switch (modo) {
    case 'beneficio':
      return informeBeneficio(cliente, periodo, s, filas, rotuloComision, false)
    case 'beneficio_simple':
      return informeBeneficio(cliente, periodo, s, filas, rotuloComision, true)
    case 'baseline':
      return informeBaseline(cliente, periodo, s, filas, rotuloComision)
    case 'comparacion_anual':
      return informeAnual(cliente, periodo, s, filas, rotuloComision)
    default:
      return informeSobreVentas(modo, cliente, periodo, s, filas, rotuloComision, comision)
  }
}

/* ---------- % sobre la base neta: Ham Master, Bodegas Valhalla, Lenobotics ---------- */

function informeSobreVentas(
  modo: 'estandar' | 'lineas',
  cliente: string,
  periodo: string,
  s: Resumen,
  filas: Fila[],
  rotuloComision: string,
  comision: number
): InformeCliente {
  const ventas = num(s.totalSales)
  const devoluciones = num(s.totalRefunds)
  const base = num(s.netBase)
  const iva = num(s.totalIva)
  const tasaMedia = num(s.averageCommissionRate)
  const tasas = tasasDeLasLineas(filas)
  const variasTasas = tasas.length > 1

  const pasos: PasoDeCalculo[] = [
    { texto: 'Ventas brutas', valor: dinero(ventas) },
    { texto: 'Devoluciones', valor: menos(devoluciones), tipo: 'resta' },
  ]
  const neto = ventas - devoluciones
  if (cuadra(base, neto)) {
    pasos.push({ texto: 'Base neta (sin IVA)', valor: dinero(base), tipo: 'resultado' })
  } else if (iva > 0 && cuadra(base, neto - iva)) {
    pasos.push({ texto: 'Ventas netas de devoluciones', valor: dinero(neto), tipo: 'resultado' })
    pasos.push({ texto: 'IVA', valor: menos(iva), tipo: 'resta' })
    pasos.push({ texto: 'Base neta (sin IVA)', valor: dinero(base), tipo: 'resultado' })
  } else {
    // No cuadra: se enseña la base tal cual y sin «=»
    pasos.length = 0
    pasos.push({ texto: 'Base neta (sin IVA)', valor: dinero(base), tipo: 'resultado' })
  }
  pasos.push({ texto: variasTasas ? 'Tasa media' : 'Tasa de comisión', valor: porcentaje(tasaMedia) })
  pasos.push({ texto: 'Comisión', valor: dinero(comision), tipo: 'resultado' })

  const detalleTasas = variasTasas
    ? `La comisión se calcula producto a producto: ${tasas.map((t) => `${porcentaje(t.tasa)} en ${entero(t.lineas)} línea${t.lineas === 1 ? '' : 's'}`).join(' y ')}. La tasa media es el resultado de dividir la comisión entre la base neta.`
    : undefined

  const monedas = Object.values(s.byCurrency ?? {}).sort((a, b) => (a.currency ?? '').localeCompare(b.currency ?? ''))
  const tablas: TablaInforme[] = []
  const avisos: string[] = []
  if (modo === 'lineas' && monedas.length > 0) {
    tablas.push({
      titulo: 'Resumen por moneda',
      subtitulo: monedas.length > 1 ? 'Base y comisión de cada moneda' : undefined,
      columnas: [
        { id: 'moneda', titulo: 'Moneda', alinear: 'izq' },
        { id: 'ubrutas', titulo: 'Uds. brutas', alinear: 'der' },
        { id: 'unetas', titulo: 'Uds. netas', alinear: 'der' },
        { id: 'base', titulo: 'Base neta (sin IVA)', alinear: 'der' },
        { id: 'iva', titulo: 'IVA', alinear: 'der' },
        { id: 'cobrado', titulo: 'Total cobrado', alinear: 'der' },
        { id: 'comision', titulo: 'Comisión', alinear: 'der' },
      ],
      filas: monedas.map((m) => [
        m.currency ?? '—',
        entero(m.unitsGross),
        entero(m.unitsNet),
        dinero(num(m.netBase), m.currency),
        dinero(num(m.iva), m.currency),
        dinero(num(m.totalInclusive), m.currency),
        dinero(num(m.commission), m.currency),
      ]),
    })
    if (monedas.length > 1) {
      avisos.push(
        `Este informe incluye ventas en ${monedas.length} monedas (${monedas.map((m) => m.currency).join(', ')}). Los totales de arriba suman los importes tal cual, sin convertirlos; la tabla «Resumen por moneda» los separa.`
      )
    }
  }

  const base2 = modo === 'lineas'
  const columnas: ColumnaInforme[] = base2
    ? [
        { id: 'fecha', titulo: 'Fecha', alinear: 'izq' },
        { id: 'pedido', titulo: 'ID del pedido', alinear: 'izq' },
        { id: 'tipo', titulo: 'Tipo', alinear: 'izq' },
        { id: 'moneda', titulo: 'Moneda', alinear: 'izq' },
        { id: 'producto', titulo: 'Base producto', alinear: 'der' },
        { id: 'envio', titulo: 'Base envío', alinear: 'der' },
        { id: 'promo', titulo: 'Promociones', alinear: 'der' },
        { id: 'iva', titulo: 'IVA', alinear: 'der' },
        { id: 'total', titulo: 'Total base', alinear: 'der' },
        { id: 'comision', titulo: 'Comisión', alinear: 'der' },
      ]
    : [
        { id: 'nombre', titulo: 'Producto', alinear: 'izq' },
        { id: 'asin', titulo: 'ASIN', alinear: 'izq' },
        { id: 'ventas', titulo: 'Ventas brutas', alinear: 'der' },
        { id: 'devol', titulo: 'Devoluciones', alinear: 'der' },
        { id: 'base', titulo: 'Base neta (sin IVA)', alinear: 'der' },
        { id: 'tasa', titulo: 'Tasa', alinear: 'der' },
        { id: 'comision', titulo: 'Comisión', alinear: 'der' },
      ]

  const orden = base2 ? filas : [...filas].sort((a, b) => num(b.commission) - num(a.commission))
  const moneda = (f: Fila) => f.currency || 'EUR'
  const celdas = (f: Fila): string[] =>
    base2
      ? [
          fechaCorta(f.date),
          f.orderId ?? '—',
          f.transactionTypeLabel ?? '—',
          f.currency ?? '—',
          dinero(num(f.baseProductNet), moneda(f)),
          dinero(num(f.baseShippingNet), moneda(f)),
          dinero(num(f.promoNet), moneda(f)),
          dinero(num(f.taxAmount ?? f.iva), moneda(f)),
          dinero(num(f.netLine ?? f.netBase), moneda(f)),
          dinero(num(f.commission), moneda(f)),
        ]
      : [
          nombreCorto(f.productTitle),
          f.asin ?? '—',
          dinero(num(f.grossSales)),
          num(f.refunds) > 0 ? menos(num(f.refunds)) : '—',
          dinero(num(f.netBase)),
          porcentaje(num(f.commissionRate)),
          dinero(num(f.commission)),
        ]

  // Con varias monedas los totales del pie mezclarían divisas: se dejan solo los que son contables sin más
  const mezcla = monedas.length > 1
  const total: string[] | undefined = mezcla
    ? undefined
    : base2
      ? ['Total', '', '', '', dinero(sumar(filas, 'baseProductNet')), dinero(sumar(filas, 'baseShippingNet')), dinero(sumar(filas, 'promoNet')), dinero(filas.reduce((a, f) => a + num(f.taxAmount ?? f.iva), 0)), dinero(filas.reduce((a, f) => a + num(f.netLine ?? f.netBase), 0)), dinero(sumar(filas, 'commission'))]
      : ['Total', '', dinero(sumar(filas, 'grossSales')), menos(sumar(filas, 'refunds')), dinero(sumar(filas, 'netBase')), '', dinero(sumar(filas, 'commission'))]

  return {
    modo,
    cliente,
    periodo,
    principal: {
      rotulo: rotuloComision,
      valor: dinero(comision),
      detalle: `${porcentaje(tasaMedia)}${variasTasas ? ' de tasa media' : ''} sobre la base neta, sin IVA`,
    },
    cifras: [
      { rotulo: 'Ventas brutas', valor: dinero(ventas) },
      { rotulo: 'Devoluciones', valor: menos(devoluciones) },
      { rotulo: 'Base neta (sin IVA)', valor: dinero(base), nota: 'Sobre la que se calcula' },
      { rotulo: modo === 'lineas' ? 'Pedidos' : 'Productos', valor: entero(s.totalOrders ?? filas.length) },
    ],
    calculo: { titulo: 'Cómo se calcula', pasos, nota: detalleTasas },
    tablas,
    detalle: {
      titulo: base2 ? 'Detalle por transacción' : 'Detalle por producto',
      subtitulo: `${entero(filas.length)} ${base2 ? 'líneas' : 'productos'}`,
      columnas,
      filas: orden.map(celdas),
      total,
    },
    lectura: [
      'La comisión es un porcentaje de la base neta: las ventas del periodo menos las devoluciones, sin IVA.',
      ...(base2 ? ['Cada línea del detalle es una venta o una devolución de Amazon; las devoluciones restan.'] : []),
    ],
    avisos,
  }
}

/* ---------- sobre el beneficio: Creative Toys (Sellerboard), DIRU, SAUSI ---------- */

function informeBeneficio(cliente: string, periodo: string, s: Resumen, lineas: Fila[], rotuloComision: string, simple: boolean): InformeCliente {
  const filas = agruparPorProducto(lineas)
  const unidades = sumar(filas, 'quantity')
  const ventas = num(s.totalSales)
  const devoluciones = num(s.totalRefunds)
  const beneficio = num(s.totalBenefits ?? s.netBase)
  const tasa = num(s.commissionRateUsed ?? s.averageCommissionRate)
  const comision = num(s.totalCommission)
  const costes = num(s.totalCostOfGoods) + num(s.totalAmazonFees) + num(s.totalAds)

  const cifras = simple
    ? [
        { rotulo: 'Ventas brutas', valor: dinero(ventas) },
        { rotulo: 'Devoluciones', valor: menos(devoluciones) },
        { rotulo: 'Productos', valor: entero(filas.length) },
        { rotulo: 'Beneficio', valor: dinero(beneficio), nota: 'Sobre el que se calcula' },
      ]
    : [
        { rotulo: 'Ventas', valor: dinero(ventas), nota: unidades > 0 ? `${entero(unidades)} unidades` : `${entero(filas.length)} productos` },
        { rotulo: 'Devoluciones', valor: menos(devoluciones) },
        {
          rotulo: 'Costes',
          valor: menos(costes),
          nota: `Producto ${dinero(num(s.totalCostOfGoods))} · Amazon ${dinero(num(s.totalAmazonFees))} · Publicidad ${dinero(num(s.totalAds))}`,
        },
        {
          rotulo: 'Beneficio neto',
          valor: dinero(beneficio),
          nota: ventas > 0 ? `Margen del ${porcentaje(beneficio / ventas)} sobre ventas` : 'Sobre el que se calcula',
        },
      ]

  const columnas: ColumnaInforme[] = simple
    ? [
        { id: 'nombre', titulo: 'Producto', alinear: 'izq' },
        { id: 'asin', titulo: 'ASIN', alinear: 'izq' },
        { id: 'ventas', titulo: 'Ventas brutas', alinear: 'der' },
        { id: 'devol', titulo: 'Devoluciones', alinear: 'der' },
        { id: 'beneficio', titulo: 'Beneficio', alinear: 'der' },
        { id: 'tasa', titulo: 'Tasa', alinear: 'der' },
        { id: 'comision', titulo: 'Comisión', alinear: 'der' },
      ]
    : [
        { id: 'nombre', titulo: 'Producto', alinear: 'izq' },
        { id: 'asin', titulo: 'ASIN', alinear: 'izq' },
        { id: 'uds', titulo: 'Uds.', alinear: 'der' },
        { id: 'ventas', titulo: 'Ventas', alinear: 'der' },
        { id: 'coste', titulo: 'Coste producto', alinear: 'der' },
        { id: 'amazon', titulo: 'Tarifas Amazon', alinear: 'der' },
        { id: 'publi', titulo: 'Publicidad', alinear: 'der' },
        { id: 'beneficio', titulo: 'Beneficio', alinear: 'der' },
        { id: 'margen', titulo: 'Margen', alinear: 'der' },
        { id: 'comision', titulo: 'Comisión', alinear: 'der' },
      ]
  const resta = (v: unknown) => (num(v) > 0 ? menos(num(v)) : '—')
  const orden = [...filas].sort((a, b) => num(b.commission) - num(a.commission))
  const celdas = (f: Fila): string[] =>
    simple
      ? [nombreCorto(f.productTitle), f.asin ?? '—', dinero(num(f.grossSales)), resta(f.refunds), dinero(num(f.netBase)), porcentaje(num(f.commissionRate)), dinero(num(f.commission))]
      : [
          nombreCorto(f.productTitle),
          f.asin ?? '—',
          f.quantity != null ? entero(f.quantity) : '—',
          dinero(num(f.grossSales)),
          resta(f.costOfGoods),
          resta(f.amazonFees),
          resta(f.adsSpend),
          dinero(num(f.netProfit ?? f.netBase)),
          hay(f.margin) ? porcentaje(f.margin) : '—',
          dinero(num(f.commission)),
        ]
  const total = simple
    ? ['Total', '', dinero(sumar(filas, 'grossSales')), menos(sumar(filas, 'refunds')), dinero(sumar(filas, 'netBase')), '', dinero(sumar(filas, 'commission'))]
    : ['Total', '', entero(sumar(filas, 'quantity')), dinero(sumar(filas, 'grossSales')), menos(sumar(filas, 'costOfGoods')), menos(sumar(filas, 'amazonFees')), menos(sumar(filas, 'adsSpend')), dinero(filas.reduce((a, f) => a + num(f.netProfit ?? f.netBase), 0)), '', dinero(sumar(filas, 'commission'))]

  return {
    modo: simple ? 'beneficio_simple' : 'beneficio',
    cliente,
    periodo,
    principal: { rotulo: rotuloComision, valor: dinero(comision), detalle: `${porcentaje(tasa)} del beneficio` },
    cifras,
    calculo: {
      titulo: 'Cómo se calcula',
      pasos: [
        { texto: simple ? 'Beneficio' : 'Beneficio neto', valor: dinero(beneficio) },
        { texto: 'Tasa de comisión', valor: porcentaje(tasa) },
        { texto: 'Comisión', valor: dinero(comision), tipo: 'resultado' },
      ],
    },
    tablas: [],
    detalle: {
      titulo: 'Detalle por producto',
      subtitulo: `${entero(filas.length)} productos`,
      columnas,
      filas: orden.map(celdas),
      total,
      buscador: 'Buscar por producto o ASIN…',
    },
    lectura: [
      'En este cliente la comisión no es un porcentaje de las ventas: se calcula sobre el beneficio.',
        ...(simple ? [] : ['El beneficio neto es el del informe de beneficios del periodo. Descuenta más conceptos que los tres que se detallan arriba, así que no sale de restar solo esos costes a las ventas.']),
    ],
    avisos: [],
  }
}

/* ---------- Shoplamp: excedente sobre una base mensual pactada ---------- */

function informeBaseline(cliente: string, periodo: string, s: Resumen, filas: Fila[], rotuloComision: string): InformeCliente {
  const base = num(s.netBase)
  const baseline = num(s.baselineAmount)
  const exceso = num(s.excessAmount)
  const hayEnvio = s.shippingDeducted !== undefined
  const envio = num(s.shippingDeducted)
  const comision = num(s.totalCommission)
  // La tasa sale de los propios números, no de un 5 % escrito a mano
  const tasa = exceso > 0 && !cuadra(exceso * num(s.averageCommissionRate), comision) ? comision / exceso : num(s.averageCommissionRate)

  const monedas = Object.values(s.byCurrency ?? {}).sort((a, b) => (a.currency ?? '').localeCompare(b.currency ?? ''))
  const hayMonedas = monedas.length > 0
  const lineas = informeSobreVentas('lineas', cliente, periodo, s, filas, rotuloComision, comision)

  // Aquí la comisión NO se reparte por línea: se calcula una vez sobre el excedente. Se quita la columna para que no se sumen 5 % de cada línea.
  const iComision = lineas.detalle ? lineas.detalle.columnas.findIndex((c) => c.id === 'comision') : -1
  const detalle = lineas.detalle && iComision >= 0
    ? {
        ...lineas.detalle,
        columnas: lineas.detalle.columnas.filter((_, i) => i !== iComision),
        filas: lineas.detalle.filas.map((f) => f.filter((_, i) => i !== iComision)),
        total: lineas.detalle.total?.filter((_, i) => i !== iComision),
      }
    : lineas.detalle
  const tablas = lineas.tablas.map((t) => ({
    ...t,
    columnas: t.columnas.filter((c) => c.id !== 'comision'),
    filas: t.filas.map((f) => f.slice(0, t.columnas.findIndex((c) => c.id === 'comision'))),
  }))

  return {
    modo: 'baseline',
    cliente,
    periodo,
    principal: { rotulo: rotuloComision, valor: dinero(comision), detalle: `${porcentaje(tasa)} sobre el excedente de la base acordada` },
    cifras: [
      { rotulo: 'Base neta del mes (sin IVA)', valor: dinero(base) },
      ...(hayEnvio ? [{ rotulo: 'Envío del mes', valor: menos(envio), nota: 'Coste de envío según Sellerboard' }] : []),
      { rotulo: 'Base mensual acordada', valor: dinero(baseline), nota: 'Promedio mensual pactado' },
      { rotulo: 'Excedente', valor: dinero(exceso), nota: hayEnvio ? 'Base neta, menos el envío y la base acordada' : 'Base neta menos la base acordada' },
      { rotulo: 'Pedidos', valor: entero(s.totalOrders ?? filas.length) },
    ],
    calculo: {
      titulo: 'Cómo se calcula',
      pasos: [
        { texto: 'Base neta del mes (sin IVA)', valor: dinero(base) },
        ...(hayEnvio ? [{ texto: 'Envío del mes (Sellerboard)', valor: menos(envio), tipo: 'resta' as const }] : []),
        { texto: 'Base mensual acordada', valor: menos(baseline), tipo: 'resta' },
        { texto: 'Excedente', valor: dinero(exceso), tipo: 'resultado' },
        { texto: 'Tasa de comisión', valor: porcentaje(tasa) },
        { texto: 'Comisión', valor: dinero(comision), tipo: 'resultado' },
      ],
      nota: exceso <= 0 ? `Este mes la base neta${hayEnvio ? ', descontado el envío,' : ''} no supera la base acordada, así que no hay comisión.` : undefined,
    },
    tablas: hayMonedas ? tablas : [],
    detalle,
    lectura: [
      hayEnvio
        ? 'Del mes se descuenta primero lo que ha costado el envío y solo se cobra comisión por lo que el resto supera la base mensual acordada; hasta esa base no hay comisión.'
        : 'Solo se cobra comisión por lo que el mes supera la base mensual acordada; hasta esa base no hay comisión.',
      'Cada línea del detalle es una venta o una devolución de Amazon; la comisión se calcula una vez sobre el excedente, no línea a línea.',
    ],
    avisos: lineas.avisos,
  }
}

/* ---------- ShoesF y Farmacia Garrachón: excedente sobre el año anterior ---------- */

function informeAnual(cliente: string, periodo: string, s: Resumen, filas: Fila[], rotuloComision: string): InformeCliente {
  const anterior = num(s.previousYearNetBase)
  const actual = num(s.currentYearNetBase)
  const exceso = num(s.excessAmount)
  const tasa = num(s.commissionRateUsed ?? s.averageCommissionRate)
  const comision = num(s.totalCommission)

  const tablas: TablaInforme[] = []
  const ant = s.calculationBreakdown?.previousYear
  const act = s.calculationBreakdown?.currentYear
  if (ant && act) {
    const fila = (texto: string, a: number, b: number, resta = false): string[] => [texto, resta ? menos(a) : dinero(a), resta ? menos(b) : dinero(b)]
    tablas.push({
      titulo: 'De dónde sale cada base',
      columnas: [
        { id: 'concepto', titulo: 'Concepto', alinear: 'izq' },
        { id: 'anterior', titulo: 'Año anterior', alinear: 'der' },
        { id: 'actual', titulo: 'Año actual', alinear: 'der' },
      ],
      filas: [
        fila('Ventas de producto', num(ant.grossProduct), num(act.grossProduct)),
        fila('Ventas de envío', num(ant.grossShipping), num(act.grossShipping)),
        fila('Devoluciones de producto', num(ant.refundsProduct), num(act.refundsProduct), true),
        fila('Devoluciones de envío', num(ant.refundsShipping), num(act.refundsShipping), true),
      ],
      total: ['Base neta (sin IVA)', dinero(num(ant.netBase)), dinero(num(act.netBase))],
    })
  }
  const paises = Object.values(s.byJurisdiction ?? {}).sort((a, b) => num(b.excessAmount) - num(a.excessAmount))
  if (paises.length > 0) {
    tablas.push({
      titulo: 'Por país',
      columnas: [
        { id: 'pais', titulo: 'País', alinear: 'izq' },
        { id: 'anterior', titulo: 'Base año anterior', alinear: 'der' },
        { id: 'actual', titulo: 'Base año actual', alinear: 'der' },
        { id: 'exceso', titulo: 'Diferencia', alinear: 'der' },
      ],
      filas: paises.map((p) => [nombreDePais(p.jurisdiction), dinero(num(p.previousYearNetBase)), dinero(num(p.currentYearNetBase)), dinero(num(p.excessAmount))]),
    })
  }

  /**
   * UNA FILA POR REFERENCIA, NO POR PEDIDO.
   *
   * Las filas guardadas son pedidos sueltos: `currentYearNetBase` es el de ESE pedido, pero `previousYearNetBase` es el de la
   * referencia entera del año anterior, repetido en cada pedido. Sumar la columna daba 291.384 € en un cliente cuya base del
   * año anterior es 15.319 €. Aquí se junta por referencia: el año anterior una vez y el actual sumando sus pedidos. Y lo que
   * solo vendió el año pasado (no sale en ningún pedido de este año) va en una última línea para que la columna cuadre con la
   * base de arriba.
   */
  const porSku = new Map<string, { anterior: number; actual: number }>()
  for (const f of filas) {
    const k = f.asin ?? '—'
    const x = porSku.get(k) ?? { anterior: num(f.previousYearNetBase), actual: 0 }
    x.actual += num(f.currentYearNetBase)
    porSku.set(k, x)
  }
  const referencias = [...porSku.entries()].sort((a, b) => b[1].actual - a[1].actual)
  const anteriorVisto = referencias.reduce((t, [, v]) => t + v.anterior, 0)
  const soloAnterior = anterior - anteriorVisto
  const filasAnual = referencias.map(([sku, v]) => [sku, dinero(v.anterior), dinero(v.actual), dinero(v.actual - v.anterior)])
  if (soloAnterior > 0.05) filasAnual.push(['Referencias que solo vendieron el año anterior', dinero(soloAnterior), dinero(0), dinero(-soloAnterior)])
  const mejora = actual - anterior
  return {
    modo: 'comparacion_anual',
    cliente,
    periodo,
    principal: { rotulo: rotuloComision, valor: dinero(comision), detalle: `${porcentaje(tasa)} sobre lo que supera al año anterior` },
    cifras: [
      { rotulo: 'Base neta año anterior', valor: dinero(anterior), nota: 'Sin IVA' },
      { rotulo: 'Base neta año actual', valor: dinero(actual), nota: 'Sin IVA' },
      { rotulo: 'Excedente', valor: dinero(exceso), nota: 'Año actual menos año anterior' },
      { rotulo: 'Pedidos', valor: entero(s.totalOrders ?? filas.length) },
    ],
    calculo: {
      titulo: 'Cómo se calcula',
      pasos: [
        { texto: 'Base neta año actual', valor: dinero(actual) },
        { texto: 'Base neta año anterior', valor: menos(anterior), tipo: 'resta' },
        { texto: 'Excedente', valor: dinero(Math.max(0, exceso)), tipo: 'resultado' },
        { texto: 'Tasa de comisión', valor: porcentaje(tasa) },
        { texto: 'Comisión', valor: dinero(comision), tipo: 'resultado' },
      ],
      nota: mejora <= 0 ? 'La base de este año no supera a la del año anterior, así que no hay excedente ni comisión.' : undefined,
    },
    tablas,
    detalle: {
      titulo: 'Detalle por referencia',
      subtitulo: `${entero(referencias.length)} referencias con ventas este año`,
      columnas: [
        { id: 'sku', titulo: 'SKU', alinear: 'izq' },
        { id: 'anterior', titulo: 'Base año anterior', alinear: 'der' },
        { id: 'actual', titulo: 'Base año actual', alinear: 'der' },
        { id: 'dif', titulo: 'Diferencia', alinear: 'der' },
      ],
      filas: filasAnual,
      total: ['Total', dinero(anterior), dinero(actual), dinero(actual - anterior)],
    },
    lectura: [
      'Solo se cobra comisión por lo que este año supera al año anterior en el mismo periodo; si no lo supera, no hay comisión.',
      'La base neta es la facturación real (ventas menos devoluciones) sin IVA, producto y envío incluidos.',
    ],
    avisos: [],
  }
}

/* ---------- Keslem: la comisión partida por marcas ---------- */

function informePorMarca(cliente: string, periodo: string, d: DatosPorMarca): InformeCliente {
  const bloques = d.bloques
  const avisos: string[] = []
  const sin = d.sinUbicar
  if (sin && sin.total > 0) {
    avisos.push(
      `${entero(sin.total)} referencia${sin.total === 1 ? '' : 's'} no se ha podido asignar a ninguna marca y no cuenta${sin.total === 1 ? '' : 'n'} en el cálculo. Suman ${dinero(sin.anterior)} el año anterior y ${dinero(sin.actual)} el año actual.`
    )
  }
  return {
    modo: 'por_marca',
    cliente,
    periodo,
    principal: {
      rotulo: periodo ? `Comisión de ${periodo}` : 'Comisión',
      valor: dinero(num(d.totalComision)),
      detalle: 'Suma de las comisiones de cada bloque',
    },
    cifras: [
      { rotulo: 'Base año anterior', valor: dinero(bloques.reduce((a, b) => a + num(b.anterior), 0)) },
      { rotulo: 'Base año actual', valor: dinero(bloques.reduce((a, b) => a + num(b.actual), 0)) },
      { rotulo: 'Bloques', valor: entero(bloques.length) },
      { rotulo: 'Referencias en catálogo', valor: entero(d.catalogoReferencias) },
    ],
    calculo: {
      titulo: 'Cómo se calcula',
      pasos: bloques.flatMap((b): PasoDeCalculo[] => [
        { texto: `${b.etiqueta} · excedente`, valor: dinero(Math.max(0, num(b.excedente))) },
        { texto: `${b.etiqueta} · comisión al ${porcentaje(num(b.tasa))}`, valor: dinero(num(b.comision)), tipo: 'resultado' },
      ]),
      nota: bloques.some((b) => num(b.excedente) < 0) ? 'Un bloque cuyo año actual no supera al anterior no genera comisión, y tampoco resta a los demás.' : undefined,
    },
    tablas: [
      {
        titulo: 'Por bloque',
        columnas: [
          { id: 'bloque', titulo: 'Bloque', alinear: 'izq' },
          { id: 'anterior', titulo: 'Año anterior', alinear: 'der' },
          { id: 'actual', titulo: 'Año actual', alinear: 'der' },
          { id: 'exceso', titulo: 'Diferencia', alinear: 'der' },
          { id: 'tasa', titulo: 'Tasa', alinear: 'der' },
          { id: 'comision', titulo: 'Comisión', alinear: 'der' },
        ],
        filas: bloques.map((b) => [b.etiqueta, dinero(num(b.anterior)), dinero(num(b.actual)), dinero(num(b.excedente)), porcentaje(num(b.tasa)), dinero(num(b.comision))]),
        total: ['Total', '', '', '', '', dinero(num(d.totalComision))],
      },
    ],
    detalle: null,
    lectura: ['Este cliente paga una comisión distinta según el tipo de producto: cada bloque se compara con el año anterior y solo cuenta lo que lo supera.'],
    avisos,
  }
}
