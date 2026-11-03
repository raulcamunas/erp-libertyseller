/**
 * PCCOMPONENTES (MIRAKL) · LOS DATOS, SIN RED NI CLAVES — PURO.
 * ============================================================
 * Se comprueba con datos.prueba.ts. Aquí viven dos cosas y nada más:
 *
 *   · Pasar lo que contesta la API de Mirakl a las formas pequeñas que usa el ERP. La respuesta de la cuenta (A01) trae DATOS BANCARIOS y de contacto
 *     del vendedor, y la pantalla no los necesita: `cuentaDeRespuesta` se queda SOLO con lo que se enseña, así que el IBAN no puede llegar a ningún sitio
 *     aunque alguien enseñe «el objeto entero» por descuido.
 *   · Armar lo que se manda (OF24: crear o actualizar ofertas) y comprobarlo ANTES de mandarlo, porque Mirakl procesa las importaciones aparte y un
 *     campo mal puesto no da error al enviar: da una línea rechazada en un informe que se lee minutos después.
 *
 * Quien llama a la red y lee la clave está en mirakl.ts.
 */

/* ------------------------------------------------------------------ */
/* La cuenta                                                           */
/* ------------------------------------------------------------------ */

export interface EnvioDeTienda {
  tipo: string
  zona: string
  /** Desde qué importe el envío es gratis. null = nunca */
  gratisDesde: number | null
}

export interface CuentaPcc {
  tiendaId: number | null
  nombre: string
  /** OPEN, SUSPENDED… tal cual */
  estado: string
  canales: string[]
  moneda: string
  ofertas: number
  pedidos: number
  valoracion: number | null
  /** 0–1: la parte de lo enviado que PcComponentes ha aprobado */
  tasaAprobacion: number | null
  creada: string | null
  envios: EnvioDeTienda[]
  cerradaDesde: string | null
}

type Json = Record<string, unknown>
const obj = (v: unknown): Json => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : {})
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)
const numero = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : Number.NaN
  return Number.isFinite(n) ? n : null
}

/** La cuenta (A01), solo con lo que se enseña: nunca banco, contacto ni textos legales */
export function cuentaDeRespuesta(crudo: unknown): CuentaPcc {
  const a = obj(crudo)
  return {
    tiendaId: numero(a.shop_id),
    nombre: texto(a.shop_name) ?? 'Sin nombre',
    estado: texto(a.shop_state) ?? 'DESCONOCIDO',
    canales: lista(a.channels).filter((c): c is string => typeof c === 'string'),
    moneda: texto(a.currency_iso_code) ?? 'EUR',
    ofertas: numero(a.offers_count) ?? 0,
    pedidos: numero(a.orders_count) ?? 0,
    valoracion: numero(a.grade),
    tasaAprobacion: numero(a.approval_rate),
    creada: texto(a.date_created),
    cerradaDesde: texto(a.closed_from),
    envios: lista(a.shippings).map((s) => {
      const e = obj(s)
      return { tipo: texto(e.shipping_type_label) ?? texto(e.shipping_type_code) ?? '—', zona: texto(e.shipping_zone_label) ?? texto(e.shipping_zone_code) ?? '—', gratisDesde: numero(e.shipping_free_amount) }
    }),
  }
}

/* ------------------------------------------------------------------ */
/* Las ofertas                                                         */
/* ------------------------------------------------------------------ */

export interface OfertaPcc {
  /** El identificador de la oferta dentro de Mirakl */
  ofertaId: number | null
  /** NUESTRO código: el del proveedor, el mismo que en Amazon */
  sku: string
  /** El código del producto en el catálogo de PcComponentes */
  productoId: string | null
  titulo: string
  marca: string | null
  categoria: string | null
  ean: string | null
  mpn: string | null
  precio: number | null
  /** Precio sin rebaja, si hay rebaja */
  precioOrigen: number | null
  cantidad: number
  /** 1 = nuevo en PcComponentes */
  estadoProducto: string | null
  activa: boolean
  motivosInactiva: string[]
  canales: string[]
  plazoEnvioDias: number | null
  claseLogistica: string | null
  /** «tipo-iva», «canon»…: los campos propios de PcComponentes por oferta */
  adicionales: Record<string, string>
}

