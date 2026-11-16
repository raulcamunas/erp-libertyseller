import { createServiceClient } from '@/lib/supabase/service'
import {
  CONFIG_ALERTAS_POR_DEFECTO,
  UMBRALES_ALERTAS,
  FAMILIA_DE_TIPO,
  calcularAlertas,
  clientesPorUsuario,
  destinatariosDelCliente,
  filasDeAlertas,
  lineaPlanParaAlertas,
  lotesDeFilas,
  planearAlertas,
  planVigente,
  plazoValido,
  type AlertaFba,
  type ConfigAlertas,
  type EnvioParaAlertas,
  type FilaDeAlerta,
  type PerfilParaAvisos,
  type PlanParaAlertas,
  type Severidad,
  type VentasDelAnoPasado,
} from './alertas'
import { FALTA_LA_MIGRACION_267 } from './alertas-mensajes'
import { enviosDelCliente, inventarioDeCliente } from './inventario-datos'
import { sumarDiasInv, type EnvioInventario } from './inventario'
import { medirCadencia, medirRecepcion, medirTransporte } from './medidas-cliente'
import { leerTodo } from './paginar'
import type { MedidasCliente, PlazoEtapas } from './plan-tipos'
import { esNoComprable, plazoDelCliente } from './planificador'
import { faltaLaTabla } from './planificacion'

/**
 * LEER LA BASE, CALCULAR LAS ALERTAS DE UN CLIENTE Y ESCRIBIRLAS — SOLO SERVIDOR.
 * ===============================================================================
 * Aquí no se decide qué merece una alerta: eso está en alertas.ts (puro, con pruebas). Aquí se junta lo que hace falta —el inventario del
 * cliente, sus envíos con el momento del último cambio, las ventas del año pasado, los ajustes de inventario recientes y qué listings no son
 * comprables—, se llama al motor y se guarda lo que salga, comparándolo con lo que ya había.
 *
 * NADA DE ESTO ESCRIBE EN AMAZON. Solo lee de la base del ERP (que ya se alimenta del libro mayor y del catálogo) y escribe en las tablas de
 * alertas (migración 267) y en la campana.
 *
 * SIN LA MIGRACIÓN 267 las tablas no existen: se dice (`faltaMigracion`) y no se rompe nada. Las alertas se calculan igual a demanda.
 *
 *
 * ============ CAMBIOS DE COMPORTAMIENTO (remesas-pro, 15 nov 2026) ============
 *
 *   · EL CRON DE ALERTAS VUELVE A GUARDAR (spec §0.1). Fallaba desde el 4 nov: un upsert en lote mezclaba filas con y sin
 *     `primera_vez_at` y saltaba el NOT NULL de la 267. Ahora cada lote tiene una sola forma (`lotesDeFilas`) y además
 *     `defaultToNull: false`.
 *   · EL PLAZO YA NO ES EL 45 FIJO (§2.4). `conPlazoDelCliente` usa `plazoDelCliente` (manual > medido > de partida por
 *     etapa) con lo medido en sus envíos (`medidasDeAlertas`: transporte, recepción p75 y cadencia) → L + M, el mismo número
 *     que el planificador. Opinas pasa de 45 a unos 24 días y deja de inflar «reponer ya».
 *   · UN SOLO NÚMERO DE ROTURA (D30). Las alertas de reposición y rotura toman fecha, prioridad, € y moneda de la línea de la
 *     ÚLTIMA pasada del planificador si tiene ≤ 36 h (`planParaAlertas`, tabla `fba_plan_pasadas` de la 316). Sin la 316, sin
 *     pasada o vieja: la cuenta de siempre.
 *   · «NO COMPRABLE» CON LA REGLA DEL PLANIFICADOR (D1). `comprablesDe` (exportada para el plan) usa `esNoComprable`: también
 *     `activo_manual = false`; una fila sin `listing_status` guardado ya no se acusa.
 *   · A QUIÉN SE AVISA (D24 y D27). `destinatariosDe` y el resumen del lunes: admins, empleados con la casilla `remesas` y
 *     quien tenga `fba_accesos` (con `reglaDeAcceso`). Antes solo admins y `fba_accesos`.
 */

type Servicio = ReturnType<typeof createServiceClient>

export { FALTA_LA_MIGRACION_267 }

const MARKETPLACE_ESPANA = 'A1RKKUPIHCS9HS'

/* ------------------------------------------------------------------ */
/* La configuración: el plazo lo pone el equipo                        */
/* ------------------------------------------------------------------ */

export interface ConfigDeCliente extends ConfigAlertas {
  /** false = se calculan y se ven las alertas pero no suena la campana */
  avisar: boolean
  /** El plazo por etapas de `plazoDelCliente` con el que sale `plazoDias` (L + M). null hasta que se calcula */
  plazo: PlazoEtapas | null
}

/** Lo que `plazoDelCliente` necesita de `fba_alertas_config` (etapas de la 291 y el total) */
type EtapasConfig = Parameters<typeof plazoDelCliente>[0]

export interface ConfigLeida {
  config: ConfigDeCliente
  faltaMigracion: boolean
  /** Las etapas puestas a mano (o solo el total); null si el cliente no tiene fila */
  etapas: EtapasConfig
}

