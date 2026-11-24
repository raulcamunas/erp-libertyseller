/**
 * LAS VENTAS POR CANAL (FBA Y FBM) DEL INFORME DE PEDIDOS DE AMAZON — PURO.
 * ========================================================================
 * Se comprueba con pedidos.prueba.ts. Lo usa lib/fba/pedidos-servidor.ts (la pasada de app/api/fba/cron-pedidos).
 *
 * POR QUÉ (24 nov 2026, Raúl): el plan de reposición calculaba el ritmo con el libro mayor de FBA, donde solo existe lo que sale de un almacén de
 * Amazon. ShoesF y Cobo venden las mismas zapatillas por FBM: un ASIN que vende 4 pares al día por FBM y 0 por FBA (porque no hay stock en Amazon)
 * salía «sin ventas» y no se proponía. Ahora se lee el informe de pedidos (GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL), que trae cada
 * línea de pedido con su SKU, su ASIN, sus unidades y si la sirvió Amazon («Amazon») o el vendedor («Merchant»).
 *
 * Solo se guarda el día, el SKU, el ASIN, el canal y las unidades: NADA del comprador (el informe trae ciudad y código postal y se tiran).
 * Los pedidos y las líneas cancelados no cuentan; los pendientes sí (son ventas que aún no se han cobrado).
 */

export const INFORME_PEDIDOS = 'GET_FLAT_FILE_ALL_ORDERS_DATA_BY_ORDER_DATE_GENERAL'

export type Canal = 'fba' | 'fbm'

export interface VentaCanal {
  /** 'YYYY-MM-DD' en la hora del mercado */
  fecha: string
  sku: string
  asin: string | null
  canal: Canal
  unidades: number
}

export interface PedidosLeidos {
  ventas: VentaCanal[]
  /** Líneas que no se han podido leer (sin fecha, sin SKU o con unidades raras) */
  descartadas: number
  canceladas: number
}

/** La zona horaria de un mercado: el día de un pedido es el de allí, no el de UTC */
export function zonaDeMercado(marketplaceId: string): string {
  switch (marketplaceId) {
    case 'ATVPDKIKX0DER': // EE. UU.
      return 'America/New_York'
    case 'A2EUQ1WTGCTBG2': // Canadá
      return 'America/Toronto'
    case 'A1AM78C64UM0Y8': // México
      return 'America/Mexico_City'
    case 'A1F83G8C2ARO7P': // Reino Unido
      return 'Europe/London'
    default:
      return 'Europe/Madrid'
  }
}