export function ofertaDeRespuesta(crudo: unknown): OfertaPcc {
  const o = obj(crudo)
  const refs = lista(o.product_references).map(obj)
  const ref = (tipo: string) => texto(refs.find((r) => r.reference_type === tipo)?.reference)
  const precio = obj(o.applicable_pricing)
  const adicionales: Record<string, string> = {}
  for (const f of lista(o.offer_additional_fields).map(obj)) {
    const codigo = texto(f.code)
    if (codigo && f.value !== undefined && f.value !== null) adicionales[codigo] = String(f.value)
  }
  return {
    ofertaId: numero(o.offer_id),
    sku: texto(o.shop_sku) ?? '',
    productoId: o.product_sku === undefined || o.product_sku === null ? null : String(o.product_sku),
    titulo: texto(o.product_title) ?? '',
    marca: texto(o.product_brand),
    categoria: texto(o.category_label),
    ean: ref('EAN'),
    mpn: ref('MPN'),
    precio: numero(o.price) ?? numero(precio.price),
    precioOrigen: numero(precio.unit_origin_price),
    cantidad: Math.max(0, Math.round(numero(o.quantity) ?? 0)),
    estadoProducto: texto(o.state_code),
    activa: o.active === true,
    motivosInactiva: lista(o.inactivity_reasons).map((m) => (typeof m === 'string' ? m : texto(obj(m).code) ?? texto(obj(m).label) ?? '')).filter(Boolean),
    canales: lista(o.channels).filter((c): c is string => typeof c === 'string'),
    plazoEnvioDias: numero(o.leadtime_to_ship),
    claseLogistica: texto(obj(o.logistic_class).code),
    adicionales,
  }
}

/** Un producto del catálogo de PcComponentes, con las ofertas que ya tiene (P11) */
export interface ProductoPcc {
  productoId: string
  titulo: string
  marca: string | null
  ean: string | null
  mpn: string | null
  /** Cuántas tiendas lo venden ahora mismo */
  ofertas: number
  /** El precio más bajo, si alguien lo vende */
  precioMinimo: number | null
}

export function productoDeRespuesta(crudo: unknown): ProductoPcc {
  const p = obj(crudo)
  const refs = lista(p.product_references).map(obj)
  const ref = (tipo: string) => texto(refs.find((r) => r.reference_type === tipo)?.reference)
  const ofertas = lista(p.offers).map(obj)
  const precios = ofertas.map((o) => numero(o.total_price) ?? numero(o.price)).filter((n): n is number => n !== null)
  return {
    productoId: String(p.product_sku ?? ''),
    titulo: texto(p.product_title) ?? '',
    marca: texto(p.product_brand),
    ean: ref('EAN'),
    mpn: ref('MPN'),
    ofertas: ofertas.length || (numero(p.total_count) ?? 0),
    precioMinimo: precios.length > 0 ? Math.min(...precios) : null,
  }
}

/* ------------------------------------------------------------------ */
/* Las importaciones                                                   */
/* ------------------------------------------------------------------ */

export interface ImportacionPcc {
  id: string
  /** WAITING_SYNCHRONIZATION_PRODUCT, SENT, COMPLETE, FAILED… tal cual */
  estado: string
  /** true = ya no va a cambiar */
  terminada: boolean
  lineasLeidas: number
  lineasCorrectas: number
  lineasConError: number
  ofertasCreadas: number
  ofertasActualizadas: number
  ofertasBorradas: number
  hayInformeDeErrores: boolean
  motivo: string | null
}

const ESTADOS_FINALES = new Set(['COMPLETE', 'FAILED', 'CANCELLED', 'EXPIRED', 'REJECTED'])

export function importacionDeRespuesta(crudo: unknown): ImportacionPcc {
  const i = obj(crudo)
  const estado = texto(i.status) ?? 'DESCONOCIDO'
  return {
    id: String(i.import_id ?? ''),
    estado,
    terminada: ESTADOS_FINALES.has(estado),
    lineasLeidas: numero(i.lines_read) ?? 0,
    lineasCorrectas: numero(i.lines_in_success) ?? 0,
    lineasConError: numero(i.lines_in_error) ?? 0,
    ofertasCreadas: numero(i.offer_inserted) ?? 0,
    ofertasActualizadas: numero(i.offer_updated) ?? 0,
    ofertasBorradas: numero(i.offer_deleted) ?? 0,
    hayInformeDeErrores: i.has_error_report === true,
    motivo: texto(i.reason_status),
  }
}