const COLUMNAS_CONFIG = 'plazo_reposicion_dias, antelacion_dias, avisar'
const COLUMNAS_CONFIG_CON_ETAPAS = `${COLUMNAS_CONFIG}, dias_preparacion, dias_transporte, dias_recepcion, margen_dias`

/**
 * La fila de configuración y los plazos por referencia. El plazo que sale aquí (`plazoDias`) es el VIEJO (el total guardado o 45)
 * y lo sustituye `conPlazoDelCliente` en cuanto hay medidas: ver `calcularAlertasDeCliente`.
 */
export async function leerConfigAlertas(service: Servicio, clienteId: string): Promise<ConfigLeida> {
  const porDefecto: ConfigDeCliente = { ...CONFIG_ALERTAS_POR_DEFECTO, plazoPorSku: {}, avisar: true, plazo: null }
  let r = await service.from('fba_alertas_config').select(COLUMNAS_CONFIG_CON_ETAPAS).eq('client_id', clienteId).maybeSingle()
  // Sin la 291 no hay etapas: se repite sin ellas (el total sigue valiendo)
  if (r.error && r.error.code === '42703') r = await service.from('fba_alertas_config').select(COLUMNAS_CONFIG).eq('client_id', clienteId).maybeSingle()
  const { data, error } = r
  if (error) {
    if (faltaLaTabla(error)) return { config: porDefecto, faltaMigracion: true, etapas: null }
    throw error
  }
  const { data: filasSku, error: errorSku } = await service
    .from('fba_alertas_plazo_sku')
    .select('sku, plazo_reposicion_dias')
    .eq('client_id', clienteId)
  if (errorSku && !faltaLaTabla(errorSku)) throw errorSku
  const plazoPorSku: Record<string, number> = {}
  for (const f of (filasSku ?? []) as Array<{ sku: string; plazo_reposicion_dias: number }>) {
    const p = plazoValido(f.plazo_reposicion_dias)
    if (p !== null) plazoPorSku[f.sku] = p
  }
  if (!data) return { config: { ...porDefecto, plazoPorSku }, faltaMigracion: false, etapas: null }
  const fila = data as unknown as {
    plazo_reposicion_dias: number | null
    antelacion_dias: number | null
    avisar: boolean | null
    dias_preparacion?: number | null
    dias_transporte?: number | null
    dias_recepcion?: number | null
    margen_dias?: number | null
  }
  return {
    config: {
      plazoDias: plazoValido(fila.plazo_reposicion_dias) ?? porDefecto.plazoDias,
      plazoConfigurado: true,
      antelacionDias: Math.min(120, Math.max(0, Math.round(fila.antelacion_dias ?? porDefecto.antelacionDias))),
      plazoPorSku,
      avisar: fila.avisar !== false,
      plazo: null,
    },
    faltaMigracion: false,
    etapas: {
      diasPreparacion: fila.dias_preparacion ?? null,
      diasTransporte: fila.dias_transporte ?? null,
      diasRecepcion: fila.dias_recepcion ?? null,
      diasMargen: fila.margen_dias ?? null,
      total: plazoValido(fila.plazo_reposicion_dias),
    },
  }
}

/* ------------------------------------------------------------------ */
/* El plazo: plazoDelCliente con lo medido (spec §2.4, D10 y D14)      */
/* ------------------------------------------------------------------ */

const ENVIADA_O_CERRADA = ['enviada', 'cerrada']
/** Envíos con número que se miran para medir transporte y recepción (las funciones se quedan con los 6 últimos que valgan) */
const ENVIOS_A_MEDIR = 10

/**
 * Lo que tardan de verdad los envíos de un cliente: transporte (envío → primer Receipt), recepción (p75 del primer Receipt al
 * 90 % recibido) y cadencia. Los Receipts se leen del libro de la lectura elegida por número de envío
 * (`fba_movimientos_referencia_idx`). Sin conexión, sin medidas.
 */
export async function medidasDeAlertas(
  service: Servicio,
  conexion: string | null,
  mercado: string,
  envios: readonly EnvioInventario[],
  hoy: string
): Promise<MedidasCliente | null> {
  const enviadas = envios
    .filter((e) => ENVIADA_O_CERRADA.includes(e.estado) && e.fechaEnvio)
    .sort((a, b) => b.fechaEnvio.localeCompare(a.fechaEnvio))
  if (enviadas.length === 0) return null
  const unidadesDe = (e: EnvioInventario): number => e.lineas.reduce((s, l) => s + (Number(l.unidades) || 0), 0)
  const cad = medirCadencia(enviadas.map((e) => ({ fechaEnvio: e.fechaEnvio.slice(0, 10), unidades: unidadesDe(e) })))

  const aMedir = enviadas.filter((e) => e.referenciaEnvio).slice(0, ENVIOS_A_MEDIR)
  const porReferencia = new Map<string, Array<{ fecha: string; cantidad: number }>>()
  if (conexion && aMedir.length > 0) {
    const filas = await leerTodo<{ referencia: string; fecha: string; cantidad: number }>((a, b) =>
      service
        .from('fba_movimientos')
        .select('referencia, fecha, cantidad')
        .eq('connection_id', conexion)
        .eq('marketplace_id', mercado)
        .eq('tipo', 'Receipts')
        .in(
          'referencia',
          aMedir.map((e) => e.referenciaEnvio as string)
        )
        .order('fecha', { ascending: true })
        .order('id', { ascending: true })
        .range(a, b)
    )
    for (const f of filas) {
      const c = Number(f.cantidad) || 0
      if (!f.referencia || c <= 0) continue
      const lista = porReferencia.get(f.referencia) ?? []
      lista.push({ fecha: f.fecha.slice(0, 10), cantidad: c })
      porReferencia.set(f.referencia, lista)
    }
  }
  const conRecibos = aMedir.map((e) => {
    const recibos = porReferencia.get(e.referenciaEnvio as string) ?? []
    const primer = recibos.reduce<string | null>((m, x) => (m === null || x.fecha < m ? x.fecha : m), null)
    return { e, recibos, primer }
  })
  const transporteMediano = medirTransporte(conRecibos.map((x) => ({ fechaEnvio: x.e.fechaEnvio.slice(0, 10), primerReceipt: x.primer })))
  const recepcionP75 = medirRecepcion(
    conRecibos.filter((x) => x.recibos.length > 0).map((x) => ({ enviadas: unidadesDe(x.e), receipts: x.recibos })),
    hoy
  )
  const enviosMedidos = Math.min(6, conRecibos.filter((x) => x.primer !== null && x.primer >= x.e.fechaEnvio.slice(0, 10)).length)
  return { transporteMediano, recepcionP75, enviosMedidos, cadenciaDias: cad.cadenciaDias, tamanoTipico: cad.tamanoTipico }
}

