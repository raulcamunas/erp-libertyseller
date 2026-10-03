import { createServiceClient } from '@/lib/supabase/service'
import { cajasDeRemesa, type CajasDeRemesa } from './cajas'
import type { EstadoRemesa } from './flujo'
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
  /** El código del código de barras de la etiqueta. null = no lo sabemos todavía */
  fnsku: string | null
  enviadas: number
  consumidas: number
  devueltas: number
  quedan: number
  quedanVendibles: number
  agotadaEl: string | null
}

/**
 * ¿Es «esa columna o esa tabla no existe» y no otra cosa?
 *
 * 42703 lo dice Postgres; PGRST204 y PGRST205 los dice PostgREST cuando no lo
 * tiene en su caché de esquema. Cualquier otro código —un permiso, un timeout—
 * NO entra aquí: taparlo devolvería media pantalla sin decir por qué.
 */
function faltaLa215(error: { code?: string } | null): boolean {
  return error?.code === '42703' || error?.code === 'PGRST204' || error?.code === 'PGRST205'
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
  /** En qué paso del proceso está. Ver lib/fba/flujo.ts */
  estado: EstadoRemesa
  aprobadaAt: string | null
  /**
   * EN QUÉ VERSIÓN VA EL BOCETO. Empieza en 1 y sube cada vez que se reabre.
   *
   * Sirve para una sola cosa, y es la que importa: compararla con la versión de
   * las etiquetas que ya se imprimieron. Si lo impreso es de una versión
   * anterior, esas pegatinas están puestas en mercancía que puede haber dejado
   * de ir en el envío.
   */
  version: number
  reabiertaAt: string | null
  /** La última tirada de etiquetas, si ha habido alguna */
  ultimaImpresion: { version: number; etiquetas: number; impresoAt: string } | null
  /** Los envíos en que Amazon ha partido la remesa */
  envios: EnvioDeRemesa[]
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
  /** Las cajas de UNA remesa, la que se pide. null si no se pide ninguna */
  cajasDe: { remesaId: string; datos: CajasDeRemesa } | null
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
  estado: EstadoRemesa
  aprobada_at: string | null
  /** Pueden no venir: la 215 se lanza a mano y el código llega antes */
  version?: number | null
  reabierta_at?: string | null
}

export interface EnvioDeRemesa {
  shipmentId: string
  confirmationId: string | null
  nombre: string | null
  destino: string | null
  estado: string | null
  transportista: string | null
  esDeAmazon: boolean | null
  coste: number | null
  moneda: string | null
  saleDesde: string | null
  saleHasta: string | null
  entregaDesde: string | null
  entregaHasta: string | null
}