/** El día ('YYYY-MM-DD') de un instante en una zona horaria */
export function diaEnZona(instante: string | Date, zona: string): string | null {
  const d = typeof instante === 'string' ? new Date(instante) : instante
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

const partir = (linea: string): string[] => linea.replace(/\r$/, '').split('\t')

/**
 * Lee el fichero del informe (texto con tabuladores) y lo junta por (día, SKU, canal). Lanza si faltan las columnas que hacen falta: mejor decirlo
 * que guardar ceros que parezcan «no vende».
 */
export function parsearPedidos(texto: string, zona: string): PedidosLeidos {
  const lineas = texto.split('\n').filter((l) => l.trim().length > 0)
  if (lineas.length < 2) return { ventas: [], descartadas: 0, canceladas: 0 }
  const cab = partir(lineas[0]).map((c) => c.trim().toLowerCase())
  const col = (n: string) => cab.indexOf(n)
  const iFecha = col('purchase-date')
  const iCanal = col('fulfillment-channel')
  const iSku = col('sku')
  const iCantidad = col('quantity')
  if (iFecha < 0 || iCanal < 0 || iSku < 0 || iCantidad < 0) {
    throw new Error(`El informe de pedidos no trae las columnas esperadas (purchase-date, fulfillment-channel, sku, quantity). Ha devuelto: ${cab.slice(0, 30).join(', ')}`)
  }
  const iAsin = col('asin')
  const iEstado = col('order-status')
  const iEstadoLinea = col('item-status')

  const suma = new Map<string, VentaCanal>()
  let descartadas = 0
  let canceladas = 0
  for (const l of lineas.slice(1)) {
    const c = partir(l)
    const estado = (iEstado >= 0 ? c[iEstado] ?? '' : '').trim().toLowerCase()
    const estadoLinea = (iEstadoLinea >= 0 ? c[iEstadoLinea] ?? '' : '').trim().toLowerCase()
    if (estado === 'cancelled' || estadoLinea === 'cancelled') {
      canceladas++
      continue
    }
    const fecha = diaEnZona((c[iFecha] ?? '').trim(), zona)
    const sku = (c[iSku] ?? '').trim()
    const unidades = Number((c[iCantidad] ?? '').trim())
    const canalTexto = (c[iCanal] ?? '').trim().toLowerCase()
    const canal: Canal | null = canalTexto === 'amazon' || canalTexto === 'afn' ? 'fba' : canalTexto === 'merchant' || canalTexto === 'mfn' ? 'fbm' : null
    if (!fecha || !sku || !canal || !Number.isFinite(unidades) || unidades < 0 || unidades > 10_000) {
      descartadas++
      continue
    }
    if (unidades === 0) continue
    const asin = iAsin >= 0 ? (c[iAsin] ?? '').trim() || null : null
    const k = `${fecha}|${sku}|${canal}`
    const v = suma.get(k)
    if (v) {
      v.unidades += unidades
      if (!v.asin && asin) v.asin = asin
    } else suma.set(k, { fecha, sku, asin, canal, unidades })
  }
  return { ventas: [...suma.values()], descartadas, canceladas }
}

/* ------------------------------------------------------------------ */
/* Qué tramo pedir                                                     */
/* ------------------------------------------------------------------ */

export const VENTANA_PEDIDOS = {
  /** La primera vez se traen 6 meses */
  primeraLecturaDias: 180,
  /** Amazon no deja pedir más de 30 días por informe */
  tramoMaxDias: 30,
  /** Lo último se relee: un pedido pendiente puede cancelarse o enviarse días después */
  solapeDias: 3,
  /** Al día, se vuelve a leer cada tantas horas */
  horasEntreLecturas: 6,
} as const

const DIA_MS = 86_400_000

export interface EstadoLecturaPedidos {
  leidoDesde: string | null
  leidoHasta: string | null
  /** La última lectura completa (ISO) */
  leidoAt: string | null
}

/**
 * El siguiente tramo [desde, hasta) que hay que pedir, o null si está al día. Siempre empieza a las 00:00 UTC de un día (con un día de margen) para
 * que el primer día del tramo no se quede a medias: ese primer día NO se reemplaza al guardar (`diasQueSeReemplazan`).
 */
export function siguienteTramo(e: EstadoLecturaPedidos, ahora: Date): { desde: Date; hasta: Date } | null {
  const V = VENTANA_PEDIDOS
  const hoyUtc = Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate())
  let desdeMs: number
  if (!e.leidoHasta) desdeMs = hoyUtc - V.primeraLecturaDias * DIA_MS
  else {
    const hasta = Date.parse(`${e.leidoHasta}T00:00:00Z`)
    const alDia = hasta >= hoyUtc - DIA_MS
    if (alDia && e.leidoAt && ahora.getTime() - Date.parse(e.leidoAt) < V.horasEntreLecturas * 3_600_000) return null
    desdeMs = hasta - V.solapeDias * DIA_MS
  }
  const hastaMs = Math.min(ahora.getTime() - 5 * 60_000, desdeMs + V.tramoMaxDias * DIA_MS)
  if (hastaMs <= desdeMs) return null
  return { desde: new Date(desdeMs), hasta: new Date(hastaMs) }
}

/**
 * Los días que un informe del tramo [desde, hasta) cubre ENTEROS en la zona del mercado, y por eso se pueden borrar y volver a escribir: del día
 * siguiente al de `desde` al de `hasta` si el tramo llega hasta «ahora» (de hoy no hay más), o al anterior si no. null si no cubre ninguno.
 */
export function diasQueSeReemplazan(desde: Date, hasta: Date, zona: string, ahora: Date): { desde: string; hasta: string } | null {
  const d0 = diaEnZona(new Date(desde.getTime() + DIA_MS), zona)
  // Un tramo que acaba «ahora» tiene todo lo que hay de hoy; uno que acaba antes (la carga de 6 meses, de 30 en 30 días) deja su último día a medias
  const llegaAAhora = ahora.getTime() - hasta.getTime() < 30 * 60_000
  const d1 = diaEnZona(llegaAAhora ? hasta : new Date(hasta.getTime() - DIA_MS), zona)
  if (!d0 || !d1 || d1 < d0) return null
  return { desde: d0, hasta: d1 }
}