/**
 * El plazo de las alertas = L + M de `plazoDelCliente` (manual > medido > de partida, por etapa), el MISMO que usa el
 * planificador. Cambio de comportamiento (§2.4): antes, sin fila de configuración, 45 días fijos; Opinas pasa a unos 24.
 * `plazoConfigurado` = el equipo puso el plazo (hay fila) o ninguna etapa queda de partida.
 * Los plazos por referencia siguen siendo el total que se guardó (sustituyen a L + M, como en el planificador).
 */
export function conPlazoDelCliente(leida: ConfigLeida, medidas: MedidasCliente | null, hoy: string): ConfigDeCliente {
  const plazo = plazoDelCliente(leida.etapas, medidas, hoy, { transporteUrgenteDias: null })
  const total = plazo.hastaLaVenta + plazo.margen
  return {
    ...leida.config,
    plazoDias: plazoValido(total) ?? leida.config.plazoDias,
    plazoConfigurado: leida.etapas !== null || !plazo.sinConfirmar,
    plazo,
  }
}

/* ------------------------------------------------------------------ */
/* La última pasada del planificador (spec §11 D30)                    */
/* ------------------------------------------------------------------ */

/**
 * Las líneas de la ÚLTIMA pasada del planificador si tiene ≤ 36 h y salió bien (`ok` o `provisional`). Sin la migración 316, sin
 * pasada, o vieja: null, y las alertas hacen su cuenta de siempre.
 */
export async function planParaAlertas(service: Servicio, clienteId: string, ahora: string): Promise<PlanParaAlertas | null> {
  const { data, error } = await service
    .from('fba_plan_pasadas')
    .select('calculado_at, estado, lineas')
    .eq('client_id', clienteId)
    .order('calculado_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    if (faltaLaTabla(error)) return null
    throw error
  }
  const fila = data as { calculado_at: string; estado: string; lineas: unknown } | null
  if (!fila || !['ok', 'provisional'].includes(fila.estado) || !planVigente(fila.calculado_at, ahora)) return null
  const lineas: PlanParaAlertas['lineas'] = {}
  for (const crudo of Array.isArray(fila.lineas) ? fila.lineas : []) {
    const l = lineaPlanParaAlertas(crudo)
    if (l) lineas[l.sku] = l
  }
  // Una pasada con las líneas ya vaciadas (> 7 días) no puede ser vigente, pero por si acaso: sin líneas, sin plan
  return Object.keys(lineas).length > 0 ? { calculadoAt: fila.calculado_at, lineas } : null
}

/* ------------------------------------------------------------------ */
/* Lo que se lee para calcular                                         */
/* ------------------------------------------------------------------ */

/** Cuándo se VIO por última vez un cambio en cada envío (migración 224). Sin la tabla, vacío: el motor cae a la fecha de envío */
async function ultimosCambios(service: Servicio, remesaIds: readonly string[]): Promise<Map<string, string>> {
  const salida = new Map<string, string>()
  for (let i = 0; i < remesaIds.length; i += 100) {
    const trozo = remesaIds.slice(i, i + 100)
    try {
      const filas = await leerTodo<{ remesa_id: string; visto_at: string }>((a, b) =>
        service
          .from('fba_remesa_eventos')
          .select('remesa_id, visto_at')
          .in('remesa_id', trozo)
          .order('visto_at', { ascending: true })
          .order('id', { ascending: true })
          .range(a, b)
      )
      for (const f of filas) {
        const previo = salida.get(f.remesa_id)
        if (!previo || f.visto_at > previo) salida.set(f.remesa_id, f.visto_at)
      }
    } catch (e) {
      if (!faltaLaTabla(e as { code?: string })) throw e
      return salida
    }
  }
  return salida
}

