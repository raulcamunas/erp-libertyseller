import { NextResponse } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sigueVivo } from './inbound-estados'
import { leerLibroDiario } from './libro-diario'
import { caminoEsDudoso, llegadaPrevistaDeCamino } from './llegadas'
import { medirTransporte, mercadoDeRemesa } from './medidas-cliente'
import { leerTodo } from './paginar'
import { stockEntreMercados } from './lectura-elegida'
import type { CalidadDatos, EnCamino, EstadoEnvioPropuesto, FilaStock, LineaPlan, Moneda, Prioridad, ResumenGlobal, ResumenPlan, SaludCliente } from './plan-tipos'
import { faltaLaTabla } from './planificacion'
import { reglaDeAcceso } from './regla-acceso'
import { compararSalud, saludCliente } from './salud'
import { esVencido } from './trabajo-plan'
import { lunesDe, sumarDias } from './ventas-fba'
import { desdeNecesarioDe, lecturaDeConexion, monedaDeMercado, type LecturaDeConexion } from './ventas-servidor'

/**
 * EL RESUMEN GLOBAL DE REMESAS (VISTA «HOY») — SOLO SERVIDOR, SOLO LECTURA.
 * =======================================================================
 * Spec remesas-pro §1.5 (boceto de Hoy), §9 y §11 D26, D32, D34 y D42. Responde a «¿qué hay que hacer hoy y qué se nos
 * escapa?» para todos los clientes que la sesión puede ver, sin calcular ningún plan: lee lo que ya dejó la pasada.
 *
 *   · Por cliente: la última pasada (`fba_plan_ultima`, SIN líneas) → `ResumenPlan` y `CalidadDatos`; su punto de salud
 *     con `saludCliente` (rojo, ámbar, gris o verde); el próximo envío propuesto y la chispa de ventas de 30 días.
 *   · KPI: envíos que salen esta semana, roturas en 14 días, € en juego POR MONEDA (nunca se suman € y $), envíos y
 *     unidades de camino, y pendientes vencidos o que vencen esta semana.
 *   · Salidas por semana: las unidades de los envíos propuestos activos, 8 semanas desde la actual.
 *   · De camino: las remesas `enviada` con el envío de Amazon vivo, con su llegada prevista y si es dudoso (D3).
 *
 * SIN LA MIGRACIÓN 316 (o un cliente sin pasada) se degrada a lo de siempre: el stock de los listings y las alertas de
 * reposición abiertas dan un `ResumenPlan` aproximado (roturas por la fecha de la alerta, € por su impacto), y la ruta
 * lo dice con `migracion316: false` y el aviso «Falta lanzar la migración 316…».
 *
 * MEMORIA: un `Map` del proceso con clave = los clientes permitidos ordenados, 3 minutos (D32). `?refrescar=1` la salta y
 * `invalidarResumen()` la vacía (lo llaman las escrituras: PATCH y convertir de envíos propuestos y POST del plan).
 * PROHIBIDO `unstable_cache`: Next 14.2 guarda sin caducar.
 */

type Servicio = ReturnType<typeof createServiceClient>

export const AVISO_FALTA_316 = 'Falta lanzar la migración 316: el plan se ve pero no se puede gestionar. Mientras, el resumen sale del stock y de las alertas.'
export const SEMANAS_DE_SALIDA = 8
export const VIDA_CACHE_RESUMEN_MS = 3 * 60_000
const CONCURRENCIA = 4
const TROZO = 150

/** Recepción de partida (§2.4) si el cliente no la tiene puesta */
const RECEPCION_PARTIDA = 7
/** Transporte de partida (§2.4) si no está puesto ni medido */
const TRANSPORTE_PARTIDA = 18

/** Las alertas que hablan de reposición (las que dan roturas y € en juego sin plan) */
export const ALERTAS_DE_REPOSICION = ['agotado', 'reponer_ya', 'rotura_proxima', 'reponer_pronto'] as const

const DECIDIENDO: readonly EstadoEnvioPropuesto[] = ['nuevo', 'hablado', 'esperando_cliente']
const ACTIVOS: readonly EstadoEnvioPropuesto[] = ['nuevo', 'hablado', 'esperando_cliente', 'en_preparacion']
const PRIORIDADES_DE_SALUD: readonly Prioridad[] = ['tarde', 'urgente', 'esta_semana']

/* ================================================================== */
/* Sesión (regla de acceso D27 con consulta propia)                    */
/* ================================================================== */

export interface SesionResumen {
  userId: string
  role: string
  actor: 'agencia' | 'cliente'
  esAdmin: boolean
  /** null = todos */
  clientesPermitidos: string[] | null
  editables: string[] | null
}

/**
 * Quién pide y qué clientes puede ver, con `reglaDeAcceso` (W1-J): rol, puesto, la casilla `remesas` de
 * `user_app_permissions` y sus `fba_accesos`. Devuelve la respuesta de error lista si no hay sesión o no ve a nadie.
 */
