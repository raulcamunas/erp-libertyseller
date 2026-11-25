/**
 * CUMPLIMIENTO · LA SALUD DE LA CUENTA, A PARTIR DEL INFORME DE AMAZON. PURO (se prueba en salud.prueba.ts).
 *
 * Fuente: GET_V2_SELLER_PERFORMANCE_REPORT (JSON, esquema accountHealthReport-2020-11-18; rol «Selling Partner Insights»). De cada métrica trae el valor (`rate`), el
 * objetivo (`targetValue` + `targetCondition`), si va bien o mal (`status` GOOD/BAD) y su ventana (`reportingDateRange`). De las políticas, SOLO recuentos por categoría:
 * la lista ASIN a ASIN de «Cumplimiento de políticas» no está en ninguna API (lo que afecta a un listing sale como incidencia del listing, en «No se venden»).
 * La puntuación del nivel de salud (el «286» de Seller Central) no está en el esquema: si algún día viene en el informe, se coge (`puntuacion`); si no, solo el estado.
 */

export type EstadoMetrica = 'bien' | 'mal' | 'sin-datos'

export interface MetricaDeSalud {
  id: 'odr-fbm' | 'odr-fba' | 'envios-retrasados' | 'cancelaciones' | 'seguimiento' | 'entregas-a-tiempo' | 'facturas'
  nombre: string
  /** Fracción (0,0236 = 2,36 %). null = sin pedidos en la ventana */
  valor: number | null
  objetivo: number | null
  /** 'menos' = el valor tiene que quedar por debajo del objetivo; 'mas', por encima */
  sentido: 'menos' | 'mas' | null
  estado: EstadoMetrica
  /** «32 de 1.356 pedidos» */
  detalle: string | null
  desde: string | null
  hasta: string | null
  /** El desglose (pedidos defectuosos: valoraciones negativas, reclamaciones A-to-z, devoluciones de cargo) */
  partes?: Array<{ nombre: string; cantidad: number; estado: EstadoMetrica }>
}

export interface PoliticaDeSalud {
  id: string
  nombre: string
  defectos: number
  estado: EstadoMetrica
}

export interface SaludDeCuenta {
  /** NORMAL, AT_RISK, DEACTIVATED (tal cual) o null */
  estadoCuenta: string | null
  /** GREAT / WARNED (o lo que mande Amazon) */
  nivel: string | null
  puntuacion: number | null
  metricas: MetricaDeSalud[]
  politicas: PoliticaDeSalud[]
  /** Cuántas cosas van mal (métricas en rojo + políticas con defectos) */
  alertas: number
}

const POLITICAS: Record<string, string> = {
  productSafetyCustomerComplaints: 'Quejas de seguridad del producto',
  foodAndProductSafetyIssues: 'Seguridad de productos y alimentos',
  listingPolicyViolations: 'Política de publicación (uso indebido de atributos…)',
  restrictedProductPolicyViolations: 'Productos restringidos',
  documentRequests: 'Documentación pedida (cumplimiento normativo)',
  suspectedIntellectualPropertyViolations: 'Supuestas infracciones de propiedad intelectual',
  receivedIntellectualPropertyComplaints: 'Reclamaciones de propiedad intelectual',
  productAuthenticityCustomerComplaints: 'Reclamaciones por autenticidad',
  productConditionCustomerComplaints: 'Reclamaciones por estado del producto',
  customerProductReviewsPolicyViolations: 'Política de reseñas',
  otherPolicyViolations: 'Otros incumplimientos',
}

type J = Record<string, unknown>
const obj = (x: unknown): J | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as J) : null)
const num = (x: unknown): number | null => {
  const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x) : NaN
  return Number.isFinite(n) ? n : null
}
const txt = (x: unknown): string | null => (typeof x === 'string' && x.trim() ? x.trim() : null)
const estadoDe = (s: unknown): EstadoMetrica => (s === 'GOOD' ? 'bien' : s === 'BAD' ? 'mal' : 'sin-datos')
const sentidoDe = (s: unknown): MetricaDeSalud['sentido'] => (s === 'LESS_THAN' ? 'menos' : s === 'GREATER_THAN' ? 'mas' : null)
const fechas = (m: J) => {
  const r = obj(m.reportingDateRange)
  return { desde: txt(r?.reportingDateFrom)?.slice(0, 10) ?? null, hasta: txt(r?.reportingDateTo)?.slice(0, 10) ?? null }
}
const ent = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')

/** La puntuación del nivel de salud, si Amazon la mandara con algún nombre (no está en el esquema) */
function buscarPuntuacion(x: unknown, profundidad = 0): number | null {
  const o = obj(x)
  if (!o || profundidad > 3) return null
  for (const [k, v] of Object.entries(o)) {
    if (/score|rating(value|score)?$|ahr$/i.test(k) && !/status/i.test(k)) {
      const n = num(v)
      if (n != null && n >= 0 && n <= 1000) return n
    }
    const dentro = buscarPuntuacion(v, profundidad + 1)
    if (dentro != null) return dentro
  }
  return null
}