/** Las ventas del tramo de hace un año que interesa para la estacionalidad: sku → fecha → unidades */
async function ventasDelAnoPasado(service: Servicio, conexion: string, mercado: string, hoy: string, horizonteMax: number): Promise<VentasDelAnoPasado> {
  const base = sumarDiasInv(hoy, -365)
  const desde = sumarDiasInv(base, -UMBRALES_ALERTAS.estacional.diasPrevios)
  const hasta = sumarDiasInv(base, horizonteMax)
  const filas = await leerTodo<{ sku: string; fecha: string; cantidad: number }>((a, b) =>
    service
      .from('fba_movimientos')
      .select('sku, fecha, cantidad')
      .eq('connection_id', conexion)
      .eq('marketplace_id', mercado)
      .eq('tipo', 'Shipments')
      .gte('fecha', desde)
      .lt('fecha', hasta)
      .order('fecha', { ascending: true })
      .order('id', { ascending: true })
      .range(a, b)
  )
  const salida: VentasDelAnoPasado = {}
  for (const f of filas) {
    const porDia = (salida[f.sku] ??= {})
    porDia[f.fecha] = (porDia[f.fecha] ?? 0) + Math.abs(f.cantidad)
  }
  return salida
}

/** Los ajustes de inventario de los últimos días, en neto por referencia (negativo = Amazon dio de baja unidades) */
async function ajustesRecientes(service: Servicio, conexion: string, mercado: string, hoy: string): Promise<Array<{ sku: string; neto: number }>> {
  const desde = sumarDiasInv(hoy, -UMBRALES_ALERTAS.perdidas.ventanaDias)
  const filas = await leerTodo<{ sku: string; cantidad: number }>((a, b) =>
    service
      .from('fba_movimientos')
      .select('sku, cantidad')
      .eq('connection_id', conexion)
      .eq('marketplace_id', mercado)
      .eq('tipo', 'Adjustments')
      .gte('fecha', desde)
      .order('fecha', { ascending: true })
      .order('id', { ascending: true })
      .range(a, b)
  )
  const neto = new Map<string, number>()
  for (const f of filas) neto.set(f.sku, (neto.get(f.sku) ?? 0) + f.cantidad)
  return [...neto.entries()].map(([sku, n]) => ({ sku, neto: n }))
}

export interface ComprablesDeCliente {
  /** Algún listing del cliente en ese mercado trae BUYABLE: sin esto no se afirma que nada sea no comprable (D1) */
  hayBuyableEnCliente: boolean
  /** Los SKU pedidos que NO se pueden comprar según `esNoComprable` */
  noComprables: string[]
}

/**
 * QUÉ SE PUEDE COMPRAR: la comprobación de la alerta `sin_comprar`, con la regla única `esNoComprable` del planificador (D1).
 * La exporta S4a para que el plan (S1) use la misma lectura.
 *
 *   · No comprable = `activo_manual = false`, o (con stock, V > 0) sin BUYABLE. V = 0 sin BUYABLE es AGOTADO (Amazon quita
 *     BUYABLE al quedarse sin stock), no «no comprable».
 *   · SOLO SE AFIRMA SI EL DATO EXISTE: si ningún listing del cliente trae BUYABLE, el catálogo todavía no ha guardado el estado
 *     (o este cliente no lo expone) y acusar a todos sería una avalancha de falsas alarmas.
 *   · `vendibles`: el stock de cada SKU. Sin él se da por V > 0 (la alerta solo pregunta por los que tienen stock y ventas).
 *   · Un SKU sin fila de listing no se acusa.
 * Si algo falla al leer, no se afirma nada (lista vacía): mejor una alerta de menos que una falsa.
 */
export async function comprablesDe(
  service: Servicio,
  conexion: string,
  mercado: string,
  skus: readonly string[],
  vendibles?: ReadonlyMap<string, number>
): Promise<ComprablesDeCliente> {
  const nada: ComprablesDeCliente = { hayBuyableEnCliente: false, noComprables: [] }
  const { count, error } = await service
    .from('amazon_listings')
    .select('sku', { count: 'exact', head: true })
    .eq('connection_id', conexion)
    .eq('marketplace_id', mercado)
    .contains('listing_status', ['BUYABLE'])
  if (error) return nada
  const hayBuyableEnCliente = (count ?? 0) > 0
  if (skus.length === 0) return { hayBuyableEnCliente, noComprables: [] }

  const malos: string[] = []
  for (let i = 0; i < skus.length; i += 150) {
    let r = await service
      .from('amazon_listings')
      .select('sku, listing_status, activo_manual')
      .eq('connection_id', conexion)
      .eq('marketplace_id', mercado)
      .in('sku', skus.slice(i, i + 150))
    // Sin la columna `activo_manual` (migración vieja): solo el estado
    if (r.error && r.error.code === '42703') {
      r = (await service
        .from('amazon_listings')
        .select('sku, listing_status')
        .eq('connection_id', conexion)
        .eq('marketplace_id', mercado)
        .in('sku', skus.slice(i, i + 150))) as typeof r
    }
    if (r.error) return { hayBuyableEnCliente, noComprables: [] }
    for (const f of (r.data ?? []) as Array<{ sku: string; listing_status: string[] | null; activo_manual?: boolean | null }>) {
      const no = esNoComprable({
        vendibles: vendibles?.get(f.sku) ?? 1,
        // null = el catálogo no guardó el estado de esa fila: no se afirma (antes contaba como «sin BUYABLE»)
        listingStatus: f.listing_status ?? null,
        hayBuyableEnCliente,
        suprimido: false,
        activoManual: f.activo_manual ?? null,
      })
      if (no) malos.push(f.sku)
    }
  }
  return { hayBuyableEnCliente, noComprables: malos }
}