/* ------------------------------------------------------------------ */
/* Lo que se manda (OF24)                                              */
/* ------------------------------------------------------------------ */

export interface OfertaParaSubir {
  /** Nuestro código (el del proveedor): identifica la oferta en la tienda */
  sku: string
  ean: string
  precio: number
  cantidad: number
  /** '1' = nuevo. Es el código de estado de PcComponentes, tal como lo traen sus ofertas */
  estadoProducto?: string
  /** Días hasta enviar. Por defecto el de la oferta que ya hay, o 0 */
  plazoEnvioDias?: number
  claseLogistica?: string
  /** Los campos propios de PcComponentes: «tipo-iva» y «canon» */
  tipoIva?: number
  canon?: number
}

export const LIMITES_SUBIDA = { precioMax: 100_000, cantidadMax: 100_000, ofertasPorEnvio: 500 } as const

/** Un EAN válido: 8, 12, 13 o 14 cifras con su dígito de control */
export function eanValido(ean: string): boolean {
  if (!/^\d+$/.test(ean) || ![8, 12, 13, 14].includes(ean.length)) return false
  const cifras = ean.split('').map(Number)
  const control = cifras.pop()!
  const suma = cifras.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (suma % 10)) % 10 === control
}

/** Los errores de una oferta antes de mandarla. Vacío = se puede mandar */
export function erroresDeOferta(o: OfertaParaSubir): string[] {
  const e: string[] = []
  if (o.sku.trim() === '') e.push('Falta la referencia (SKU)')
  if (!eanValido(o.ean)) e.push(`El EAN «${o.ean}» no es válido (8, 12, 13 o 14 cifras con su dígito de control)`)
  if (!Number.isFinite(o.precio) || o.precio <= 0 || o.precio > LIMITES_SUBIDA.precioMax) e.push('El precio tiene que ser mayor que 0')
  if (Math.abs(o.precio * 100 - Math.round(o.precio * 100)) > 1e-6) e.push('El precio no puede llevar más de dos decimales')
  if (!Number.isInteger(o.cantidad) || o.cantidad < 0 || o.cantidad > LIMITES_SUBIDA.cantidadMax) e.push('La cantidad tiene que ser un entero entre 0 y 100.000')
  return e
}

/**
 * El cuerpo de OF24 (POST /api/offers). OJO: Mirakl REINICIA a su valor por defecto cualquier campo de la oferta que no se manda, así que se mandan siempre todos
 * los que importan (plazo, clase logística, estado, IVA y canon) y nunca solo precio y stock.
 */
export function cuerpoDeOF24(ofertas: readonly OfertaParaSubir[]): { offers: Array<Record<string, unknown>> } {
  if (ofertas.length === 0) throw new Error('No hay ninguna oferta que mandar')
  if (ofertas.length > LIMITES_SUBIDA.ofertasPorEnvio) throw new Error(`Demasiadas ofertas de una vez (${ofertas.length}): el máximo es ${LIMITES_SUBIDA.ofertasPorEnvio}`)
  return {
    offers: ofertas.map((o) => {
      const errores = erroresDeOferta(o)
      if (errores.length > 0) throw new Error(`${o.sku || '(sin SKU)'}: ${errores.join('; ')}`)
      return {
        shop_sku: o.sku.trim(),
        product_id: o.ean,
        product_id_type: 'EAN',
        price: Math.round(o.precio * 100) / 100,
        quantity: o.cantidad,
        state_code: o.estadoProducto ?? '1',
        update_delete: 'update',
        leadtime_to_ship: o.plazoEnvioDias ?? 0,
        logistic_class: o.claseLogistica ?? 'medio',
        offer_additional_fields: [
          { code: 'tipo-iva', value: String(o.tipoIva ?? 21) },
          { code: 'canon', value: String(o.canon ?? 0) },
        ],
      }
    }),
  }
}

/** «4719331848774» → null si no es un EAN limpio; quita espacios y ceros de Excel («.0») */
export function limpiarEan(crudo: unknown): string | null {
  if (crudo === null || crudo === undefined) return null
  const t = String(crudo).trim().replace(/\.0+$/, '').replace(/\s+/g, '')
  return eanValido(t) ? t : null
}
