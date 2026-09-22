import { createServiceClient } from '@/lib/supabase/service'
import {
  descuadre,
  repartirSku,
  type LineaRemesa,
  type Movimiento,
  type Remesa,
  type RepartoSku,
} from './fifo'

/**
 * LO QUE LA PANTALLA DE REMESAS NECESITA SABER.
 * =============================================
 * SOLO SERVIDOR.
 *
 * Aquí no se decide nada del reparto: eso está entero en fifo.ts, que es una
 * función pura y se prueba sola. Esto lee, llama, y junta el resultado con los
 * descriptivos y con el stock real.
 */

export interface LineaDePanel {
  sku: string
  /** Lo que Amazon dice que ha recibido. null = todavía no se ha preguntado */
  recibidas: number | null
  /** De la línea de la remesa, o del espejo del catálogo si el cliente conecta */
  nombre: string | null
  variante: string | null
  asin: string | null
  referencia: string | null
  enviadas: number
  consumidas: number
  devueltas: number
  quedan: number
  quedanVendibles: number
  agotadaEl: string | null
}

export interface RemesaDePanel {
  id: string
  nombre: string | null
  fechaEnvio: string
  llegadaAt: string | null
  referenciaEnvio: string | null
  nota: string | null
  /** WORKING, SHIPPED, IN_TRANSIT, CLOSED… tal y como lo llama Amazon */
  estadoAmazon: string | null
  seguimientoAt: string | null
  seguimientoError: string | null
  /** Enviadas menos recibidas, solo de las líneas que Amazon ya ha contestado.
      Es lo que se puede reclamar */
  unidadesQueNoLlegaron: number
  lineas: LineaDePanel[]
  /** Totales de la remesa: es la fila del resumen */
  enviadas: number
  quedan: number
  /** 0-100. Lo que el Excel llamaba «% del pedido» */
  consumidoPct: number
  agotadaEl: string | null
}

export interface SkuDePanel extends RepartoSku {
  nombre: string | null
  asin: string | null
  /** Lo que Amazon dice que hay ahora mismo, del ciclo de 15 minutos */
  stockReal: number | null
  /** stockReal − quedan. Positivo = hay más de lo que las remesas explican */
  descuadre: number | null
}

export interface PanelRemesas {
  clienteId: string
  conectado: boolean
  hoy: string
  remesas: RemesaDePanel[]
  skus: SkuDePanel[]
  /** Hasta qué día se ha leído el libro mayor. null = nunca */
  leidoHasta: string | null
  ultimoError: string | null
}

interface FilaRemesa {
  id: string
  nombre: string | null
  fecha_envio: string
  llegada_at: string | null
  referencia_envio: string | null
  nota: string | null
  connection_id: string | null
  marketplace_id: string
  estado_amazon: string | null
  seguimiento_at: string | null
  seguimiento_error: string | null
}

interface FilaLinea {
  remesa_id: string
  sku: string
  unidades: number
  nombre: string | null
  variante: string | null
  asin: string | null
  referencia: string | null
  unidades_recibidas: number | null
}

interface FilaMovimiento {
  sku: string
  fecha: string
  tipo: string
  cantidad: number
  disposicion: string | null
}

/**
 * El panel entero de un cliente.
 *
 * Una sola función y no un puñado de lecturas sueltas desde la pantalla, porque
 * el reparto necesita TODO a la vez: una remesa no se puede calcular sin las
 * demás del mismo SKU, y el porcentaje consumido de un envío sale de sumar sus
 * líneas ya repartidas.
 */