/* ------------------------------------------------------------------ */
/* Calcular                                                            */
/* ------------------------------------------------------------------ */

export interface ResultadoDeCalculo {
  conectado: boolean
  alertas: AlertaFba[]
  /** false = alguna lectura falló y NO se debe dar por resuelta ninguna alerta */
  completo: boolean
  /** Por qué no se pudo calcular, o aviso de que se calculó a medias */
  error: string | null
  config: ConfigDeCliente
  faltaMigracion: boolean
}

/** Las alertas de un cliente, calculadas ahora mismo con lo que hay en la base. No escribe nada */
export async function calcularAlertasDeCliente(service: Servicio, clienteId: string, hoy: string): Promise<ResultadoDeCalculo> {
  const leida = await leerConfigAlertas(service, clienteId)
  const { faltaMigracion } = leida
  let config = leida.config
  const inv = await inventarioDeCliente(clienteId, { hoy })
  if (!inv.conectado) return { conectado: false, alertas: [], completo: false, error: 'El cliente no tiene una conexión de Amazon activa', config, faltaMigracion }

  const envios = await enviosDelCliente(service, clienteId)
  const cambios = await ultimosCambios(service, envios.map((e) => e.id))
  const enviosAlertas: EnvioParaAlertas[] = envios.map((e) => ({ ...e, ultimoCambioAt: cambios.get(e.id) ?? null }))

  let completo = true
  const errores: string[] = []
  const conexion = inv.conexionId
  const mercado = inv.marketplaceId ?? MARKETPLACE_ESPANA

  // El plazo de plazoDelCliente con lo medido (§2.4): si medir falla, el de partida por etapas (nunca el 45 fijo)
  let medidas: MedidasCliente | null = null
  try {
    medidas = await medidasDeAlertas(service, conexion, mercado, envios, hoy)
  } catch (e) {
    errores.push(`plazo medido: ${mensaje(e)}`)
  }
  config = conPlazoDelCliente({ ...leida, config }, medidas, hoy)

  // Un solo número de rotura (D30): la última pasada del planificador, si tiene ≤ 36 h
  let plan: PlanParaAlertas | null = null
  try {
    plan = await planParaAlertas(service, clienteId, new Date().toISOString())
  } catch (e) {
    // Sin el plan, la cuenta de siempre: no es un fallo del cálculo
    errores.push(`plan: ${mensaje(e)}`)
  }

  let ventasAnoPasado: VentasDelAnoPasado | undefined
  let ajustes: Array<{ sku: string; neto: number }> | undefined
  let sinComprar: string[] | undefined
  if (conexion) {
    const horizonteMax = Math.max(config.plazoDias, ...Object.values(config.plazoPorSku)) + config.antelacionDias
    try {
      ventasAnoPasado = await ventasDelAnoPasado(service, conexion, mercado, hoy, horizonteMax)
    } catch (e) {
      // Sin estacionalidad el cálculo sigue valiendo (solo se queda sin el ajuste que SUBE el ritmo): no se da por incompleto
      errores.push(`estacionalidad: ${mensaje(e)}`)
    }
    try {
      ajustes = await ajustesRecientes(service, conexion, mercado, hoy)
    } catch (e) {
      completo = false
      errores.push(`ajustes: ${mensaje(e)}`)
    }
    try {
      const candidatos = inv.skus.filter((s) => s.vendibles > 0 && s.vendidas.d90 > 0)
      const r = await comprablesDe(
        service,
        conexion,
        mercado,
        candidatos.map((s) => s.sku),
        new Map(candidatos.map((s) => [s.sku, s.vendibles] as const))
      )
      sinComprar = r.noComprables
    } catch (e) {
      completo = false
      errores.push(`listings: ${mensaje(e)}`)
    }
  }

  const alertas = calcularAlertas({ hoy, inventario: inv, envios: enviosAlertas, config, ventasAnoPasado, noComprables: sinComprar, ajustesRecientes: ajustes, plan })
  // Una lectura del libro que va atrasada (o sin leer) no es un fallo del cálculo, pero sí obliga a no cerrar nada: faltan ventas
  if (inv.libro === 'sin_leer') {
    completo = false
    errores.push('el libro mayor de Amazon no se ha leído todavía')
  }
  return { conectado: true, alertas, completo, error: errores.length > 0 ? errores.join(' · ') : null, config, faltaMigracion }
}

const mensaje = (e: unknown): string => (e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160))

/* ------------------------------------------------------------------ */
/* Guardar                                                             */
/* ------------------------------------------------------------------ */

export interface ResultadoDeGuardado {
  nuevas: number
  actualizadas: number
  resueltas: number
  /** Las que merecen aviso en la campana (críticas o altas nuevas o que han empeorado) */
  avisar: AlertaFba[]
  faltaMigracion: boolean
}

const TROZO = 150