export async function sesionDeRemesas(): Promise<SesionResumen | NextResponse> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fail(401, 'Hay que iniciar sesión')

  const service = createServiceClient()
  const [perfil, casilla, accesos] = await Promise.all([
    service.from('profiles').select('role, puesto').eq('id', user.id).maybeSingle(),
    service.from('user_app_permissions').select('can_access').eq('user_id', user.id).eq('app_id', 'remesas').maybeSingle(),
    service.from('fba_accesos').select('client_id, puede_editar').eq('user_id', user.id),
  ])
  if (perfil.error) throw perfil.error
  if (accesos.error) throw accesos.error
  const p = perfil.data as { role: string | null; puesto: string | null } | null
  const role = p?.role ?? 'employee'

  const regla = reglaDeAcceso({
    role,
    puesto: p?.puesto ?? null,
    casillaRemesas: Boolean((casilla.data as { can_access?: boolean } | null)?.can_access),
    accesos: ((accesos.data ?? []) as Array<{ client_id: string; puede_editar: boolean | null }>).map((a) => ({
      clienteId: a.client_id,
      puedeEditar: a.puede_editar === true,
    })),
  })

  if (regla.clientesPermitidos !== null && regla.clientesPermitidos.length === 0) {
    return fail(
      403,
      regla.actor === 'cliente'
        ? 'Tu cuenta todavía no tiene acceso a ninguna cuenta de Amazon. Pídeselo a Liberty Seller'
        : 'Pide a un administrador que te dé acceso a Remesas'
    )
  }
  return { userId: user.id, role, actor: regla.actor, esAdmin: regla.esAdmin, clientesPermitidos: regla.clientesPermitidos, editables: regla.editables }
}

export function puedeVerCliente(sesion: Pick<SesionResumen, 'clientesPermitidos'>, clienteId: string): boolean {
  return sesion.clientesPermitidos === null || sesion.clientesPermitidos.includes(clienteId)
}

