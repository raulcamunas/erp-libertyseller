/**
 * VENTAS · LOS AJUSTES DE CADA CUENTA (la página «Configuración», como los «Ajustes» de cada cuenta en Sellerboard). PURO: vale en el navegador.
 * Se guardan en `ventas_cuentas.ajustes` (JSONB, migración 353). Lo que falta toma el valor de siempre, así una cuenta sin ajustes calcula
 * exactamente igual que antes.
 */

export interface AjustesCuenta {
  /** IVA sobre las ventas: si se descuenta y desde qué día (antes de esa fecha, sin IVA) */
  ivaVentas: boolean
  ivaVentasDesde: string | null
  /** Las tarifas de Amazon llevan IVA que se recupera (se cuentan sin él) y desde qué día */
  tarifasConIva: boolean
  tarifasIvaDesde: string | null
  /** Sumar el IVA local (el de la cuenta) al gasto en publicidad */
  ivaPublicidad: boolean
  /** FBM Pick & Pack: lo que cuesta preparar cada pedido FBM (por paquete y por artículo; los X primeros artículos pueden ir a otro precio) */
  pickPaquete: number
  pickArticulo: number
  pickPrimeros: number | null
  pickPrecioPrimeros: number | null
  /** El margen sobre las ventas netas (sin IVA) en vez de sobre las ventas */
  margenSobreNeto: boolean
  /** Flujo de caja: los pagos de Amazon cuentan desde este día */
  flujoDesde: string | null
}

export const AJUSTES_POR_DEFECTO: AjustesCuenta = {
  ivaVentas: true,
  ivaVentasDesde: null,
  tarifasConIva: true,
  tarifasIvaDesde: null,
  ivaPublicidad: false,
  pickPaquete: 0,
  pickArticulo: 0,
  pickPrimeros: null,
  pickPrecioPrimeros: null,
  margenSobreNeto: false,
  flujoDesde: null,
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/
const fecha = (x: unknown) => (typeof x === 'string' && FECHA.test(x) ? x : null)
const dinero = (x: unknown, def: number) => {
  const n = Number(x)
  return Number.isFinite(n) && n >= 0 && n <= 10_000 ? Math.round(n * 100) / 100 : def
}

/** Lo guardado (o lo que llega del navegador), limpio y con los valores de siempre en lo que falte */
export function normalizarAjustes(x: unknown): AjustesCuenta {
  const o = x && typeof x === 'object' ? (x as Record<string, unknown>) : {}
  const d = AJUSTES_POR_DEFECTO
  const bool = (k: keyof AjustesCuenta) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : (d[k] as boolean))
  const primeros = Number(o.pickPrimeros)
  return {
    ivaVentas: bool('ivaVentas'),
    ivaVentasDesde: fecha(o.ivaVentasDesde),
    tarifasConIva: bool('tarifasConIva'),
    tarifasIvaDesde: fecha(o.tarifasIvaDesde),
    ivaPublicidad: bool('ivaPublicidad'),
    pickPaquete: dinero(o.pickPaquete, 0),
    pickArticulo: dinero(o.pickArticulo, 0),
    pickPrimeros: Number.isInteger(primeros) && primeros > 0 && primeros <= 1000 ? primeros : null,
    pickPrecioPrimeros: o.pickPrecioPrimeros == null || o.pickPrecioPrimeros === '' ? null : dinero(o.pickPrecioPrimeros, 0),
    margenSobreNeto: bool('margenSobreNeto'),
    flujoDesde: fecha(o.flujoDesde),
  }
}

/** Lo que cuesta preparar los pedidos FBM de una fila (pedidos y unidades FBM de un día y SKU): por paquete + por artículo */
export function costePickPack(a: Pick<AjustesCuenta, 'pickPaquete' | 'pickArticulo' | 'pickPrimeros' | 'pickPrecioPrimeros'>, pedidos: number, unidades: number): number {
  if (pedidos <= 0) return 0
  const porPedido = unidades / pedidos
  let articulos: number
  if (a.pickPrimeros && a.pickPrecioPrimeros != null) {
    const primeros = Math.min(porPedido, a.pickPrimeros)
    articulos = primeros * a.pickPrecioPrimeros + Math.max(0, porPedido - primeros) * a.pickArticulo
  } else articulos = porPedido * a.pickArticulo
  return Math.round(pedidos * (a.pickPaquete + articulos) * 100) / 100
}