/** Escribe lo calculado: crea, actualiza y cierra. NO avisa: devuelve qué merece aviso para que quien llama lo haga y luego lo marque (`marcarAvisadas`) */
export async function guardarAlertas(service: Servicio, clienteId: string, alertas: readonly AlertaFba[], hoy: string, completo: boolean): Promise<ResultadoDeGuardado> {
  const { data, error } = await service
    .from('fba_alertas')
    .select('clave, estado, severidad, silenciada_hasta, severidad_avisada')
    .eq('client_id', clienteId)
  if (error) {
    if (faltaLaTabla(error)) return { nuevas: 0, actualizadas: 0, resueltas: 0, avisar: [], faltaMigracion: true }
    throw error
  }
  const guardadas: FilaDeAlerta[] = ((data ?? []) as Array<{ clave: string; estado: FilaDeAlerta['estado']; severidad: Severidad; silenciada_hasta: string | null; severidad_avisada: Severidad | null }>).map(
    (f) => ({ clave: f.clave, estado: f.estado, severidad: f.severidad, silenciadaHasta: f.silenciada_hasta, severidadAvisada: f.severidad_avisada })
  )
  const plan = planearAlertas(guardadas, alertas, hoy, completo)
  const ahora = new Date().toISOString()

  /**
   * EL CRON FALLABA DESDE EL 4 NOV (spec §0.1). Un upsert en lote con filas de columnas distintas: solo las nuevas o reabiertas llevan
   * `primera_vez_at`, PostgREST arma el lote con la unión de columnas y pone NULL donde una fila no la trae, y saltaba el NOT NULL de
   * la 267 en las existentes. Ahora `lotesDeFilas` separa las nuevas o reabiertas (con `primera_vez_at` y `resuelta_at: null`) de las
   * existentes (sin esas columnas) y de las silenciadas (sin `silenciada_hasta`): cada lote, una sola forma (probado en alertas.prueba.ts).
   * `defaultToNull: false` es la segunda red: lo que una fila no nombra se queda como está.
   */
  const filas = filasDeAlertas(clienteId, plan.escribir, ahora)
  for (const lote of lotesDeFilas(filas, TROZO)) {
    const { error: e } = await service.from('fba_alertas').upsert(lote, { onConflict: 'client_id,clave', defaultToNull: false })
    if (e) throw e
  }
  for (let i = 0; i < plan.resolver.length; i += TROZO) {
    const { error: e } = await service
      .from('fba_alertas')
      .update({ estado: 'resuelta', resuelta_at: ahora })
      .eq('client_id', clienteId)
      .in('clave', plan.resolver.slice(i, i + TROZO))
    if (e) throw e
  }
  return {
    nuevas: plan.escribir.filter((x) => x.nueva).length,
    actualizadas: plan.escribir.filter((x) => !x.nueva).length,
    resueltas: plan.resolver.length,
    avisar: plan.avisar,
    faltaMigracion: false,
  }
}

/** Anota que estas alertas ya se avisaron, con la gravedad con que se avisó: solo se vuelve a avisar si empeoran */
export async function marcarAvisadas(service: Servicio, clienteId: string, alertas: readonly AlertaFba[]): Promise<void> {
  const ahora = new Date().toISOString()
  const porSeveridad = new Map<Severidad, string[]>()
  for (const a of alertas) porSeveridad.set(a.severidad, [...(porSeveridad.get(a.severidad) ?? []), a.clave])
  for (const [severidad, claves] of porSeveridad) {
    for (let i = 0; i < claves.length; i += TROZO) {
      const { error } = await service
        .from('fba_alertas')
        .update({ severidad_avisada: severidad, avisada_at: ahora })
        .eq('client_id', clienteId)
        .in('clave', claves.slice(i, i + TROZO))
      if (error) throw error
    }
  }
}

export async function anotarEstado(service: Servicio, clienteId: string, estado: { error: string | null; abiertas: number }): Promise<void> {
  const { error } = await service
    .from('fba_alertas_estado')
    .upsert({ client_id: clienteId, calculado_at: new Date().toISOString(), error: estado.error, abiertas: estado.abiertas }, { onConflict: 'client_id' })
  if (error && !faltaLaTabla(error)) throw error
}

/* ------------------------------------------------------------------ */
/* La campana                                                          */
/* ------------------------------------------------------------------ */

/** El id de la app Remesas en `user_app_permissions` (lib/config/apps.ts) */
const APP_REMESAS = 'remesas'

/**
 * Qué clientes ve cada persona de la agencia (`clientesPorUsuario`, con `reglaDeAcceso`, D27): se leen los perfiles de admins y
 * empleados, quién tiene la casilla `remesas` y los `fba_accesos`. La casilla que no se puede leer no da acceso (lo prudente).
 */