/* ================================================================== */
/* Piezas puras (se prueban sin base)                                  */
/* ================================================================== */

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta.slice(0, 10)}T00:00:00Z`) - Date.parse(`${desde.slice(0, 10)}T00:00:00Z`)) / 86_400_000)
}

/** El domingo de la semana de `hoy` (semana de lunes a domingo) */
export function domingoDe(hoy: string): string {
  return sumarDias(lunesDe(hoy), 6)
}

/** Totales por moneda, sin convertir, sin ceros y del mayor al menor */
export function totalesPorMoneda(pares: Array<{ moneda: Moneda | null | undefined; total: number | null | undefined }>): Array<{ moneda: Moneda; total: number }> {
  const m = new Map<string, number>()
  for (const p of pares) {
    const t = Number(p.total)
    if (!Number.isFinite(t) || t <= 0) continue
    const moneda = (p.moneda || 'EUR').toUpperCase()
    m.set(moneda, (m.get(moneda) ?? 0) + t)
  }
  return Array.from(m.entries())
    .map(([moneda, total]) => ({ moneda, total: Math.round(total) }))
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total || a.moneda.localeCompare(b.moneda))
}

export interface EnvioParaResumen {
  id: string
  clienteId: string
  estado: EstadoEnvioPropuesto
  prioridad: Prioridad
  salirAntesDe: string
  fechaLimite: string | null
  unidades: number
}

/**
 * Unidades por semana (lunes, 'YYYY-MM-DD') y por cliente (clave = id del cliente) de los envíos propuestos activos,
 * `n` semanas desde la actual. Lo que ya tenía que haber salido cuenta en la semana actual; lo de después de la
 * ventana no sale. Siempre `n` filas, aunque vayan a cero, para que el gráfico tenga el eje fijo.
 */
export function salidasPorSemana(envios: EnvioParaResumen[], hoy: string, n = SEMANAS_DE_SALIDA): ResumenGlobal['salidasPorSemana'] {
  const primera = lunesDe(hoy)
  const filas = Array.from({ length: n }, (_, i) => ({ semana: sumarDias(primera, 7 * i), porCliente: {} as Record<string, number> }))
  for (const e of envios) {
    if (!ACTIVOS.includes(e.estado) || !(e.unidades > 0)) continue
    const s = lunesDe(e.salirAntesDe) < primera ? primera : lunesDe(e.salirAntesDe)
    const i = Math.round(diasEntre(primera, s) / 7)
    if (i < 0 || i >= n) continue
    filas[i].porCliente[e.clienteId] = (filas[i].porCliente[e.clienteId] ?? 0) + e.unidades
  }
  return filas
}

/** KPI que salen de los envíos propuestos: los que salen esta semana y los pendientes vencidos o que vencen esta semana */
export function kpisDeEnvios(envios: EnvioParaResumen[], hoy: string): { salenEstaSemana: number; pendientesVencidos: number; pendientesEstaSemana: number } {
  const domingo = domingoDe(hoy)
  let salen = 0
  let vencidos = 0
  let estaSemana = 0
  for (const e of envios) {
    if (ACTIVOS.includes(e.estado) && e.salirAntesDe.slice(0, 10) <= domingo) salen++
    if (esVencido({ estado: e.estado, fechaLimite: e.fechaLimite }, hoy)) vencidos++
    else if (DECIDIENDO.includes(e.estado) && e.fechaLimite && e.fechaLimite.slice(0, 10) >= hoy && e.fechaLimite.slice(0, 10) <= domingo) estaSemana++
  }
  return { salenEstaSemana: salen, pendientesVencidos: vencidos, pendientesEstaSemana: estaSemana }
}

/** Recuento de referencias con propuesta por prioridad, de las líneas de los envíos que se están decidiendo */
export function prioridadesDeLineas(lineas: Array<Pick<LineaPlan, 'prioridad' | 'cantidad' | 'fuera'>>): Partial<Record<Prioridad, number>> {
  const r: Partial<Record<Prioridad, number>> = {}
  for (const l of lineas) {
    if (!l || l.fuera || !(l.cantidad > 0)) continue
    r[l.prioridad] = (r[l.prioridad] ?? 0) + 1
  }
  return r
}

export interface AlertaParaResumen {
  tipo: string
  impacto: number
  datos: Record<string, unknown>
}

/**
 * Un `ResumenPlan` APROXIMADO sin plan (sin la 316 o sin pasada): stock de los listings y alertas de reposición
 * abiertas. Roturas por los días hasta la rotura de la alerta (un agotado cuenta como hoy), € por su impacto.
 * No hay propuestas ni cobertura mediana: eso solo lo sabe el planificador.
 */
export function resumenDesdeAlertas(
  alertas: AlertaParaResumen[],
  stock: { referencias: number; vendibles: number; deCamino: number },
  hoy: string,
  moneda: Moneda
): ResumenPlan {
  let roturas14 = 0
  let roturas30 = 0
  let agotados = 0
  let euros = 0
  let primera: string | null = null
  for (const a of alertas) {
    if (!(ALERTAS_DE_REPOSICION as readonly string[]).includes(a.tipo)) continue
    const dias = a.tipo === 'agotado' ? 0 : Number(a.datos.diasHastaRotura)
    if (a.tipo === 'agotado') agotados++
    if (Number.isFinite(dias)) {
      if (dias <= 14) roturas14++
      if (dias <= 30) roturas30++
      const fecha = sumarDias(hoy, Math.max(0, Math.floor(dias)))
      if (primera === null || fecha < primera) primera = fecha
    }
    const imp = Number(a.impacto)
    if (Number.isFinite(imp) && imp > 0) euros += imp
  }
  return {
    referencias: stock.referencias,
    conPropuesta: 0,
    fuera: {},
    roturas14,
    roturas30,
    eurosEnRiesgo: Math.round(euros),
    moneda,
    unidadesPropuestas: 0,
    primeraRotura: primera,
    coberturaMediana: null,
    agotadosConVentas: agotados,
    vendibles: stock.vendibles,
    deCamino: stock.deCamino,
  }
}

/** La calidad de los datos sin pasada: de la lectura elegida del libro */
export function calidadDesdeLectura(
  lectura: LecturaDeConexion | null,
  hoy: string,
  extra: { mercadoRemesa: string | null; conexionesActivas: number }
): CalidadDatos {
  const leidoHasta = lectura?.leidoHasta ?? null
  const diasAtraso = leidoHasta ? Math.max(0, diasEntre(leidoHasta, hoy)) : null
  const libro: CalidadDatos['libro'] = !leidoHasta ? 'sin_leer' : lectura?.aviso ? 'corto' : 'ok'
  const avisos: string[] = []
  if (!leidoHasta) avisos.push('Las ventas no están leídas todavía: sin libro de Amazon no se puede planificar')
  else if (lectura?.aviso) avisos.push(lectura.aviso)
  if (lectura?.ultimoError) avisos.push(`La última lectura de Amazon falló: ${lectura.ultimoError}`)
  if (diasAtraso !== null && diasAtraso > 7) avisos.push(`No te fíes de las fechas: las ventas están leídas hasta hace ${diasAtraso} días`)
  else if (diasAtraso !== null && diasAtraso > 3) avisos.push(`Las ventas van ${diasAtraso} días atrasadas`)
  return {
    libro,
    leidoHasta,
    leidoDesde: lectura?.leidoDesde ?? null,
    diasAtraso,
    ultimoError: lectura?.ultimoError ?? null,
    mercado: lectura?.marketplaceId ?? null,
    mercadoRemesa: extra.mercadoRemesa,
    sinConexion: false,
    conexionesActivas: extra.conexionesActivas,
    plazoDePartida: false,
    sinPrecio: 0,
    provisional: diasAtraso !== null && diasAtraso > 7,
    refsFueraDeCatalogo: 0,
    pctMerma90: null,
    calculadoAt: null,
    horasDesdeCalculo: null,
    avisos,
  }
}

/** Llegada prevista de un envío de camino (D3): la de Amazon si ya llegó; si no, max(salida + transporte, hoy + recepción) */
export function llegadaPrevistaDe(r: { fechaEnvio: string | null; llegadaAt: string | null }, hoy: string, transporte: number, recepcion: number): string | null {
  if (r.llegadaAt) return r.llegadaAt.slice(0, 10)
  if (!r.fechaEnvio) return null
  const porTransporte = sumarDias(r.fechaEnvio.slice(0, 10), transporte)
  const minima = sumarDias(hoy, recepcion)
  return porTransporte > minima ? porTransporte : minima
}

/** El plazo con el que el Resumen dice «dudoso» y la llegada de un envío de camino de un cliente */
export interface PlazoDeCamino {
  transporte: number
  recepcion: number
  /** Transporte medido (envío → primer Receipt); null = sin medida */
  transporteMediano: number | null
}

/**
 * El plazo de camino de un cliente. Con pasada, el que el plan guardó (plazo y medidas de `plazo._pasada`): así el Resumen dice
 * lo mismo que el plan. Sin pasada, la regla de respaldo del plan: transporte manual > medido > de partida, recepción manual o
 * de partida. Puro.
 */
export function plazoDeCamino(
  pasada: { plazo: unknown } | null | undefined,
  manual: { transporte: number | null; recepcion: number | null } | undefined,
  medido: number | null,
): PlazoDeCamino {
  const p = pasada?.plazo && typeof pasada.plazo === 'object' ? (pasada.plazo as Record<string, unknown>) : null
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)
  if (p && num(p.transporte) !== null && num(p.recepcion) !== null) {
    const extra = p._pasada && typeof p._pasada === 'object' ? (p._pasada as { medidas?: { transporteMediano?: unknown } }) : null
    return { transporte: num(p.transporte)!, recepcion: num(p.recepcion)!, transporteMediano: num(extra?.medidas?.transporteMediano) }
  }
  return {
    transporte: manual?.transporte ?? medido ?? TRANSPORTE_PARTIDA,
    recepcion: manual?.recepcion ?? RECEPCION_PARTIDA,
    transporteMediano: medido,
  }
}

/** Llegada prevista y «dudoso» de un envío de camino: las funciones del plan (llegadas.ts), con el plazo de `plazoDeCamino`. Puro. */
export function caminoDeRemesa(
  r: { estadoAmazon: string | null; fechaEnvio: string | null; recibidas: number },
  hoy: string,
  plazo: PlazoDeCamino,
): { llegadaPrevista: string; dudoso: boolean } {
  const fechaEnvio = r.fechaEnvio ? String(r.fechaEnvio).slice(0, 10) : null
  return {
    llegadaPrevista: llegadaPrevistaDeCamino({ estadoAmazon: r.estadoAmazon, fechaEnvio }, hoy, plazo),
    dudoso: caminoEsDudoso({ fechaEnvio, recibidas: r.recibidas }, hoy, plazo.transporteMediano, plazo.transporte),
  }
}

/* ================================================================== */
/* Lecturas                                                            */
/* ================================================================== */

async function enTrozos<T>(ids: string[], leer: (trozo: string[]) => Promise<T[]>): Promise<T[]> {
  const salida: T[] = []
  for (let i = 0; i < ids.length; i += TROZO) salida.push(...(await leer(ids.slice(i, i + TROZO))))
  return salida
}

/** Ejecuta `tarea` sobre cada elemento con como mucho `n` a la vez, en el orden de entrada */
async function enParalelo<T, R>(items: T[], n: number, tarea: (x: T) => Promise<R>): Promise<R[]> {
  const salida: R[] = new Array(items.length)
  let siguiente = 0
  const trabajador = async () => {
    while (siguiente < items.length) {
      const i = siguiente++
      salida[i] = await tarea(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, trabajador))
  return salida
}

interface FilaPlanUltima {
  id?: string
  client_id: string
  connection_id: string | null
  calculado_at: string
  estado: string
  resumen: Partial<ResumenPlan> | null
  calidad: Partial<CalidadDatos> | null
}

interface FilaRemesa {
  id: string
  client_id: string
  nombre: string | null
  estado: string
  estado_amazon: string | null
  fecha_envio: string | null
  llegada_at: string | null
  referencia_envio: string | null
  marketplace_id: string | null
}

/** Un `EnCamino` con el cliente al lado (la pantalla agrupa por cliente; el tipo admite el campo de más) */
export interface EnCaminoDeCliente extends EnCamino {
  clienteId: string
  clienteNombre: string
}

function resumenValido(r: Partial<ResumenPlan> | null | undefined): r is ResumenPlan {
  return !!r && typeof r.referencias === 'number' && typeof r.roturas14 === 'number'
}

/**
 * Suma de stock de los listings (lo que se ve en Amazon), con la regla de §0.2 y D11 (`stockEntreMercados`): la fila del
 * mercado de la lectura y, si a una referencia le falta ahí, la MAYOR de otro mercado de la conexión con fila reciente
 * (el stock paneuropeo se repite en cada país: nunca se suma). El entrante solo si la 271 está lanzada.
 */
async function stockDeListings(service: Servicio, conexion: string, mercado: string, hoy: string): Promise<{ referencias: number; vendibles: number; deCamino: number | null }> {
  type Fila = { sku: string; marketplace_id: string; updated_at: string | null; fba_fulfillable_quantity: number | null; fba_inbound_quantity?: number | null }
  const leer = (columnas: string) =>
    leerTodo<Fila>((a, b) =>
      service
        .from('amazon_listings')
        .select(columnas)
        .eq('connection_id', conexion)
        .or('fba_quantity.gt.0,fba_fulfillable_quantity.gt.0')
        .order('sku', { ascending: true })
        .order('marketplace_id', { ascending: true })
        .range(a, b)
    )
  let filas: Fila[]
  let conEntrante = true
  try {
    filas = await leer('sku, marketplace_id, updated_at, fba_fulfillable_quantity, fba_inbound_quantity')
  } catch (e) {
    if ((e as { code?: string })?.code !== '42703') throw e
    conEntrante = false
    filas = await leer('sku, marketplace_id, updated_at, fba_fulfillable_quantity')
  }
  const elegidas = stockEntreMercados(
    filas.map(
      (f): FilaStock => ({
        marketplaceId: f.marketplace_id,
        sku: f.sku,
        vendibles: Math.max(0, Number(f.fba_fulfillable_quantity) || 0),
        entrante: Math.max(0, Number(f.fba_inbound_quantity) || 0),
        reservadas: null,
        noApto: null,
        precio: null,
        moneda: null,
        listingStatus: null,
        updatedAt: f.updated_at,
      })
    ),
    mercado,
    hoy
  )
  const lista = Array.from(elegidas.values())
  return {
    referencias: lista.length,
    vendibles: lista.reduce((s, f) => s + f.vendibles, 0),
    deCamino: conEntrante ? lista.reduce((s, f) => s + f.entrante, 0) : null,
  }
}

/** Ventas por día (Shipments) de los 30 días que acaban en `hasta` */
async function chispaDe(service: Servicio, conexion: string, mercado: string, hasta: string): Promise<number[]> {
  const desde = sumarDias(hasta, -29)
  const libro = await leerLibroDiario(service, conexion, mercado, desde, hasta)
  const porDia = new Map<string, number>()
  for (const m of libro) if (m.tipo === 'Shipments') porDia.set(m.fecha, (porDia.get(m.fecha) ?? 0) + Math.abs(m.cantidad))
  return Array.from({ length: 30 }, (_, i) => porDia.get(sumarDias(desde, i)) ?? 0)
}

/** ¿Hay algún movimiento del libro en los últimos 90 días? (salud gris si no) */
async function hayMovimientos90(service: Servicio, conexion: string, mercado: string, hoy: string): Promise<number> {
  const { data, error } = await service
    .from('fba_movimientos')
    .select('fecha')
    .eq('connection_id', conexion)
    .eq('marketplace_id', mercado)
    .gte('fecha', sumarDias(hoy, -90))
    .limit(1)
  if (error) throw error
  return (data ?? []).length
}

/* ================================================================== */
/* El cálculo                                                          */
/* ================================================================== */

export type RespuestaResumen = ResumenGlobal & { aviso: string | null }

export async function calcularResumenGlobal(service: Servicio, permitidos: string[] | null, hoy: string): Promise<RespuestaResumen> {
  const ahoraIso = new Date().toISOString()

  /* ---------- clientes con conexión activa que se pueden ver ---------- */
  const { data: conexiones, error: eCon } = await service
    .from('amazon_connections')
    .select('id, client_id, region, created_at')
    .eq('is_active', true)
    .not('client_id', 'is', null)
    .order('created_at', { ascending: true })
  if (eCon) throw eCon
  const permitidosSet = permitidos ? new Set(permitidos) : null
  const conexionDe = new Map<string, { id: string; region: string | null }>()
  const nConexiones = new Map<string, number>()
  for (const c of (conexiones ?? []) as Array<{ id: string; client_id: string; region: string | null }>) {
    if (permitidosSet && !permitidosSet.has(c.client_id)) continue
    nConexiones.set(c.client_id, (nConexiones.get(c.client_id) ?? 0) + 1)
    if (!conexionDe.has(c.client_id)) conexionDe.set(c.client_id, { id: c.id, region: c.region })
  }
  const ids = Array.from(conexionDe.keys())
  const vacio: RespuestaResumen = {
    calculadoAt: ahoraIso,
    migracion316: true,
    kpis: { salenEstaSemana: 0, roturas14: 0, eurosEnJuego: [], deCaminoEnvios: 0, deCaminoUnidades: 0, pendientesVencidos: 0, pendientesEstaSemana: 0 },
    clientes: [],
    salidasPorSemana: salidasPorSemana([], hoy),
    enCamino: [],
    aviso: null,
  }
  if (ids.length === 0) return vacio

  const nombres = new Map<string, string>()
  for (const f of await enTrozos(ids, async (t) => {
    const { data, error } = await service.from('amazon_clients').select('id, name').in('id', t)
    if (error) throw error
    return (data ?? []) as Array<{ id: string; name: string }>
  }))
    nombres.set(f.id, f.name)

  /* ---------- la última pasada de cada cliente (316) ---------- */
  let migracion316 = true
  const planes = new Map<string, FilaPlanUltima>()
  {
    const { data, error } = await service
      .from('fba_plan_ultima')
      .select('id, client_id, connection_id, calculado_at, estado, resumen, calidad')
      .in('client_id', ids)
    if (error) {
      if (!faltaLaTabla(error)) throw error
      migracion316 = false
    } else {
      for (const f of (data ?? []) as FilaPlanUltima[]) planes.set(f.client_id, f)
    }
  }

  /* ---------- planificador activo (316) ---------- */
  const activo = new Map<string, boolean>()
  if (migracion316) {
    const { data, error } = await service.from('fba_reposicion_config').select('client_id, planificador_activo').in('client_id', ids)
    if (error && !faltaLaTabla(error)) throw error
    for (const f of (data ?? []) as Array<{ client_id: string; planificador_activo: boolean }>) activo.set(f.client_id, f.planificador_activo !== false)
  }

  /* ---------- envíos propuestos activos (316) ---------- */
  let envios: EnvioParaResumen[] = []
  const prioridadesDe = new Map<string, Partial<Record<Prioridad, number>>>()
  if (migracion316) {
    const filas = await leerTodo<{
      id: string
      client_id: string
      estado: EstadoEnvioPropuesto
      prioridad: Prioridad
      salir_antes_de: string
      fecha_limite: string | null
      unidades: number | null
    }>((a, b) =>
      service
        .from('fba_envios_propuestos')
        .select('id, client_id, estado, prioridad, salir_antes_de, fecha_limite, unidades')
        .in('client_id', ids)
        .in('estado', ACTIVOS as string[])
        .order('id', { ascending: true })
        .range(a, b)
    ).catch((e) => {
      if (faltaLaTabla(e as { code?: string })) {
        migracion316 = false
        return []
      }
      throw e
    })
    envios = filas.map((f) => ({
      id: f.id,
      clienteId: f.client_id,
      estado: f.estado,
      prioridad: f.prioridad,
      salirAntesDe: String(f.salir_antes_de).slice(0, 10),
      fechaLimite: f.fecha_limite ? String(f.fecha_limite).slice(0, 10) : null,
      unidades: Number(f.unidades) || 0,
    }))

    // Las líneas solo de los que pueden poner el punto rojo o ámbar (tarde, urgente, esta semana): el resto no cambia la salud
    const calientes = envios.filter((e) => DECIDIENDO.includes(e.estado) && PRIORIDADES_DE_SALUD.includes(e.prioridad)).map((e) => e.id)
    const conLineas = await enTrozos(calientes, async (t) => {
      const { data, error } = await service.from('fba_envios_propuestos').select('client_id, lineas').in('id', t)
      if (error) throw error
      return (data ?? []) as Array<{ client_id: string; lineas: LineaPlan[] | null }>
    })
    for (const f of conLineas) {
      const actual = prioridadesDe.get(f.client_id) ?? {}
      const nuevas = prioridadesDeLineas(Array.isArray(f.lineas) ? f.lineas : [])
      for (const [p, n] of Object.entries(nuevas) as Array<[Prioridad, number]>) actual[p] = (actual[p] ?? 0) + n
      prioridadesDe.set(f.client_id, actual)
    }
  }

  /* ---------- remesas enviadas y cerradas (primer envío, mercado de remesa, transporte, de camino) ---------- */
  const remesas = await leerTodo<FilaRemesa>((a, b) =>
    service
      .from('fba_remesas')
      .select('id, client_id, nombre, estado, estado_amazon, fecha_envio, llegada_at, referencia_envio, marketplace_id')
      .in('client_id', ids)
      .in('estado', ['enviada', 'cerrada'])
      .order('id', { ascending: true })
      .range(a, b)
  )
  const remesasDe = new Map<string, FilaRemesa[]>()
  for (const r of remesas) {
    const l = remesasDe.get(r.client_id) ?? []
    l.push(r)
    remesasDe.set(r.client_id, l)
  }

  // Plazos puestos a mano (291): transporte y recepción para la llegada prevista
  const plazoManual = new Map<string, { transporte: number | null; recepcion: number | null }>()
  {
    const { data, error } = await service.from('fba_alertas_config').select('*').in('client_id', ids)
    if (error && !faltaLaTabla(error)) throw error
    for (const f of (data ?? []) as Array<Record<string, unknown>>) {
      const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)
      plazoManual.set(String(f.client_id), { transporte: n(f.dias_transporte), recepcion: n(f.dias_recepcion) })
    }
  }

  const vivas = remesas.filter((r) => r.estado === 'enviada' && sigueVivo(r.estado_amazon))
  const lineas = await enTrozos(
    vivas.map((r) => r.id),
    (t) =>
      leerTodo<{ remesa_id: string; unidades: number | null; unidades_recibidas: number | null }>((a, b) =>
        service.from('fba_remesa_lineas').select('remesa_id, unidades, unidades_recibidas').in('remesa_id', t).order('id', { ascending: true }).range(a, b)
      )
  )
  const sumaDe = new Map<string, { unidades: number; recibidas: number }>()
  for (const l of lineas) {
    const s = sumaDe.get(l.remesa_id) ?? { unidades: 0, recibidas: 0 }
    s.unidades += Math.max(0, Number(l.unidades) || 0)
    s.recibidas += Math.max(0, Number(l.unidades_recibidas) || 0)
    sumaDe.set(l.remesa_id, s)
  }

  const transporteMedidoDe = new Map<string, number | null>()
  for (const id of ids) {
    transporteMedidoDe.set(id, medirTransporte((remesasDe.get(id) ?? []).map((r) => ({ fechaEnvio: r.fecha_envio, primerReceipt: r.llegada_at }))))
  }

  // El plazo que guardó la pasada (plazo y transporte medido con el primer Receipt) de los clientes con envíos de camino: el
  // Resumen dice «dudoso» y la llegada con lo mismo que el plan. Sin pasada, la regla de respaldo (manual o de partida)
  const pasadaDe = new Map<string, { plazo: unknown }>()
  if (migracion316) {
    const conCamino = [...new Set(vivas.map((r) => r.client_id))]
    const idsPasada = conCamino.map((c) => planes.get(c)?.id).filter((x): x is string => !!x)
    const filas = await enTrozos(idsPasada, async (t) => {
      const { data, error } = await service.from('fba_plan_pasadas').select('client_id, plazo').in('id', t)
      if (error) {
        if (faltaLaTabla(error)) return []
        throw error
      }
      return (data ?? []) as Array<{ client_id: string; plazo: unknown }>
    })
    for (const f of filas) pasadaDe.set(f.client_id, f)
  }

  const enCamino: EnCaminoDeCliente[] = vivas
    .map((r) => {
      const s = sumaDe.get(r.id) ?? { unidades: 0, recibidas: 0 }
      const plazo = plazoDeCamino(pasadaDe.get(r.client_id), plazoManual.get(r.client_id), transporteMedidoDe.get(r.client_id) ?? null)
      const camino = caminoDeRemesa({ estadoAmazon: r.estado_amazon, fechaEnvio: r.fecha_envio, recibidas: s.recibidas }, hoy, plazo)
      return {
        remesaId: r.id,
        nombre: r.nombre ?? 'Envío sin nombre',
        referenciaEnvio: r.referencia_envio,
        estadoAmazon: r.estado_amazon,
        fechaEnvio: r.fecha_envio ? String(r.fecha_envio).slice(0, 10) : null,
        llegadaPrevista: camino.llegadaPrevista,
        unidades: s.unidades,
        recibidas: s.recibidas,
        dudoso: camino.dudoso,
        clienteId: r.client_id,
        clienteNombre: nombres.get(r.client_id) ?? 'Cliente',
      }
    })
    .filter((e) => e.unidades > e.recibidas || e.unidades === 0)
    .sort((a, b) => (a.llegadaPrevista ?? '9999').localeCompare(b.llegadaPrevista ?? '9999') || a.nombre.localeCompare(b.nombre))

  /* ---------- alertas de reposición abiertas (solo para los clientes sin pasada) ---------- */
  const sinPlan = ids.filter((id) => !resumenValido(planes.get(id)?.resumen))
  const alertasDe = new Map<string, AlertaParaResumen[]>()
  if (sinPlan.length > 0) {
    const filas = await enTrozos(sinPlan, async (t) =>
      leerTodo<{ client_id: string; tipo: string; impacto: number | string | null; datos: Record<string, unknown> | null }>((a, b) =>
        service
          .from('fba_alertas')
          .select('client_id, tipo, impacto, datos')
          .in('client_id', t)
          .eq('estado', 'abierta')
          .in('tipo', ALERTAS_DE_REPOSICION as unknown as string[])
          .order('id', { ascending: true })
          .range(a, b)
      ).catch((e) => {
        if (faltaLaTabla(e as { code?: string })) return []
        throw e
      })
    )
    for (const f of filas) {
      const l = alertasDe.get(f.client_id) ?? []
      l.push({ tipo: f.tipo, impacto: Number(f.impacto) || 0, datos: f.datos ?? {} })
      alertasDe.set(f.client_id, l)
    }
  }

  /* ---------- por cliente ---------- */
  const proximoDe = new Map<string, EnvioParaResumen>()
  for (const e of envios) {
    if (!DECIDIENDO.includes(e.estado)) continue
    const x = proximoDe.get(e.clienteId)
    if (!x || e.salirAntesDe < x.salirAntesDe) proximoDe.set(e.clienteId, e)
  }

  const clientes = await enParalelo(ids, CONCURRENCIA, async (clienteId) => {
    const conexion = conexionDe.get(clienteId)!
    const propias = remesasDe.get(clienteId) ?? []
    const ultimaEnviada = [...propias].sort((a, b) => (b.fecha_envio ?? '').localeCompare(a.fecha_envio ?? ''))[0] ?? null
    const region = conexion.region === 'eu' || conexion.region === 'na' || conexion.region === 'fe' ? conexion.region : null
    const mercadoRemesa = mercadoDeRemesa(ultimaEnviada?.marketplace_id ?? null, region)
    const primerEnvio = propias.filter((r) => r.fecha_envio).map((r) => String(r.fecha_envio).slice(0, 10)).sort()[0] ?? null

    const plan = planes.get(clienteId)
    let resumen: ResumenPlan | null = null
    let calidad: CalidadDatos | null = null
    let mercado: string | null = null
    let leidoHasta: string | null = null

    if (plan && resumenValido(plan.resumen) && plan.calidad) {
      resumen = plan.resumen
      const horas = Math.max(0, Math.round((Date.parse(ahoraIso) - Date.parse(plan.calculado_at)) / 3_600_000))
      calidad = { ...(plan.calidad as CalidadDatos), calculadoAt: plan.calculado_at, horasDesdeCalculo: horas }
      if (!Array.isArray(calidad.avisos)) calidad.avisos = []
      if (horas > 36) calidad.avisos = [...calidad.avisos, `El plan es de hace ${Math.round(horas / 24)} días: recalcúlalo`]
      mercado = calidad.mercado ?? null
      leidoHasta = calidad.leidoHasta ?? null
    }

    let lectura: LecturaDeConexion | null = null
    if (!resumen || !mercado) {
      lectura = await lecturaDeConexion(service, conexion.id, desdeNecesarioDe(primerEnvio, hoy))
      mercado = mercado ?? lectura?.marketplaceId ?? null
      leidoHasta = leidoHasta ?? lectura?.leidoHasta ?? null
    }
    const moneda = resumen?.moneda ?? monedaDeMercado(mercado)

    if (!resumen) {
      calidad = calidadDesdeLectura(lectura, hoy, { mercadoRemesa, conexionesActivas: nConexiones.get(clienteId) ?? 1 })
      const stock = mercado ? await stockDeListings(service, conexion.id, mercado, hoy) : { referencias: 0, vendibles: 0, deCamino: null }
      const caminoErp = enCamino.filter((e) => e.clienteId === clienteId && !e.dudoso).reduce((s, e) => s + Math.max(0, e.unidades - e.recibidas), 0)
      resumen = resumenDesdeAlertas(
        alertasDe.get(clienteId) ?? [],
        { referencias: stock.referencias, vendibles: stock.vendibles, deCamino: Math.max(stock.deCamino ?? 0, caminoErp) },
        hoy,
        moneda
      )
    }

    const [movimientos90, chispa30] = mercado
      ? await Promise.all([
          hayMovimientos90(service, conexion.id, mercado, hoy),
          leidoHasta ? chispaDe(service, conexion.id, mercado, leidoHasta < hoy ? leidoHasta : hoy) : Promise.resolve(new Array<number>(30).fill(0)),
        ])
      : [0, new Array<number>(30).fill(0)]

    const conPlan = !!plan && resumenValido(plan.resumen)
    const salud: SaludCliente = saludCliente(resumen, calidad, {
      activo: activo.get(clienteId) ?? true,
      movimientos90,
      primerEnvio: propias.length === 0,
      // La regla exacta de §6.2 solo cuando hay plan; sin él, la aproximación por roturas de las alertas
      prioridades: conPlan && migracion316 ? prioridadesDe.get(clienteId) ?? {} : undefined,
    })

    const prox = proximoDe.get(clienteId)
    return {
      clienteId,
      nombre: nombres.get(clienteId) ?? 'Cliente',
      salud,
      resumen,
      calidad,
      proximoEnvio: prox ? { id: prox.id, salirAntesDe: prox.salirAntesDe, unidades: prox.unidades } : null,
      chispa30,
    }
  })

  // Lo que arde primero (rojo, ámbar, gris, verde); dentro, por € en juego y por nombre
  clientes.sort(
    (a, b) => compararSalud(a.salud, b.salud) || (b.resumen?.eurosEnRiesgo ?? 0) - (a.resumen?.eurosEnRiesgo ?? 0) || a.nombre.localeCompare(b.nombre, 'es')
  )

  const kEnvios = kpisDeEnvios(envios, hoy)
  return {
    calculadoAt: ahoraIso,
    migracion316,
    kpis: {
      salenEstaSemana: kEnvios.salenEstaSemana,
      roturas14: clientes.reduce((s, c) => s + (c.resumen?.roturas14 ?? 0), 0),
      eurosEnJuego: totalesPorMoneda(clientes.map((c) => ({ moneda: c.resumen?.moneda, total: c.resumen?.eurosEnRiesgo }))),
      deCaminoEnvios: enCamino.length,
      deCaminoUnidades: enCamino.reduce((s, e) => s + Math.max(0, e.unidades - e.recibidas), 0),
      pendientesVencidos: kEnvios.pendientesVencidos,
      pendientesEstaSemana: kEnvios.pendientesEstaSemana,
    },
    clientes,
    salidasPorSemana: salidasPorSemana(envios, hoy),
    enCamino,
    aviso: migracion316 ? null : AVISO_FALTA_316,
  }
}

/* ================================================================== */
/* Memoria de 3 minutos (D32)                                          */
/* ================================================================== */

const cacheResumen = new Map<string, { at: number; valor: RespuestaResumen }>()
const resumenEnCurso = new Map<string, Promise<RespuestaResumen>>()

/** Vacía la memoria del resumen. Lo llaman las escrituras (PATCH y convertir de envíos propuestos, POST del plan) */
export function invalidarResumen(): void {
  cacheResumen.clear()
}

/** La clave de la memoria: los clientes permitidos ordenados («*» = todos) y el día */
export function claveDeResumen(permitidos: string[] | null, hoy: string): string {
  return `${hoy}|${permitidos === null ? '*' : [...permitidos].sort().join(',')}`
}

export async function resumenGlobal(permitidos: string[] | null, hoy: string, opciones: { refrescar?: boolean } = {}): Promise<RespuestaResumen> {
  const clave = claveDeResumen(permitidos, hoy)
  const guardado = cacheResumen.get(clave)
  if (!opciones.refrescar && guardado && Date.now() - guardado.at < VIDA_CACHE_RESUMEN_MS) return guardado.valor
  const pendiente = resumenEnCurso.get(clave)
  if (pendiente) return pendiente

  const promesa = calcularResumenGlobal(createServiceClient(), permitidos, hoy)
    .then((valor) => {
      cacheResumen.set(clave, { at: Date.now(), valor })
      for (const [k, v] of Array.from(cacheResumen.entries())) if (Date.now() - v.at > VIDA_CACHE_RESUMEN_MS) cacheResumen.delete(k)
      return valor
    })
    .finally(() => resumenEnCurso.delete(clave))
  resumenEnCurso.set(clave, promesa)
  return promesa
}