export async function panelDeCliente(
  clienteId: string,
  opciones: { hoy: string; diasDeVelocidad?: number }
): Promise<PanelRemesas> {
  const service = createServiceClient()

  const { data: remesasRaw, error: errRemesas } = await service
    .from('fba_remesas')
    .select('id, nombre, fecha_envio, llegada_at, referencia_envio, nota, connection_id, marketplace_id, estado_amazon, seguimiento_at, seguimiento_error')
    .eq('client_id', clienteId)
    .order('fecha_envio', { ascending: true })
  if (errRemesas) throw errRemesas

  const filasRemesa = (remesasRaw ?? []) as FilaRemesa[]
  if (filasRemesa.length === 0) {
    return {
      clienteId,
      conectado: false,
      hoy: opciones.hoy,
      remesas: [],
      skus: [],
      leidoHasta: null,
      ultimoError: null,
    }
  }

  const ids = filasRemesa.map((r) => r.id)
  const { data: lineasRaw, error: errLineas } = await service
    .from('fba_remesa_lineas')
    .select('remesa_id, sku, unidades, nombre, variante, asin, referencia, unidades_recibidas')
    .in('remesa_id', ids)
  if (errLineas) throw errLineas
  const filasLinea = (lineasRaw ?? []) as FilaLinea[]

  // La conexión sale de las propias remesas: un cliente sin autorización —el
  // caso de ShoesF— las lleva igual, y entonces no hay movimientos que leer.
  const connectionId = filasRemesa.find((r) => r.connection_id)?.connection_id ?? null
  const marketplaceId = filasRemesa[0]?.marketplace_id ?? null

  const skus = [...new Set(filasLinea.map((l) => l.sku))]

  let movimientos: Movimiento[] = []
  let leidoHasta: string | null = null
  let ultimoError: string | null = null
  const stockPorSku = new Map<string, number>()

  if (connectionId && marketplaceId && skus.length > 0) {
    // Desde el primer envío: antes de eso ningún movimiento puede consumir nada.
    const desde = filasRemesa[0].fecha_envio

    const { data: movsRaw, error: errMovs } = await service
      .from('fba_movimientos')
      .select('sku, fecha, tipo, cantidad, disposicion')
      .eq('connection_id', connectionId)
      .eq('marketplace_id', marketplaceId)
      .in('sku', skus)
      .gte('fecha', desde)
    if (errMovs) throw errMovs
    movimientos = ((movsRaw ?? []) as FilaMovimiento[]).map((m) => ({
      sku: m.sku,
      fecha: m.fecha,
      tipo: m.tipo,
      cantidad: m.cantidad,
      disposicion: m.disposicion,
    }))

    const { data: lectura } = await service
      .from('fba_lecturas')
      .select('leido_hasta, ultimo_error')
      .eq('connection_id', connectionId)
      .eq('marketplace_id', marketplaceId)
      .maybeSingle()
    leidoHasta = (lectura as { leido_hasta: string | null } | null)?.leido_hasta ?? null
    ultimoError = (lectura as { ultimo_error: string | null } | null)?.ultimo_error ?? null

    // El stock real, para el cuadre. Sale del espejo que ya refresca el ciclo
    // de quince minutos: no se le pregunta nada a Amazon desde aquí.
    const { data: listings } = await service
      .from('amazon_listings')
      .select('sku, fba_quantity, title, asin')
      .eq('connection_id', connectionId)
      .eq('marketplace_id', marketplaceId)
      .in('sku', skus)
    for (const l of (listings ?? []) as Array<{
      sku: string
      fba_quantity: number | null
      title: string | null
      asin: string | null
    }>) {
      if (typeof l.fba_quantity === 'number') stockPorSku.set(l.sku, l.fba_quantity)
    }
  }

  const remesasPorId = new Map<string, Remesa>(
    filasRemesa.map((r) => [
      r.id,
      { id: r.id, fechaEnvio: r.fecha_envio, fechaLlegada: r.llegada_at?.slice(0, 10) ?? null },
    ])
  )

  // El reparto, SKU a SKU. Cada uno necesita todas sus líneas a la vez.
  const repartoPorSku = new Map<string, RepartoSku>()
  for (const sku of skus) {
    const suyas: LineaRemesa[] = filasLinea
      .filter((l) => l.sku === sku)
      .map((l) => ({ remesaId: l.remesa_id, sku: l.sku, unidades: l.unidades }))
    repartoPorSku.set(
      sku,
      repartirSku(sku, suyas, remesasPorId, movimientos, {
        hoy: opciones.hoy,
        diasDeVelocidad: opciones.diasDeVelocidad,
      })
    )
  }

  // Un índice para no recorrer el reparto por cada línea
  const porRemesaYSku = new Map<string, ReturnType<typeof repartirSku>['lineas'][number]>()
  for (const reparto of repartoPorSku.values()) {
    for (const l of reparto.lineas) porRemesaYSku.set(`${l.remesaId}|${l.sku}`, l)
  }

  const descriptivo = new Map<string, FilaLinea>()
  for (const l of filasLinea) if (!descriptivo.has(l.sku)) descriptivo.set(l.sku, l)

  const remesas: RemesaDePanel[] = filasRemesa.map((r) => {
    const suyas = filasLinea.filter((l) => l.remesa_id === r.id)
    const lineas: LineaDePanel[] = suyas.map((l) => {
      const rep = porRemesaYSku.get(`${r.id}|${l.sku}`)
      return {
        sku: l.sku,
        recibidas: l.unidades_recibidas,
        nombre: l.nombre,
        variante: l.variante,
        asin: l.asin,
        referencia: l.referencia,
        enviadas: l.unidades,
        consumidas: rep?.consumidas ?? 0,
        devueltas: rep?.devueltas ?? 0,
        quedan: rep?.quedan ?? l.unidades,
        quedanVendibles: rep?.quedanVendibles ?? l.unidades,
        agotadaEl: rep?.agotadaEl ?? null,
      }
    })

    const enviadas = lineas.reduce((s, l) => s + l.enviadas, 0)
    const quedan = lineas.reduce((s, l) => s + l.quedan, 0)
    const agotadas = lineas.map((l) => l.agotadaEl)

    return {
      id: r.id,
      nombre: r.nombre,
      fechaEnvio: r.fecha_envio,
      llegadaAt: r.llegada_at,
      referenciaEnvio: r.referencia_envio,
      nota: r.nota,
      estadoAmazon: r.estado_amazon,
      seguimientoAt: r.seguimiento_at,
      seguimientoError: r.seguimiento_error,
      // Solo de las líneas que Amazon ya ha contestado: una línea sin respuesta
      // todavía no falta, simplemente no se sabe.
      unidadesQueNoLlegaron: lineas.reduce(
        (s, l) => s + (l.recibidas !== null && l.recibidas < l.enviadas ? l.enviadas - l.recibidas : 0),
        0
      ),
      lineas,
      enviadas,
      quedan,
      consumidoPct: enviadas > 0 ? Math.round(((enviadas - quedan) / enviadas) * 1000) / 10 : 0,
      // La remesa se agota cuando se agota su ÚLTIMA línea, no la primera: si
      // una talla vuela y otra no se mueve, el envío no está agotado.
      agotadaEl: agotadas.every((a) => a !== null)
        ? agotadas.reduce((max, a) => (max === null || (a && a > max) ? a : max), null as string | null)
        : null,
    }
  })

  const skusPanel: SkuDePanel[] = skus.map((sku) => {
    const rep = repartoPorSku.get(sku)!
    const d = descriptivo.get(sku)
    const stockReal = stockPorSku.has(sku) ? stockPorSku.get(sku)! : null
    return {
      ...rep,
      nombre: d?.nombre ?? null,
      asin: d?.asin ?? null,
      stockReal,
      descuadre: descuadre(rep.quedan, stockReal),
    }
  })

  return {
    clienteId,
    conectado: Boolean(connectionId),
    hoy: opciones.hoy,
    remesas,
    skus: skusPanel.sort((a, b) => {
      // Primero lo que se agota antes: es lo que hay que reponer
      const ca = a.diasDeCobertura ?? Number.POSITIVE_INFINITY
      const cb = b.diasDeCobertura ?? Number.POSITIVE_INFINITY
      return ca !== cb ? ca - cb : a.sku.localeCompare(b.sku)
    }),
    leidoHasta,
    ultimoError,
  }
}