export async function agenciaConClientes(service: Servicio): Promise<Map<string, string[] | null>> {
  let perfiles: PerfilParaAvisos[] = []
  const conPuesto = await service.from('profiles').select('id, role, puesto').in('role', ['admin', 'employee'])
  if (conPuesto.error && conPuesto.error.code === '42703') {
    // Sin la columna `puesto` (migración vieja): solo el rol
    const soloRol = await service.from('profiles').select('id, role').in('role', ['admin', 'employee'])
    if (soloRol.error) throw soloRol.error
    perfiles = ((soloRol.data ?? []) as Array<{ id: string; role: string }>).map((p) => ({ id: p.id, role: p.role, puesto: null }))
  } else {
    if (conPuesto.error) throw conPuesto.error
    perfiles = (conPuesto.data ?? []) as PerfilParaAvisos[]
  }
  const [casillas, accesos] = await Promise.all([
    service.from('user_app_permissions').select('user_id').eq('app_id', APP_REMESAS).eq('can_access', true),
    service.from('fba_accesos').select('user_id, client_id, puede_editar'),
  ])
  if (accesos.error && !faltaLaTabla(accesos.error)) throw accesos.error
  const conCasilla = new Set(casillas.error ? [] : ((casillas.data ?? []) as Array<{ user_id: string }>).map((c) => c.user_id))
  return clientesPorUsuario(
    perfiles,
    conCasilla,
    ((accesos.data ?? []) as Array<{ user_id: string; client_id: string; puede_editar: boolean | null }>).map((a) => ({
      userId: a.user_id,
      clienteId: a.client_id,
      puedeEditar: a.puede_editar === true,
    }))
  )
}

/**
 * Quién recibe los avisos de un cliente: los admins, los empleados con la casilla `remesas` y quien tenga fila en `fba_accesos`
 * de ese cliente (D24 y D27). Nunca el cliente de fuera. Cambio: antes solo admins y `fba_accesos`.
 */
export async function destinatariosDe(service: Servicio, clienteId: string): Promise<string[]> {
  return destinatariosDelCliente(await agenciaConClientes(service), clienteId)
}

/** Cuántas alertas individuales como mucho antes de juntarlas en un solo aviso: la primera pasada de un cliente trae decenas */
export const MAX_AVISOS_SUELTOS = 3

const recortar = (t: string, max: number): string => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t)

export interface AvisoDeCampana {
  titulo: string
  mensaje: string
  clave: string
  datos: Record<string, unknown>
}

/** Los avisos de campana de una tanda de alertas de UN cliente: una por alerta, o un resumen si son muchas */
export function avisosDeUnCliente(clienteId: string, clienteNombre: string, alertas: readonly AlertaFba[], hoy: string): AvisoDeCampana[] {
  if (alertas.length === 0) return []
  if (alertas.length <= MAX_AVISOS_SUELTOS) {
    return alertas.map((a) => ({
      titulo: recortar(`${clienteNombre}: ${a.titulo}`, 100),
      mensaje: recortar(a.detalle, 260),
      clave: `fba:${clienteId}:${a.clave}:${a.severidad}:${hoy}`,
      datos: { clienteId, alerta: a.clave, tipo: a.tipo, severidad: a.severidad, sku: a.sku },
    }))
  }
  const criticas = alertas.filter((a) => a.severidad === 'critica').length
  const porFamilia = new Map<string, number>()
  for (const a of alertas) {
    const f = FAMILIA_DE_TIPO[a.tipo]
    porFamilia.set(f, (porFamilia.get(f) ?? 0) + 1)
  }
  const partes = [...porFamilia.entries()].map(([f, n]) => `${n} de ${f === 'reposicion' ? 'reposición' : f === 'envios' ? 'envíos' : f === 'cuadre' ? 'cuadre' : f === 'parado' ? 'stock parado' : 'ventas'}`)
  return [
    {
      titulo: recortar(`${clienteNombre}: ${alertas.length} alertas FBA graves`, 100),
      mensaje: recortar(`${criticas > 0 ? `${criticas} crítica${criticas === 1 ? '' : 's'}. ` : ''}${partes.join(', ')}. Ábrelas en Alertas FBA.`, 260),
      clave: `fba:${clienteId}:resumen:${hoy}`,
      datos: { clienteId, tipo: 'resumen', severidad: criticas > 0 ? 'critica' : 'alta' },
    },
  ]
}

/** Escribe avisos en la campana de cada destinatario. Devuelve si la base los rechazó por falta de la migración */
export async function escribirAvisosFba(service: Servicio, destinatarios: readonly string[], avisos: readonly AvisoDeCampana[], tipo: 'fba_alerta' | 'fba_resumen' = 'fba_alerta'): Promise<{ faltaMigracion: boolean }> {
  if (destinatarios.length === 0 || avisos.length === 0) return { faltaMigracion: false }
  const filas = destinatarios.flatMap((userId) =>
    avisos.map((a) => ({ user_id: userId, type: tipo, title: a.titulo, message: a.mensaje, clave: a.clave, datos: a.datos }))
  )
  for (let i = 0; i < filas.length; i += TROZO) {
    const { error } = await service.from('notifications').upsert(filas.slice(i, i + TROZO), { onConflict: 'user_id,clave', ignoreDuplicates: true })
    if (error) {
      // 23514: el tipo no está en la restricción; 42703/PGRST204: falta la columna clave; 42P10: falta su índice
      if (['23514', '42703', 'PGRST204', '42P10'].includes(error.code ?? '')) return { faltaMigracion: true }
      throw error
    }
  }
  return { faltaMigracion: false }
}

/* ------------------------------------------------------------------ */
/* Una pasada entera sobre un cliente                                  */
/* ------------------------------------------------------------------ */

export interface ResumenDePasada {
  cliente: string
  conectado: boolean
  nuevas: number
  resueltas: number
  abiertas: number
  avisadas: number
  error: string | null
  faltaMigracion: boolean
}