interface FilaLinea {
  fnsku: string | null
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
  opciones: { hoy: string; diasDeVelocidad?: number; cajasDe?: string | null }
): Promise<PanelRemesas> {
  const service = createServiceClient()

  /**
   * LAS COLUMNAS DE LA 215, APARTE Y CON PLAN B.
   *
   * ============ POR QUÉ, Y ES UN FALLO QUE YA PASÓ ============
   *
   * El código se despliega ANTES de que nadie lance la migración a mano en el
   * editor SQL de Supabase. Un `select` que nombra una columna inexistente NO
   * degrada: PostgREST contesta 42703 y la consulta entera revienta.
   *
   * Y eso fue exactamente lo que pasó: con la 215 sin lanzar, «Remesas a FBA» se
   * quedó en la pantalla de error para todo el mundo, por un contador de versión
   * que todavía no tenía ni un dato. El mismo cuidado estaba puesto en la agenda
   * —ver `faltaLa215` de lib/types/appointments.ts, que hace esto mismo para la
   * 214— y aquí se olvidó.
   *
   * Así que se pide con las columnas nuevas y, si la base aún no las tiene, se
   * repite sin ellas. En cuanto se lance la 215 deja de reintentar solo.
   */
  const BASE_REMESAS =
    'id, nombre, fecha_envio, llegada_at, referencia_envio, nota, connection_id, ' +
    'marketplace_id, estado_amazon, seguimiento_at, seguimiento_error, estado, aprobada_at'
  const CON_215 = `${BASE_REMESAS}, version, reabierta_at`

  let remesasRaw: unknown[] | null = null
  {
    const conNuevas = await service
      .from('fba_remesas')
      .select(CON_215)
      .eq('client_id', clienteId)
      .order('fecha_envio', { ascending: true })

    if (conNuevas.error && !faltaLa215(conNuevas.error)) throw conNuevas.error

    if (conNuevas.error) {
      const sinNuevas = await service
        .from('fba_remesas')
        .select(BASE_REMESAS)
        .eq('client_id', clienteId)
        .order('fecha_envio', { ascending: true })
      if (sinNuevas.error) throw sinNuevas.error
      remesasRaw = sinNuevas.data
    } else {
      remesasRaw = conNuevas.data
    }
  }

  const filasRemesa = (remesasRaw ?? []) as FilaRemesa[]
  if (filasRemesa.length === 0) {
    return {
      clienteId,
      cajasDe: null,
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
    .select('remesa_id, sku, unidades, nombre, variante, asin, referencia, unidades_recibidas, fnsku')
    .in('remesa_id', ids)
  if (errLineas) throw errLineas
  const filasLinea = (lineasRaw ?? []) as FilaLinea[]

  /**
   * LA ÚLTIMA TIRADA DE ETIQUETAS DE CADA REMESA.
   *
   * En su propio try/catch porque la 215 se lanza a mano en el editor SQL de
   * Supabase y el código puede llegar desplegado antes: sin la tabla, lo único
   * que pasa es que no se avisa de las etiquetas viejas, y no que la pantalla
   * entera se caiga. Se pide solo la última de cada una —es la que decide si lo
   * impreso vale— y no el histórico, que no se enseña en ningún sitio.
   */
  const impresionPorRemesa = new Map<
    string,
    { version: number; etiquetas: number; impresoAt: string }
  >()
  // Sin `throw`: si la 215 no está lanzada, `error` viene con PGRST205 y `data`
  // con null. Lo único que pasa entonces es que no se avisa de las etiquetas
  // viejas — y no que se caiga la pantalla, que es lo que pasó la primera vez.
  const { data: impresionesRaw } = await service
    .from('fba_impresiones')
    .select('remesa_id, version, etiquetas, impreso_at')
    .in('remesa_id', ids)
    .order('impreso_at', { ascending: false })
  for (const i of (impresionesRaw ?? []) as Array<{
    remesa_id: string
    version: number
    etiquetas: number
    impreso_at: string
  }>) {
    // Vienen de la más nueva a la más vieja: la primera de cada remesa gana.
    if (!impresionPorRemesa.has(i.remesa_id)) {
      impresionPorRemesa.set(i.remesa_id, {
        version: i.version,
        etiquetas: i.etiquetas,
        impresoAt: i.impreso_at,
      })
    }
  }

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

  // Los envíos de TODAS las remesas de una vez: son pocos y una lectura por
  // remesa serían diez viajes para pintar una lista.
  const { data: enviosRaw } = await service
    .from('fba_envios')
    .select('remesa_id, shipment_id, confirmation_id, nombre, destino, estado, transportista, es_de_amazon, coste, moneda, sale_desde, sale_hasta, entrega_desde, entrega_hasta')
    .in('remesa_id', ids)
  const enviosPorRemesa = new Map<string, EnvioDeRemesa[]>()
  for (const e of (enviosRaw ?? []) as Array<Record<string, unknown>>) {
    const lista = enviosPorRemesa.get(e.remesa_id as string) ?? []
    lista.push({
      shipmentId: e.shipment_id as string,
      confirmationId: (e.confirmation_id as string) ?? null,
      nombre: (e.nombre as string) ?? null,
      destino: (e.destino as string) ?? null,
      estado: (e.estado as string) ?? null,
      transportista: (e.transportista as string) ?? null,
      esDeAmazon: (e.es_de_amazon as boolean) ?? null,
      coste: e.coste === null || e.coste === undefined ? null : Number(e.coste),
      moneda: (e.moneda as string) ?? null,
      saleDesde: (e.sale_desde as string) ?? null,
      saleHasta: (e.sale_hasta as string) ?? null,
      entregaDesde: (e.entrega_desde as string) ?? null,
      entregaHasta: (e.entrega_hasta as string) ?? null,
    })
    enviosPorRemesa.set(e.remesa_id as string, lista)
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
      .map((l) => ({
        remesaId: l.remesa_id,
        sku: l.sku,
        unidades: l.unidades,
        // Lo que Amazon dice que recibió de verdad. Es sobre esto sobre lo que
        // reparte el FIFO: ver el comentario de repartirSku.
        recibidas: l.unidades_recibidas,
      }))
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
        fnsku: l.fnsku,
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
      // Las remesas de antes de la 195 no tienen estado: son historia y se
      // tratan como cerradas, no como borradores pendientes de aprobar.
      estado: (r.estado ?? 'cerrada') as EstadoRemesa,
      aprobadaAt: r.aprobada_at,
      // Sin la 215 lanzada, estas dos no vienen en la fila. Versión 1 y sin
      // reabrir es exactamente lo que significan: reabrir no existía.
      version: r.version ?? 1,
      reabiertaAt: r.reabierta_at ?? null,
      ultimaImpresion: impresionPorRemesa.get(r.id) ?? null,
      envios: enviosPorRemesa.get(r.id) ?? [],
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

  // Las cajas SOLO de la remesa que se está mirando: leerlas de las diez sería
  // trabajo para pintar una.
  const remesaDeCajas =
    opciones.cajasDe && filasRemesa.some((r) => r.id === opciones.cajasDe) ? opciones.cajasDe : null

  return {
    clienteId,
    cajasDe: remesaDeCajas ? { remesaId: remesaDeCajas, datos: await cajasDeRemesa(remesaDeCajas) } : null,
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