function metrica(id: MetricaDeSalud['id'], nombre: string, m: J | null, detalle: (m: J) => string | null): MetricaDeSalud | null {
  if (!m) return null
  const { desde, hasta } = fechas(m)
  return { id, nombre, valor: num(m.rate), objetivo: num(m.targetValue), sentido: sentidoDe(m.targetCondition), estado: estadoDe(m.status), detalle: detalle(m), desde, hasta }
}

/** Lo que importa del informe, para un país (el informe puede traer varios: se coge el pedido o, si no está, el primero) */
export function saludDeInforme(json: unknown, marketplaceId: string): SaludDeCuenta {
  const raiz = obj(json) ?? {}
  const estados = (Array.isArray(raiz.accountStatuses) ? raiz.accountStatuses : []).map(obj).filter((x): x is J => !!x)
  const metricasRaiz = (Array.isArray(raiz.performanceMetrics) ? raiz.performanceMetrics : []).map(obj).filter((x): x is J => !!x)
  const p = metricasRaiz.find((m) => m.marketplaceId === marketplaceId) ?? metricasRaiz[0] ?? {}
  const estadoCuenta = txt((estados.find((e) => e.marketplaceId === marketplaceId) ?? estados[0])?.status)

  const metricas: MetricaDeSalud[] = []
  const odr = obj(p.orderDefectRate)
  for (const [canal, id, nombre] of [
    ['mfn', 'odr-fbm', 'Pedidos defectuosos (envíos propios)'],
    ['afn', 'odr-fba', 'Pedidos defectuosos (FBA)'],
  ] as const) {
    const m = obj(odr?.[canal])
    const x = metrica(id, nombre, m, (m) => {
      const total = num(m.orderCount)
      const malos = num(obj(m.orderWithDefects)?.count)
      return total != null ? `${ent(malos ?? 0)} de ${ent(total)} pedidos` : null
    })
    if (!x || !m) continue
    x.partes = (
      [
        ['negativeFeedback', 'Valoraciones negativas'],
        ['claims', 'Reclamaciones de la Garantía de la A a la Z'],
        ['chargebacks', 'Devoluciones de cargo'],
      ] as const
    ).flatMap(([k, n]) => {
      const c = obj(m[k])
      return c ? [{ nombre: n, cantidad: num(c.count) ?? 0, estado: estadoDe(c.status) }] : []
    })
    metricas.push(x)
  }
  const add = (x: MetricaDeSalud | null) => x && metricas.push(x)
  add(metrica('envios-retrasados', 'Envíos atrasados', obj(p.lateShipmentRate), (m) => (num(m.orderCount) != null ? `${ent(num(m.lateShipmentCount) ?? 0)} de ${ent(num(m.orderCount) ?? 0)} pedidos` : null)))
  add(metrica('cancelaciones', 'Cancelaciones antes del envío', obj(p.preFulfillmentCancellationRate), (m) => (num(m.orderCount) != null ? `${ent(num(m.cancellationCount) ?? 0)} de ${ent(num(m.orderCount) ?? 0)} pedidos` : null)))
  add(metrica('seguimiento', 'Envíos con seguimiento válido', obj(p.validTrackingRate), (m) => (num(m.shipmentCount) != null ? `${ent(num(m.validTrackingCount) ?? 0)} de ${ent(num(m.shipmentCount) ?? 0)} envíos` : null)))
  add(metrica('entregas-a-tiempo', 'Entregas a tiempo', obj(p.onTimeDeliveryRate), (m) => (num(m.shipmentCountWithValidTracking) != null ? `${ent(num(m.onTimeDeliveryCount) ?? 0)} de ${ent(num(m.shipmentCountWithValidTracking) ?? 0)} envíos` : null)))
  add(metrica('facturas', 'Defectos de facturación', obj(p.invoiceDefectRate), (m) => (num(m.orderCount) != null ? `${ent(num(obj(m.invoiceDefect)?.count) ?? 0)} de ${ent(num(m.orderCount) ?? 0)} pedidos` : null)))

  const politicas: PoliticaDeSalud[] = Object.entries(POLITICAS).flatMap(([k, nombre]) => {
    const m = obj(p[k])
    if (!m) return []
    return [{ id: k, nombre, defectos: num(m.defectsCount) ?? 0, estado: estadoDe(m.status) }]
  })
  politicas.sort((a, b) => b.defectos - a.defectos)

  const ahr = obj(p.accountHealthRating)
  const nivel = txt(ahr?.accountHealthRatingStatus) ?? txt(ahr?.ahrStatus)
  const puntuacion = buscarPuntuacion(ahr) ?? buscarPuntuacion(p)
  const alertas = metricas.filter((m) => m.estado === 'mal').length + politicas.filter((x) => x.defectos > 0).length
  return { estadoCuenta, nivel, puntuacion, metricas, politicas, alertas }
}

export const TEXTO_ESTADO_CUENTA: Record<string, { texto: string; tono: 'verde' | 'ambar' | 'rojo' }> = {
  NORMAL: { texto: 'Cuenta en buen estado', tono: 'verde' },
  AT_RISK: { texto: 'Cuenta en riesgo', tono: 'ambar' },
  DEACTIVATED: { texto: 'Cuenta desactivada', tono: 'rojo' },
}