/**
 * Calcula, guarda y avisa por un cliente. Es lo que hacen la pasada diaria y el botón «Recalcular»: la misma ruta para las dos, para que lo
 * que se ve al pulsar sea exactamente lo que haría la pasada de la noche.
 */
export async function pasadaDeCliente(service: Servicio, cliente: { id: string; nombre: string }, hoy: string, opciones: { avisar?: boolean } = {}): Promise<ResumenDePasada> {
  const vacio: ResumenDePasada = { cliente: cliente.nombre, conectado: true, nuevas: 0, resueltas: 0, abiertas: 0, avisadas: 0, error: null, faltaMigracion: false }
  let calculo: ResultadoDeCalculo
  try {
    calculo = await calcularAlertasDeCliente(service, cliente.id, hoy)
  } catch (e) {
    const error = mensaje(e)
    await anotarEstado(service, cliente.id, { error, abiertas: 0 }).catch(() => undefined)
    return { ...vacio, error }
  }
  if (!calculo.conectado) {
    await anotarEstado(service, cliente.id, { error: calculo.error, abiertas: 0 }).catch(() => undefined)
    return { ...vacio, conectado: false, error: calculo.error }
  }

  const guardado = await guardarAlertas(service, cliente.id, calculo.alertas, hoy, calculo.completo)
  if (guardado.faltaMigracion) return { ...vacio, faltaMigracion: true, error: FALTA_LA_MIGRACION_267 }

  // A quién y de qué se avisa: nada si el cliente está en silencio; sin plazo configurado, tampoco de «reponer ya» (depende de un número inventado)
  let avisadas = 0
  if ((opciones.avisar ?? true) && calculo.config.avisar) {
    const merecen = guardado.avisar.filter((a) => calculo.config.plazoConfigurado || a.tipo !== 'reponer_ya')
    if (merecen.length > 0) {
      const destinatarios = await destinatariosDe(service, cliente.id)
      const r = await escribirAvisosFba(service, destinatarios, avisosDeUnCliente(cliente.id, cliente.nombre, merecen, hoy))
      // Solo se marcan como avisadas si la campana las ha recibido: si falta la migración, se vuelve a intentar la próxima vez
      if (!r.faltaMigracion) {
        await marcarAvisadas(service, cliente.id, merecen)
        avisadas = merecen.length
      }
    }
  }

  const { count } = await service.from('fba_alertas').select('id', { count: 'exact', head: true }).eq('client_id', cliente.id).eq('estado', 'abierta')
  const abiertas = count ?? 0
  await anotarEstado(service, cliente.id, { error: calculo.error, abiertas })
  return { ...vacio, nuevas: guardado.nuevas, resueltas: guardado.resueltas, abiertas, avisadas, error: calculo.error }
}

/* ------------------------------------------------------------------ */
/* El resumen del lunes                                                */
/* ------------------------------------------------------------------ */

/** ¿Es lunes ese día? ('YYYY-MM-DD') */
export const esLunes = (hoy: string): boolean => new Date(`${hoy}T12:00:00Z`).getUTCDay() === 1

/**
 * El resumen semanal en la campana de cada persona de la agencia: cuántas alertas graves tiene abiertas en SUS clientes. Una sola vez por
 * lunes y persona (la clave lleva la fecha). El detalle está en la pantalla «Alertas FBA → Resumen semanal», que se puede imprimir.
 */
export async function avisarResumenSemanal(service: Servicio, hoy: string): Promise<{ avisados: number; faltaMigracion: boolean }> {
  const { data, error } = await service.from('fba_alertas').select('client_id, severidad, tipo').eq('estado', 'abierta')
  if (error) {
    if (faltaLaTabla(error)) return { avisados: 0, faltaMigracion: true }
    throw error
  }
  const filas = (data ?? []) as Array<{ client_id: string; severidad: Severidad; tipo: string }>
  if (filas.length === 0) return { avisados: 0, faltaMigracion: false }

  // Los mismos que reciben la campana de cada cliente: admins, empleados con la casilla `remesas` y `fba_accesos` (D27)
  const porUsuario = await agenciaConClientes(service)

  let avisados = 0
  for (const [usuario, clientes] of Array.from(porUsuario.entries())) {
    const suyas = clientes === null ? filas : filas.filter((f) => clientes.includes(f.client_id))
    const criticas = suyas.filter((f) => f.severidad === 'critica').length
    const altas = suyas.filter((f) => f.severidad === 'alta').length
    if (criticas + altas === 0) continue
    const quienes = new Set(suyas.filter((f) => f.severidad === 'critica' || f.severidad === 'alta').map((f) => f.client_id)).size
    const r = await escribirAvisosFba(
      service,
      [usuario],
      [
        {
          titulo: 'Resumen FBA de la semana',
          mensaje: `${criticas} crítica${criticas === 1 ? '' : 's'} y ${altas} alta${altas === 1 ? '' : 's'} en ${quienes} cliente${quienes === 1 ? '' : 's'}. Ábrelo en Alertas FBA → Resumen semanal.`,
          clave: `fba-resumen:${hoy}`,
          datos: { tipo: 'resumen_semanal', criticas, altas },
        },
      ],
      'fba_resumen'
    )
    if (r.faltaMigracion) return { avisados, faltaMigracion: true }
    avisados += 1
  }
  return { avisados, faltaMigracion: false }
}
