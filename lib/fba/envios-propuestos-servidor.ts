import { NextResponse } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { puedeEditar, requireFbaAccess, type SesionFba } from './acceso'
import { construirIndice } from './catalogo/indice'
import { listarCatalogo } from './catalogo/servidor'
import { esClienteConCatalogo } from './catalogo/tipos'
import { AJUSTES_DE_PARTIDA, ajustesDesdeFila, type FilaReposicionConfig } from './ajustes-reposicion'
import type { AnalisisIa } from './analisis-ia'
import { crearRemesa, ErrorDeRemesa, type LineaRemesaNueva } from './crear-remesa'
import { fechaCorta, semanaIso } from './envios-propuestos'
import { registrarEnHistorial } from './historial'
import { validarAjustesIa, type RecalcularAjuste } from './ia-plan'
import { mercadoDeRemesa } from './medidas-cliente'
import { configAlertasDesdeFila } from './plan-cliente'
import { leerTodo } from './paginar'
import { faltaLaTabla } from './planificacion'
import { planificarSku, plazoDelCliente, redondearACaja, sumarDias } from './planificador'
import { invalidarResumen } from './resumen-servidor'
import { invalidarVentas } from './ventas-servidor'
import {
  avisoDeFechaLimite,
  efectoDeRemesa,
  esVencido,
  pendientes,
  puedeCambiar,
  type ClienteParaPendientes,
  type RemesaParaPendientes,
} from './trabajo-plan'
import type { EstadoRemesa } from './flujo'
import type {
  AjusteIa,
  AjustesReposicion,
  CalidadDatos,
  CambiosDesdeAyer,
  Confianza,
  EntradaSku,
  EnvioPropuestoGuardado,
  EstadoEnvioPropuesto,
  LineaPlan,
  MedidasCliente,
  MotivoDescarte,
  PlazoEtapas,
  Prioridad,
  RevisionIa,
  TareaPendiente,
} from './plan-tipos'
import type { createServiceClient } from '@/lib/supabase/service'
import { huellaLineas } from './envios-propuestos'

/**
 * LOS ENVÍOS PROPUESTOS EN EL SERVIDOR: LEER, CAMBIAR, CONVERTIR EN REMESA Y SEGUIR A LA REMESA.
 * ==============================================================================================
 * SOLO SERVIDOR (spec remesas-pro §4, §9 y §11 D19, D20, D23, D26). Las decisiones son puras y están en
 * `trabajo-plan.ts` (qué transición vale, qué le pasa al envío cuando su remesa cambia, qué hay pendiente) y
 * en `ia-plan.ts` (si un ajuste vale). Aquí se juntan los datos, se escribe y se deja rastro.
 *
 * ============ SIN LA MIGRACIÓN 316 ============
 *
 * El código llega antes que el SQL. Sin `fba_envios_propuestos`, leer devuelve `migracion316: false` y una
 * lista vacía (la pantalla dice «Falta lanzar la migración 316»); los Pendientes que no dependen de ella
 * (remesas paradas, envíos cerrados con faltantes o dudosos) se calculan igual. Escribir contesta 409 con
 * el mismo aviso. La ruta de estado y el borrado de remesas siguen funcionando: el efecto sobre el envío
 * propuesto se ignora.
 *
 * ============ SEGURIDAD ============
 *
 * Todo /api/fba/envios-propuestos/** es de la agencia: el rol `cliente` recibe 403 (D26). Y como las rutas
 * usan la clave de servicio, cada lectura filtra por los clientes permitidos de la sesión.
 *
 * ============ CACHÉS ============
 *
 * Tras cada escritura (PATCH, convertir, la remesa que cambia o se borra) se vacían las cachés en memoria del
 * resumen y de las ventas (S5) — D32. La del plan (S1) no existía al escribir esto: queda anotada en
 * `invalidarCaches()`, que es el único sitio que hay que tocar al integrar.
 */

type Servicio = ReturnType<typeof createServiceClient>

export const AVISO_316 = 'Falta lanzar la migración 316: el plan se ve pero no se puede gestionar'

const ESTADOS_DECIDIENDO: readonly EstadoEnvioPropuesto[] = ['nuevo', 'hablado', 'esperando_cliente']
const ESTADOS_REMESA_VIVOS: readonly EstadoRemesa[] = ['borrador', 'aprobada', 'encajando', 'lista', 'enviada']
const MOTIVOS_DESCARTE: readonly MotivoDescarte[] = ['cliente_sin_stock', 'cliente_no_quiere', 'ya_enviado_aparte', 'datos_erroneos', 'producto_cambia', 'descatalogada', 'otro']
const PRIORIDADES: readonly Prioridad[] = ['tarde', 'urgente', 'esta_semana', 'proximas_2', 'este_mes', 'mas_adelante']
const CONFIANZAS: readonly Confianza[] = ['alta', 'media', 'baja', 'sin_datos']
const TODOS_LOS_ESTADOS: readonly EstadoEnvioPropuesto[] = ['nuevo', 'hablado', 'esperando_cliente', 'en_preparacion', 'enviado', 'descartado', 'caducado']

/** Error con estado HTTP que las rutas devuelven tal cual */
export class ErrorDeEnvio extends Error {
  constructor(message: string, public estado: number, public datos?: Record<string, unknown>) {
    super(message)
    this.name = 'ErrorDeEnvio'
  }
}

/* =============================================================================================
 * Cachés (D32)
 * ============================================================================================= */

/**
 * Vacía las cachés en memoria que dependen de los envíos propuestos y de las remesas.
 * - S5: `invalidarResumen()` (resumen global, 3 min) e `invalidarVentas(cliente)`.
 * - PENDIENTE AL INTEGRAR: S1 (`lib/fba/plan-datos.ts`) no existía cuando se escribió esto. Si exporta un
 *   `invalidar…` del plan, se importa y se llama aquí; es el único sitio que hay que tocar.
 */
export function invalidarCaches(clienteId?: string): void {
  try {
    invalidarResumen()
    invalidarVentas(clienteId)
  } catch {
    // Vaciar una caché nunca tumba una escritura que ya se ha guardado
  }
}

/* =============================================================================================
 * De la fila a EnvioPropuestoGuardado
 * ============================================================================================= */

/** Las columnas de fba_envios_propuestos que se leen (316) */
export const COLUMNAS_ENVIO =
  'id, client_id, connection_id, clave, estado, prioridad, confianza, provisional, moneda, salir_antes_de, decidir_antes_de, ' +
  'a_la_venta, fecha_limite, responsable_id, unidades, cajas_estimadas, euros_en_riesgo, porque, lineas, lineas_aceptadas, ' +
  'cambios_desde_ayer, plan_ya_no_lo_pide, ajustes_aplicados, ia, motivo_descarte, nota, remesa_id, esperando_desde, pasada_id, ' +
  'version, creado_at, actualizado_at, estado_cambiado_at'

export interface FilaEnvioPropuesto {
  id: string
  client_id: string
  connection_id: string | null
  clave: string
  estado: string
  prioridad: string
  confianza: string | null
  provisional: boolean | null
  moneda: string | null
  salir_antes_de: string
  decidir_antes_de: string
  a_la_venta: string | null
  fecha_limite: string
  responsable_id: string | null
  unidades: number | null
  cajas_estimadas: number | null
  euros_en_riesgo: number | string | null
  porque: unknown
  lineas: unknown
  lineas_aceptadas: unknown
  cambios_desde_ayer: unknown
  plan_ya_no_lo_pide: boolean | null
  ajustes_aplicados: unknown
  ia: unknown
  motivo_descarte: string | null
  nota: string | null
  remesa_id: string | null
  esperando_desde: string | null
  pasada_id: string | null
  version: number | null
  creado_at: string
  actualizado_at: string
  estado_cambiado_at: string
}

const lista = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
const objetoONulo = <T>(v: unknown): T | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as T) : null)
const numeroONulo = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/** Puro: la fila de la base en camelCase, con `vencido` calculado para `hoy` */
export function filaAGuardado(
  f: FilaEnvioPropuesto,
  nombres: { clientes: Map<string, string>; personas: Map<string, string> },
  hoy: string,
): EnvioPropuestoGuardado {
  const estado = (TODOS_LOS_ESTADOS.includes(f.estado as EstadoEnvioPropuesto) ? f.estado : 'nuevo') as EstadoEnvioPropuesto
  const prioridad = (PRIORIDADES.includes(f.prioridad as Prioridad) ? f.prioridad : 'este_mes') as Prioridad
  const confianza = (CONFIANZAS.includes(f.confianza as Confianza) ? f.confianza : 'media') as Confianza
  const fechaLimite = (f.fecha_limite ?? f.decidir_antes_de).slice(0, 10)
  const aceptadas = f.lineas_aceptadas == null ? null : lista<LineaPlan>(f.lineas_aceptadas)
  return {
    id: f.id,
    clienteId: f.client_id,
    clienteNombre: nombres.clientes.get(f.client_id) ?? 'Cliente',
    connectionId: f.connection_id,
    clave: f.clave,
    estado,
    prioridad,
    confianza,
    provisional: !!f.provisional,
    moneda: f.moneda || 'EUR',
    salirAntesDe: f.salir_antes_de.slice(0, 10),
    decidirAntesDe: f.decidir_antes_de.slice(0, 10),
    aLaVenta: f.a_la_venta ? f.a_la_venta.slice(0, 10) : null,
    fechaLimite,
    responsableId: f.responsable_id,
    responsableNombre: f.responsable_id ? nombres.personas.get(f.responsable_id) ?? null : null,
    unidades: f.unidades ?? 0,
    cajasEstimadas: f.cajas_estimadas,
    eurosEnRiesgo: numeroONulo(f.euros_en_riesgo),
    porque: lista<unknown>(f.porque).filter((x): x is string => typeof x === 'string'),
    lineas: lista<LineaPlan>(f.lineas),
    lineasAceptadas: aceptadas,
    cambiosDesdeAyer: objetoONulo<CambiosDesdeAyer>(f.cambios_desde_ayer),
    planYaNoLoPide: !!f.plan_ya_no_lo_pide,
    ajustesAplicados: lista<AjusteIa>(f.ajustes_aplicados),
    ia: objetoONulo<RevisionIa>(f.ia),
    motivoDescarte: (MOTIVOS_DESCARTE.includes(f.motivo_descarte as MotivoDescarte) ? f.motivo_descarte : null) as MotivoDescarte | null,
    nota: f.nota,
    remesaId: f.remesa_id,
    esperandoDesde: f.esperando_desde ? f.esperando_desde.slice(0, 10) : null,
    pasadaId: f.pasada_id,
    version: f.version ?? 0,
    creadoAt: f.creado_at,
    actualizadoAt: f.actualizado_at,
    estadoCambiadoAt: f.estado_cambiado_at,
    vencido: esVencido({ estado, fechaLimite }, hoy),
  }
}

/* =============================================================================================
 * Nombres (clientes y personas)
 * ============================================================================================= */

async function nombresDeClientes(service: Servicio, ids: string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids)].filter(Boolean)
  const mapa = new Map<string, string>()
  for (let i = 0; i < unicos.length; i += 150) {
    const { data } = await service.from('amazon_clients').select('id, name').in('id', unicos.slice(i, i + 150))
    for (const c of (data ?? []) as Array<{ id: string; name: string | null }>) mapa.set(c.id, c.name ?? 'Cliente')
  }
  return mapa
}

async function nombresDePersonas(service: Servicio, ids: Array<string | null>): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((x): x is string => !!x))]
  const mapa = new Map<string, string>()
  if (unicos.length === 0) return mapa
  const { data } = await service.from('profiles').select('id, full_name, email').in('id', unicos)
  for (const p of (data ?? []) as Array<{ id: string; full_name: string | null; email?: string | null }>) {
    mapa.set(p.id, p.full_name || p.email || 'Alguien del equipo')
  }
  return mapa
}

async function aGuardados(service: Servicio, filas: FilaEnvioPropuesto[], hoy: string): Promise<EnvioPropuestoGuardado[]> {
  const [clientes, personas] = await Promise.all([
    nombresDeClientes(service, filas.map((f) => f.client_id)),
    nombresDePersonas(service, filas.map((f) => f.responsable_id)),
  ])
  return filas.map((f) => filaAGuardado(f, { clientes, personas }, hoy))
}

/* =============================================================================================
 * Leer
 * ============================================================================================= */

export interface FiltroEnvios {
  /** null = todos los permitidos de la sesión */
  clienteId?: string | null
  /** null o vacío = todos los estados */
  estados?: EstadoEnvioPropuesto[] | null
}

/** Puro: «activos», «nuevo,hablado» o nada → la lista de estados; desconocidos fuera */
export function estadosDeParametro(p: string | null | undefined): EstadoEnvioPropuesto[] | null {
  if (!p) return null
  if (p === 'activos') return ['nuevo', 'hablado', 'esperando_cliente', 'en_preparacion']
  const salida = p.split(',').map((x) => x.trim()).filter((x): x is EstadoEnvioPropuesto => TODOS_LOS_ESTADOS.includes(x as EstadoEnvioPropuesto))
  return salida.length ? salida : null
}

/** Los envíos propuestos que la sesión puede ver. `migracion316 = false` si la tabla no existe */
export async function leerEnvios(
  service: Servicio,
  sesion: Pick<SesionFba, 'clientesPermitidos'>,
  filtro: FiltroEnvios,
  hoy: string,
): Promise<{ envios: EnvioPropuestoGuardado[]; migracion316: boolean }> {
  if (sesion.clientesPermitidos && filtro.clienteId && !sesion.clientesPermitidos.includes(filtro.clienteId)) {
    return { envios: [], migracion316: true }
  }
  let filas: FilaEnvioPropuesto[]
  try {
    filas = await leerTodo<FilaEnvioPropuesto>((desde, hasta) => {
      let q = service.from('fba_envios_propuestos').select(COLUMNAS_ENVIO)
      if (filtro.clienteId) q = q.eq('client_id', filtro.clienteId)
      else if (sesion.clientesPermitidos) q = q.in('client_id', sesion.clientesPermitidos)
      if (filtro.estados?.length) q = q.in('estado', filtro.estados)
      return q.order('fecha_limite', { ascending: true }).order('id', { ascending: true }).range(desde, hasta)
    })
  } catch (error) {
    if (faltaLaTabla(error as { code?: string })) return { envios: [], migracion316: false }
    throw error
  }
  return { envios: await aGuardados(service, filas, hoy), migracion316: true }
}

/** Un envío propuesto con su fila cruda (para escribir). null si no existe; lanza ErrorDeEnvio 409 sin la 316 */
export async function leerFilaEnvio(service: Servicio, id: string): Promise<FilaEnvioPropuesto | null> {
  const { data, error } = await service.from('fba_envios_propuestos').select(COLUMNAS_ENVIO).eq('id', id).maybeSingle()
  if (error) {
    if (faltaLaTabla(error)) throw new ErrorDeEnvio(AVISO_316, 409, { migracion316: false })
    throw error
  }
  return (data as FilaEnvioPropuesto | null) ?? null
}

export async function leerEnvio(service: Servicio, id: string, hoy: string): Promise<EnvioPropuestoGuardado | null> {
  const fila = await leerFilaEnvio(service, id)
  if (!fila) return null
  return (await aGuardados(service, [fila], hoy))[0]
}

/* =============================================================================================
 * Historial
 * ============================================================================================= */

export type AccionHistorialEnvio =
  | 'crear' | 'actualizar_plan' | 'estado' | 'responsable' | 'fecha_limite' | 'nota' | 'convertir' | 'ajuste_ia'
  | 'caducar' | 'remesa_borrada' | 'desenlazar' | 'remesa_enviada' | 'remesa_vuelve_a_lista'

export interface ApunteEnvio {
  envioPropuestoId: string
  quien: string | null
  accion: AccionHistorialEnvio
  de?: string | null
  a?: string | null
  nota?: string | null
  datos?: Record<string, unknown>
}

/** Deja el apunte. No lanza nunca: perder un apunte es malo, tumbar el cambio por él es peor */
export async function apuntarEnHistorial(service: Servicio, apuntes: ApunteEnvio | ApunteEnvio[]): Promise<void> {
  const filas = (Array.isArray(apuntes) ? apuntes : [apuntes]).map((a) => ({
    envio_propuesto_id: a.envioPropuestoId,
    quien: a.quien,
    accion: a.accion,
    de: a.de ?? null,
    a: a.a ?? null,
    nota: a.nota ?? null,
    datos: a.datos ?? {},
  }))
  if (filas.length === 0) return
  try {
    const { error } = await service.from('fba_envios_propuestos_historial').insert(filas)
    if (error && !faltaLaTabla(error)) throw error
  } catch (error) {
    console.error('[fba] no se ha podido apuntar en el historial del envío propuesto:', error instanceof Error ? error.message : error)
  }
}

export interface EventoEnvio {
  id: string
  cuando: string
  quien: string | null
  quienNombre: string | null
  accion: string
  de: string | null
  a: string | null
  nota: string | null
  datos: Record<string, unknown>
}

export async function historialDeEnvio(service: Servicio, id: string, limite = 200): Promise<{ eventos: EventoEnvio[]; migracion316: boolean }> {
  const { data, error } = await service
    .from('fba_envios_propuestos_historial')
    .select('id, cuando, quien, accion, de, a, nota, datos')
    .eq('envio_propuesto_id', id)
    .order('cuando', { ascending: false })
    .limit(limite)
  if (error) {
    if (faltaLaTabla(error)) return { eventos: [], migracion316: false }
    throw error
  }
  const filas = (data ?? []) as Array<Omit<EventoEnvio, 'quienNombre' | 'datos'> & { datos: unknown }>
  const personas = await nombresDePersonas(service, filas.map((f) => f.quien))
  return {
    eventos: filas.map((f) => ({
      ...f,
      quienNombre: f.quien ? personas.get(f.quien) ?? null : null,
      datos: objetoONulo<Record<string, unknown>>(f.datos) ?? {},
    })),
    migracion316: true,
  }
}

/* =============================================================================================
 * Pendientes (§4.3 + D18)
 * ============================================================================================= */

interface FilaRemesaPendiente {
  id: string
  client_id: string
  nombre: string | null
  referencia_envio: string | null
  estado: EstadoRemesa
  estado_amazon: string | null
  fecha_envio: string | null
  llegada_at: string | null
  updated_at: string | null
  propuesta_enviada_at?: string | null
  cliente_acepto_at?: string | null
}

const COLUMNAS_REMESA_PENDIENTE = 'id, client_id, nombre, referencia_envio, estado, estado_amazon, fecha_envio, llegada_at, updated_at'

/**
 * Puro: cuándo cerró Amazon un envío, aproximado. Amazon no da la fecha de cierre y `updated_at` NO sirve: la
 * pasada de seguimiento la toca cada vez que mira (en producción, envíos de 2025 «cerrados hace 5 días» por una
 * relectura del 10 nov). Lo más cercano es lo último que Amazon recibió de ese envío: el último Receipt del
 * libro o `llegada_at`, el que sea posterior. Sin ninguno, la fecha de envío (lo más prudente: si ya no hay
 * plazo para reclamar, no se pide que se reclame).
 */
export function fechaDeCierre(r: { llegada_at: string | null; fecha_envio: string | null }, ultimoRecibo: string | null): string | null {
  const candidatas = [r.llegada_at?.slice(0, 10) ?? null, ultimoRecibo?.slice(0, 10) ?? null].filter((x): x is string => !!x)
  if (candidatas.length === 0) return r.fecha_envio?.slice(0, 10) ?? null
  return candidatas.reduce((a, b) => (b > a ? b : a))
}

/** El día del último Receipt del libro de cada número de envío (índice `fba_movimientos_referencia_idx`) */
async function ultimosRecibos(service: Servicio, referencias: string[]): Promise<Map<string, string>> {
  const refs = [...new Set(referencias.filter(Boolean))]
  const ultimo = new Map<string, string>()
  for (let i = 0; i < refs.length; i += 50) {
    const filas = await leerTodo<{ referencia: string; fecha: string }>((d, h) =>
      service.from('fba_movimientos').select('referencia, fecha').eq('tipo', 'Receipts').in('referencia', refs.slice(i, i + 50)).order('id').range(d, h),
    )
    for (const f of filas) {
      const dia = f.fecha.slice(0, 10)
      if (dia > (ultimo.get(f.referencia) ?? '')) ultimo.set(f.referencia, dia)
    }
  }
  return ultimo
}

/** Remesas que pueden dar trabajo: las vivas y las cerradas de los últimos 75 días (para reclamar faltantes) */
async function remesasParaPendientes(service: Servicio, clientes: string[] | null, clienteId: string | null, hoy: string): Promise<FilaRemesaPendiente[]> {
  const desdeCierre = sumarDias(hoy, -75)
  // El filtro por cliente va en un solo `.in` (uno o los permitidos); sin lista = todos
  const filtroClientes: string[] | null = clienteId ? [clienteId] : clientes

  const leer = async (columnas: string) => {
    const vivas = await leerTodo<FilaRemesaPendiente>((d, h) => {
      let q = service.from('fba_remesas').select(columnas).in('estado', ESTADOS_REMESA_VIVOS as EstadoRemesa[])
      if (filtroClientes) q = q.in('client_id', filtroClientes)
      return q.order('id').range(d, h)
    })
    const cerradas = await leerTodo<FilaRemesaPendiente>((d, h) => {
      let q = service.from('fba_remesas').select(columnas).eq('estado', 'cerrada').eq('estado_amazon', 'CLOSED').gte('updated_at', desdeCierre)
      if (filtroClientes) q = q.in('client_id', filtroClientes)
      return q.order('id').range(d, h)
    })
    return [...vivas, ...cerradas]
  }
  try {
    return await leer(`${COLUMNAS_REMESA_PENDIENTE}, propuesta_enviada_at, cliente_acepto_at`)
  } catch (error) {
    // Sin la 309 no están las columnas de la propuesta: se sigue sin «aceptó sin revisar»
    if (faltaLaTabla(error as { code?: string })) return leer(COLUMNAS_REMESA_PENDIENTE)
    throw error
  }
}

async function lineasDeRemesas(service: Servicio, ids: string[]): Promise<Map<string, Array<{ sku: string; unidades: number; recibidas: number | null }>>> {
  const mapa = new Map<string, Array<{ sku: string; unidades: number; recibidas: number | null }>>()
  for (let i = 0; i < ids.length; i += 100) {
    const trozo = ids.slice(i, i + 100)
    const filas = await leerTodo<{ remesa_id: string; sku: string; unidades: number; unidades_recibidas: number | null }>((d, h) =>
      service.from('fba_remesa_lineas').select('remesa_id, sku, unidades, unidades_recibidas').in('remesa_id', trozo).order('id').range(d, h),
    )
    for (const f of filas) {
      const g = mapa.get(f.remesa_id) ?? []
      g.push({ sku: f.sku, unidades: f.unidades ?? 0, recibidas: f.unidades_recibidas })
      mapa.set(f.remesa_id, g)
    }
  }
  return mapa
}

/**
 * El transporte del plazo de los clientes sin pasada: el manual (`fba_alertas_config`) o el de partida, calculado con
 * `plazoDelCliente` sin medidas (la regla de respaldo del plan). Para «dudoso» en «Hoy».
 */
async function transportesDeRespaldo(service: Servicio, clientes: string[], hoy: string): Promise<Record<string, number | null>> {
  const salida: Record<string, number | null> = {}
  if (clientes.length === 0) return salida
  const filas = new Map<string, Record<string, unknown>>()
  for (let i = 0; i < clientes.length; i += 100) {
    const { data, error } = await service.from('fba_alertas_config').select('*').in('client_id', clientes.slice(i, i + 100))
    if (error) {
      if (faltaLaTabla(error)) break
      throw error
    }
    for (const f of (data ?? []) as Array<Record<string, unknown>>) filas.set(String(f.client_id), f)
  }
  for (const id of clientes) salida[id] = plazoDelCliente(configAlertasDesdeFila(filas.get(id) ?? null), null, hoy, { transporteUrgenteDias: null }).transporte
  return salida
}

/** La última pasada de cada cliente (calidad, plazo, moneda y líneas). Vacío sin la 316 */
async function ultimasPasadas(service: Servicio, clientes: string[] | null, clienteId: string | null): Promise<Array<{ clienteId: string; calidad: CalidadDatos | null; plazo: PlazoEtapas | null; transporteMediano: number | null; moneda: string; lineas: LineaPlan[] }>> {
  let q = service.from('fba_plan_ultima').select('id, client_id, calidad, resumen')
  if (clienteId) q = q.eq('client_id', clienteId)
  else if (clientes) q = q.in('client_id', clientes)
  const { data, error } = await q
  if (error) {
    if (faltaLaTabla(error)) return []
    throw error
  }
  const ultimas = (data ?? []) as Array<{ id: string; client_id: string; calidad: unknown; resumen: unknown }>
  const detalle = new Map<string, { plazo: unknown; lineas: unknown }>()
  for (let i = 0; i < ultimas.length; i += 20) {
    const { data: d, error: e } = await service.from('fba_plan_pasadas').select('id, plazo, lineas').in('id', ultimas.slice(i, i + 20).map((u) => u.id))
    if (e) {
      if (faltaLaTabla(e)) break
      throw e
    }
    for (const p of (d ?? []) as Array<{ id: string; plazo: unknown; lineas: unknown }>) detalle.set(p.id, p)
  }
  return ultimas.map((u) => {
    const resumen = objetoONulo<{ moneda?: string }>(u.resumen)
    const p = detalle.get(u.id)
    const plazo = objetoONulo<PlazoEtapas & { _pasada?: { medidas?: { transporteMediano?: unknown } } }>(p?.plazo)
    const mediano = plazo?._pasada?.medidas?.transporteMediano
    return {
      clienteId: u.client_id,
      calidad: objetoONulo<CalidadDatos>(u.calidad),
      plazo: plazo && typeof plazo.transporte === 'number' ? plazo : null,
      // El transporte medido con el que el plan dijo «dudoso» (envío → primer Receipt), guardado en la pasada
      transporteMediano: typeof mediano === 'number' && Number.isFinite(mediano) ? mediano : null,
      moneda: resumen?.moneda || 'EUR',
      lineas: lista<LineaPlan>(p?.lineas),
    }
  })
}

/**
 * Lo que se nos puede escapar, para la vista «Hoy» y el filtro de «Plan»: envíos propuestos vencidos o sin
 * dueño, remesas paradas, cerradas con faltantes (con la cuenta atrás para reclamar), envíos dudosos,
 * entrantes sin remesa, modelos y agotados, mermas y calidad de datos. Funciona sin la 316 (solo remesas).
 */
export async function pendientesDeSesion(
  service: Servicio,
  sesion: Pick<SesionFba, 'clientesPermitidos'>,
  envios: EnvioPropuestoGuardado[],
  hoy: string,
  clienteId: string | null = null,
): Promise<TareaPendiente[]> {
  const permitidos = sesion.clientesPermitidos
  const [filasRemesas, pasadas] = await Promise.all([
    remesasParaPendientes(service, permitidos, clienteId, hoy),
    ultimasPasadas(service, permitidos, clienteId),
  ])
  const cerradasEnAmazon = filasRemesas.filter((r) => r.estado_amazon === 'CLOSED' && r.referencia_envio)
  const [lineas, recibos] = await Promise.all([
    lineasDeRemesas(service, filasRemesas.map((r) => r.id)),
    ultimosRecibos(service, cerradasEnAmazon.map((r) => (r.referencia_envio as string).trim())).catch(() => new Map<string, string>()),
  ])
  const nombres = await nombresDeClientes(service, [...filasRemesas.map((r) => r.client_id), ...pasadas.map((p) => p.clienteId)])

  const porCliente = new Map(pasadas.map((p) => [p.clienteId, p]))
  const precio = new Map<string, number>() // `${cliente}:${sku}`
  for (const p of pasadas) for (const l of p.lineas) if (l.precio != null) precio.set(`${p.clienteId}:${l.sku}`, l.precio)
  const envioDeRemesa = new Map(envios.filter((e) => e.remesaId).map((e) => [e.remesaId as string, e.id]))

  const remesas: RemesaParaPendientes[] = filasRemesas.map((r) => {
    const ls = lineas.get(r.id) ?? []
    const conRecibidas = ls.some((l) => l.recibidas != null)
    return {
      id: r.id,
      clienteId: r.client_id,
      clienteNombre: nombres.get(r.client_id) ?? 'Cliente',
      nombre: r.nombre,
      referenciaEnvio: r.referencia_envio,
      estado: r.estado,
      estadoAmazon: r.estado_amazon,
      fechaEnvio: r.fecha_envio,
      actualizadaAt: r.updated_at,
      estadoAmazonDesde: r.estado_amazon === 'CLOSED' ? fechaDeCierre(r, recibos.get((r.referencia_envio ?? '').trim()) ?? null) : null,
      propuestaEnviadaAt: r.propuesta_enviada_at ?? null,
      clienteAceptoAt: r.cliente_acepto_at ?? null,
      enviadas: ls.reduce((s, l) => s + Math.max(0, l.unidades), 0),
      recibidas: conRecibidas ? ls.reduce((s, l) => s + Math.max(0, l.recibidas ?? 0), 0) : null,
      moneda: porCliente.get(r.client_id)?.moneda ?? null,
      lineas: ls.map((l) => ({ ...l, precio: precio.get(`${r.client_id}:${l.sku}`) ?? null })),
      envioPropuestoId: envioDeRemesa.get(r.id) ?? null,
    }
  })

  const clientes: ClienteParaPendientes[] = pasadas.map((p) => ({
    clienteId: p.clienteId,
    clienteNombre: nombres.get(p.clienteId) ?? 'Cliente',
    calidad: p.calidad,
    lineas: p.lineas,
    // La misma regla que el plan (`transporteParaDudoso`): el medido y, si no hay, el transporte del plazo SIEMPRE (manual o de
    // partida). Antes solo se pasaba si era medido y el umbral se quedaba en 30: «Hoy» daba por perdido lo que el plan esperaba
    transporteMediano: p.transporteMediano ?? (p.plazo && p.plazo.origen?.transporte === 'medido' ? p.plazo.transporte : null),
    transportePlazo: p.plazo?.transporte ?? null,
    moneda: p.moneda,
  }))
  // Los clientes sin pasada no tienen calidad que contar, pero sus remesas sí dan trabajo. Su «dudoso» usa el plazo manual o el
  // de partida (la misma regla de respaldo que el plan sin medida)
  const sinPasada = [...new Set(filasRemesas.map((r) => r.client_id))].filter((id) => !porCliente.has(id))
  const transporteSinPlan = await transportesDeRespaldo(service, sinPasada, hoy)
  return pendientes({ hoy, envios, remesas, clientes, transporteSinPlan })
}

/* =============================================================================================
 * Contexto del plan de un envío (plazo y ajustes) y recálculo de un ajuste
 * ============================================================================================= */

const MEDIDAS_VACIAS: MedidasCliente = { transporteMediano: null, recepcionP75: null, enviosMedidos: 0, cadenciaDias: null, tamanoTipico: null }

export interface ContextoEnvio {
  plazo: PlazoEtapas
  ajustes: AjustesReposicion
  ventasHasta: string | null
}

/** El plazo de la pasada que generó el envío (o la última del cliente) y los ajustes del cliente */
export async function contextoDeEnvio(service: Servicio, fila: Pick<FilaEnvioPropuesto, 'client_id' | 'pasada_id'>, hoy: string): Promise<ContextoEnvio> {
  let plazo: PlazoEtapas | null = null
  let ventasHasta: string | null = null
  const leerPasada = async (q: PromiseLike<{ data: unknown; error: { code?: string } | null }>) => {
    const { data, error } = await q
    if (error) return
    const p = data as { plazo?: unknown; calidad?: unknown } | null
    const pz = objetoONulo<PlazoEtapas>(p?.plazo)
    if (pz && typeof pz.transporte === 'number') plazo = pz
    ventasHasta = objetoONulo<CalidadDatos>(p?.calidad)?.leidoHasta ?? null
  }
  if (fila.pasada_id) await leerPasada(service.from('fba_plan_pasadas').select('plazo, calidad').eq('id', fila.pasada_id).maybeSingle())
  if (!plazo) {
    await leerPasada(
      service.from('fba_plan_pasadas').select('plazo, calidad').eq('client_id', fila.client_id).order('calculado_at', { ascending: false }).limit(1).maybeSingle(),
    )
  }
  let ajustes: AjustesReposicion = AJUSTES_DE_PARTIDA
  const { data: cfg, error: errCfg } = await service.from('fba_reposicion_config').select('*').eq('client_id', fila.client_id).maybeSingle()
  if (!errCfg) ajustes = ajustesDesdeFila((cfg as FilaReposicionConfig | null) ?? null, null)
  return {
    plazo: plazo ?? plazoDelCliente(null, null, hoy, { transporteUrgenteDias: ajustes.transporteUrgenteDias }),
    ajustes,
    ventasHasta,
  }
}

/**
 * Puro: una EntradaSku aproximada a partir de la línea guardada. La línea no guarda sus llegadas una a una,
 * así que lo de camino llega tras la recepción y lo comprometido al final del plazo. Por eso el recálculo
 * de un ajuste usa la DIFERENCIA entre recalcular con y sin el ajuste (ver `recalculadorDeAjustes`): el
 * error de la aproximación se cancela.
 */
export function entradaDesdeLinea(l: LineaPlan, hoy: string, plazo: PlazoEtapas): EntradaSku {
  const llegadas: EntradaSku['llegadas'] = []
  if (l.deCamino > 0) {
    llegadas.push({ fecha: sumarDias(hoy, plazo.recepcion), unidades: l.deCamino, origen: 'camino', remesaId: null, envioPropuestoId: null, nombre: null, dudoso: false, fechaEnvio: null })
  }
  if (l.comprometido > 0) {
    llegadas.push({ fecha: sumarDias(hoy, plazo.hastaLaVenta), unidades: l.comprometido, origen: 'comprometido', remesaId: null, envioPropuestoId: null, nombre: null, dudoso: false, fechaEnvio: null })
  }
  return {
    sku: l.sku, asin: l.asin, fnsku: l.fnsku, nombre: l.nombre, modelo: l.modelo, talla: l.talla, precio: l.precio, moneda: l.moneda,
    vendibles: l.vendibles, reservadas: l.reservadas, entranteAmazon: 0,
    llegadas, llegadasDescartadas: [],
    ritmo: l.ritmo,
    comprable: true, descatalogada: false, excluida: null,
    cajaSku: l.caja?.origen === 'sku' ? l.caja.unidades : null,
    cajaDeducida: l.caja?.origen === 'deducida' ? l.caja.unidades : null,
    coberturaSku: null, diasSinVenta: null, pctMasDe180: null, tasaDevolucion90: null,
    ventas90: l.ritmo?.ventas90 ?? 0, enCuarentena: null,
    provisional: (l.avisos ?? []).includes('provisional'),
    stockViejoDias: null, almacenCliente: null,
  }
}

const PRISA: readonly Prioridad[] = ['tarde', 'urgente', 'esta_semana']

/** Puro: el recalculador que se le inyecta a validarAjustesIa (la aritmética de planificador.ts) */
export function recalculadorDeAjustes(hoy: string, contexto: Pick<ContextoEnvio, 'plazo' | 'ajustes'>): RecalcularAjuste {
  const { plazo, ajustes } = contexto
  const tr = plazo.transporte + plazo.recepcion
  const llegadaDe = (salida: string) => sumarDias(salida > hoy ? salida : hoy, tr)
  return (linea, cambio) => {
    const e = entradaDesdeLinea(linea, hoy, plazo)
    const llegadaOriginal = linea.salirAntesDe ? llegadaDe(linea.salirAntesDe) : undefined
    const base = planificarSku(e, hoy, plazo, ajustes, MEDIDAS_VACIAS, { llegadaForzada: llegadaOriginal })
    const con = cambio.tipo === 'factor_ritmo'
      ? planificarSku(e, hoy, plazo, ajustes, MEDIDAS_VACIAS, { llegadaForzada: llegadaOriginal, factorIa: cambio.factor })
      : planificarSku(e, hoy, plazo, ajustes, MEDIDAS_VACIAS, { llegadaForzada: llegadaDe(cambio.nuevaSalida) })

    let cantidad: number
    if (base.cantidad > 0) {
      cantidad = Math.max(0, linea.cantidad + (con.cantidad - base.cantidad))
    } else if (cambio.tipo === 'factor_ritmo') {
      cantidad = Math.max(0, linea.cantidad * cambio.factor)
    } else {
      cantidad = con.cantidad > 0 ? con.cantidad : linea.cantidad
    }
    const k = linea.caja?.unidades ?? null
    cantidad = redondearACaja(cantidad, k, PRISA.includes(linea.prioridad))
    const tope = cambio.tipo === 'factor_ritmo' ? Math.max(linea.tope, Math.round(linea.tope * cambio.factor)) : Math.max(linea.tope, con.tope)
    const mover = cambio.tipo === 'mover_envio' ? cambio.dias : 0
    return {
      ...linea,
      cantidad,
      tope,
      cajas: k ? Math.ceil(cantidad / k) : null,
      salirAntesDe: linea.salirAntesDe && mover ? sumarDias(linea.salirAntesDe, mover) : linea.salirAntesDe,
      decidirAntesDe: linea.decidirAntesDe && mover ? sumarDias(linea.decidirAntesDe, mover) : linea.decidirAntesDe,
    }
  }
}

/** Puro: lee un AjusteIa del cuerpo de la petición. null si no tiene forma */
export function leerAjuste(v: unknown): AjusteIa | null {
  const o = objetoONulo<Record<string, unknown>>(v)
  if (!o || typeof o.sku !== 'string' || !o.sku.trim()) return null
  const sku = o.sku.trim().slice(0, 120)
  const motivo = typeof o.motivo === 'string' ? o.motivo.trim().slice(0, 200) : ''
  if (o.tipo === 'excluir') return { tipo: 'excluir', sku, motivo }
  if (o.tipo === 'factor_ritmo') {
    const valor = numeroONulo(o.valor)
    return valor === null ? null : { tipo: 'factor_ritmo', sku, valor, motivo }
  }
  if (o.tipo === 'mover_envio') {
    const dias = numeroONulo(o.dias ?? o.valor)
    return dias === null ? null : { tipo: 'mover_envio', sku, dias, motivo }
  }
  return null
}

/**
 * Puro: aplica un ajuste ya validado a las líneas. Devuelve las líneas nuevas o el motivo del rechazo.
 * La aritmética sigue siendo la autoridad: el factor y el desplazamiento se recalculan con planificador.ts.
 */
export function aplicarAjusteALineas(
  lineas: LineaPlan[],
  ajuste: AjusteIa,
  hoy: string,
  contexto: Pick<ContextoEnvio, 'plazo' | 'ajustes'>,
): { ok: true; lineas: LineaPlan[]; antes: number; despues: number } | { ok: false; motivo: string } {
  const recalcular = recalculadorDeAjustes(hoy, contexto)
  const comoIa = { tipo: ajuste.tipo, sku: ajuste.sku, valor: ajuste.tipo === 'factor_ritmo' ? ajuste.valor : ajuste.tipo === 'mover_envio' ? ajuste.dias : null, motivo: ajuste.motivo }
  const r = validarAjustesIa([comoIa], lineas, hoy, recalcular, { minLinea: contexto.ajustes.minLinea })
  if (r.validos.length === 0) return { ok: false, motivo: r.rechazados[0]?.motivo ?? 'El ajuste no vale' }

  const i = lineas.findIndex((l) => l.sku === ajuste.sku)
  const linea = lineas[i]
  const ajusteIa: LineaPlan['ajusteIa'] = { tipo: ajuste.tipo, valor: comoIa.valor, motivo: ajuste.motivo }
  let nueva: LineaPlan
  if (ajuste.tipo === 'excluir') {
    nueva = { ...linea, cantidad: 0, cajas: null, ajusteIa, porque: `${linea.porque} Quitada del envío a mano${ajuste.motivo ? `: ${ajuste.motivo}` : ''}.`.trim() }
  } else {
    const cambio = ajuste.tipo === 'factor_ritmo'
      ? { tipo: 'factor_ritmo' as const, factor: ajuste.valor }
      : { tipo: 'mover_envio' as const, dias: ajuste.dias, nuevaSalida: sumarDias(linea.salirAntesDe as string, ajuste.dias) }
    const r2 = recalcular(linea, cambio)
    if (!r2) return { ok: false, motivo: 'no se ha podido recalcular con la aritmética' }
    const frase = ajuste.tipo === 'factor_ritmo'
      ? `Ajuste ×${ajuste.valor.toLocaleString('es-ES')} del ritmo: ${linea.cantidad} → ${r2.cantidad} ud.`
      : `Salida movida ${ajuste.dias > 0 ? '+' : ''}${ajuste.dias} días: ${linea.cantidad} → ${r2.cantidad} ud.`
    nueva = { ...r2, ajusteIa, porque: `${linea.porque} ${frase}`.trim() }
  }
  const salida = [...lineas]
  salida[i] = nueva
  return { ok: true, lineas: salida, antes: linea.cantidad, despues: nueva.cantidad }
}

/** Puro: unidades y cajas de unas líneas (las que se proponen), como en el PATCH: sin caja en todas, a 40 por caja */
export function cifrasDeLineas(lineas: LineaPlan[]): { unidades: number; cajasEstimadas: number } {
  const propuestas = lineas.filter((l) => l.cantidad > 0 && !l.fuera)
  const unidades = propuestas.reduce((s, l) => s + l.cantidad, 0)
  const conCaja = propuestas.every((l) => l.caja && l.caja.unidades > 0)
  const cajasEstimadas = propuestas.length === 0
    ? 0
    : conCaja ? propuestas.reduce((s, l) => s + Math.ceil(l.cantidad / (l.caja as { unidades: number }).unidades), 0) : Math.ceil(unidades / 40)
  return { unidades, cajasEstimadas }
}

/**
 * Puro: vuelve a aplicar sobre las líneas que salen del plan de hoy los ajustes que una persona ya aplicó al envío
 * («excluir», un factor, mover). Sin esto, la pasada siguiente reescribe las líneas y el ajuste se pierde solo.
 * Los que ya no se pueden aplicar (la referencia ya no está o el ajuste ya no vale) se saltan.
 */
export function reaplicarAjustes(
  lineas: LineaPlan[],
  ajustes: AjusteIa[],
  hoy: string,
  contexto: Pick<ContextoEnvio, 'plazo' | 'ajustes'>,
): { lineas: LineaPlan[]; aplicados: number } {
  let actuales = lineas
  let aplicados = 0
  for (const a of ajustes) {
    if (!actuales.some((l) => l.sku === a.sku)) continue
    const r = aplicarAjusteALineas(actuales, a, hoy, contexto)
    if (!r.ok) continue
    actuales = r.lineas
    aplicados++
  }
  return { lineas: actuales, aplicados }
}

/* =============================================================================================
 * Cambiar (PATCH)
 * ============================================================================================= */

export interface CambioEnvio {
  version: number
  estado?: EstadoEnvioPropuesto
  /** undefined = no se toca; null = sin responsable */
  responsableId?: string | null
  fechaLimite?: string
  nota?: string | null
  motivoDescarte?: MotivoDescarte
  /** Con «descatalogada» en un envío de varias referencias: cuáles lo están (solo esas se excluyen del planificador) */
  skusDescatalogados?: string[]
  aplicarAjuste?: AjusteIa
}

/**
 * Puro: qué referencias excluye del planificador descartar un envío como «descatalogada» (D8). Con una sola referencia (o si
 * todas son «agotado hace mucho», la pregunta «¿se repone?»), esa(s). Con varias, solo las que se digan: un envío de 30
 * referencias con una descatalogada no saca las otras 29 para siempre. Sin decirlas, ninguna, y un aviso.
 */
export function skusAExcluirPorDescatalogada(
  lineas: ReadonlyArray<Pick<LineaPlan, 'sku' | 'cantidad' | 'fuera'>>,
  pedidos?: readonly string[],
): { skus: string[]; aviso: string | null } {
  const conUnidades = lineas.filter((l) => l.cantidad > 0)
  const todas = [...new Set((conUnidades.length ? conUnidades : lineas).map((l) => l.sku))]
  if (todas.length <= 1 || lineas.every((l) => l.fuera === 'agotado_largo')) return { skus: todas, aviso: null }
  const dichas = new Set((pedidos ?? []).map((s) => s.trim()).filter(Boolean))
  const skus = todas.filter((s) => dichas.has(s))
  if (skus.length > 0) return { skus, aviso: null }
  return {
    skus: [],
    aviso: `Descartado. No se ha excluido ninguna de sus ${todas.length} referencias del planificador: si alguna está descatalogada, exclúyela desde la tabla de Reposición.`,
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Puro: valida el cuerpo del PATCH. Los textos van tal cual a la pantalla */
export function leerCambio(cuerpo: unknown): { ok: true; cambio: CambioEnvio } | { ok: false; error: string } {
  const b = objetoONulo<Record<string, unknown>>(cuerpo) ?? {}
  const version = numeroONulo(b.version)
  if (version === null || !Number.isInteger(version)) return { ok: false, error: 'Falta la versión del envío que estás viendo: recarga la página' }
  const cambio: CambioEnvio = { version }
  if (b.estado !== undefined) {
    if (!TODOS_LOS_ESTADOS.includes(b.estado as EstadoEnvioPropuesto)) return { ok: false, error: 'Ese estado no existe' }
    cambio.estado = b.estado as EstadoEnvioPropuesto
  }
  if (b.responsableId !== undefined) {
    if (b.responsableId !== null && (typeof b.responsableId !== 'string' || !UUID_RE.test(b.responsableId))) return { ok: false, error: 'Esa persona no existe' }
    cambio.responsableId = b.responsableId as string | null
  }
  if (b.fechaLimite !== undefined) {
    if (typeof b.fechaLimite !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.fechaLimite)) return { ok: false, error: 'La fecha límite tiene que ser un día, con el formato 2026-12-03' }
    cambio.fechaLimite = b.fechaLimite
  }
  if (b.nota !== undefined) {
    if (b.nota !== null && typeof b.nota !== 'string') return { ok: false, error: 'La nota tiene que ser texto' }
    cambio.nota = typeof b.nota === 'string' ? b.nota.trim().slice(0, 1000) || null : null
  }
  if (b.motivoDescarte !== undefined && b.motivoDescarte !== null) {
    if (!MOTIVOS_DESCARTE.includes(b.motivoDescarte as MotivoDescarte)) return { ok: false, error: 'Ese motivo de descarte no existe' }
    cambio.motivoDescarte = b.motivoDescarte as MotivoDescarte
  }
  if (b.skusDescatalogados !== undefined && b.skusDescatalogados !== null) {
    if (!Array.isArray(b.skusDescatalogados) || b.skusDescatalogados.some((x) => typeof x !== 'string')) return { ok: false, error: 'Las referencias descatalogadas tienen que ser una lista de SKU' }
    cambio.skusDescatalogados = (b.skusDescatalogados as string[]).map((x) => x.trim().slice(0, 80)).filter(Boolean).slice(0, 500)
  }
  if (b.aplicarAjuste !== undefined && b.aplicarAjuste !== null) {
    const a = leerAjuste(b.aplicarAjuste)
    if (!a) return { ok: false, error: 'Ese ajuste no tiene forma de ajuste' }
    cambio.aplicarAjuste = a
  }
  if (cambio.estado === 'descartado' && !cambio.motivoDescarte) return { ok: false, error: 'Para descartar hay que decir el motivo' }
  if (Object.keys(cambio).length === 1) return { ok: false, error: 'No hay nada que cambiar' }
  return { ok: true, cambio }
}

/**
 * Aplica un cambio de una persona: transición validada con `puedeCambiar`, 409 si la versión no es la que
 * vio (D23) y la sube, ajustes recalculados con la aritmética, y una línea de historial por cada cosa.
 */
export async function cambiarEnvio(
  service: Servicio,
  sesion: Pick<SesionFba, 'userId' | 'esAdmin' | 'actor' | 'clientesEditables' | 'clientesPermitidos'>,
  id: string,
  cambio: CambioEnvio,
  hoy: string,
): Promise<{ envio: EnvioPropuestoGuardado; aviso: string | null }> {
  const fila = await leerFilaEnvio(service, id)
  if (!fila || !puedeEditar(sesion as SesionFba, fila.client_id)) throw new ErrorDeEnvio('Ese envío propuesto ya no existe', 404)

  const version = fila.version ?? 0
  if (cambio.version !== version) {
    throw new ErrorDeEnvio('Alguien ha cambiado este envío mientras lo mirabas. Recarga para ver lo último.', 409, { conflicto: true, envio: (await aGuardados(service, [fila], hoy))[0] })
  }

  const ahora = new Date().toISOString()
  const actualizar: Record<string, unknown> = {}
  const apuntes: ApunteEnvio[] = []
  const quien = sesion.userId
  const estadoActual = fila.estado as EstadoEnvioPropuesto
  let aviso: string | null = null
  const extrasTrasGuardar: Array<() => Promise<void>> = []

  /* --- estado --- */
  if (cambio.estado && cambio.estado !== estadoActual) {
    const hasta = cambio.estado
    if (hasta === 'en_preparacion') throw new ErrorDeEnvio('Para pasarlo a preparación usa «Convertir en remesa»: crea la remesa y la enlaza.', 409)
    const permiso = puedeCambiar(estadoActual, hasta, 'agencia')
    if (!permiso.ok) throw new ErrorDeEnvio(permiso.motivo, 409)

    actualizar.estado = hasta
    actualizar.estado_cambiado_at = ahora
    actualizar.estado_cambiado_por = quien
    if (estadoActual === 'nuevo' && hasta === 'hablado') actualizar.lineas_aceptadas = lista<LineaPlan>(fila.lineas)
    if (hasta === 'esperando_cliente') actualizar.esperando_desde = hoy
    if (estadoActual === 'esperando_cliente' && hasta !== 'esperando_cliente') actualizar.esperando_desde = null
    if (hasta === 'descartado') {
      actualizar.motivo_descarte = cambio.motivoDescarte
      if (cambio.motivoDescarte === 'descatalogada') {
        // D8: «descatalogada» excluye del planificador (fba_reposicion_sku.excluir) la referencia del envío; si tiene varias,
        // solo las que se digan
        const lineasEnvio = lista<LineaPlan>(fila.lineas_aceptadas).length ? lista<LineaPlan>(fila.lineas_aceptadas) : lista<LineaPlan>(fila.lineas)
        const decision = skusAExcluirPorDescatalogada(lineasEnvio, cambio.skusDescatalogados)
        const skus = decision.skus
        if (decision.aviso) aviso = decision.aviso
        extrasTrasGuardar.push(async () => {
          if (skus.length === 0) return
          const { error } = await service.from('fba_reposicion_sku').upsert(
            skus.map((sku) => ({ client_id: fila.client_id, sku, excluir: true, motivo: cambio.nota || 'Descatalogada (descartado desde el plan)', actualizado_at: ahora, actualizado_por: quien })),
            { onConflict: 'client_id,sku' },
          )
          if (error) console.error('[fba] no se han podido excluir las referencias descatalogadas:', error.message)
        })
      }
    }
    if (estadoActual === 'descartado' && hasta === 'nuevo') actualizar.motivo_descarte = null

    // Desenlazar (en_preparacion → hablado): solo si la remesa sigue en borrador; la remesa se queda, sin el enlace
    if (estadoActual === 'en_preparacion' && hasta === 'hablado') {
      if (fila.remesa_id) {
        const { data: rem } = await service.from('fba_remesas').select('estado').eq('id', fila.remesa_id).maybeSingle()
        const estadoRemesa = (rem as { estado: string } | null)?.estado ?? null
        if (estadoRemesa && estadoRemesa !== 'borrador') {
          throw new ErrorDeEnvio(`La remesa ya está en «${estadoRemesa}»: solo se desenlaza mientras sigue en borrador.`, 409)
        }
        const remesaId = fila.remesa_id
        actualizar.remesa_id = null
        extrasTrasGuardar.push(async () => {
          await service.from('fba_remesas').update({ envio_propuesto_id: null }).eq('id', remesaId).eq('envio_propuesto_id', id).then(() => undefined, () => undefined)
        })
      }
      apuntes.push({ envioPropuestoId: id, quien, accion: 'desenlazar', de: estadoActual, a: hasta, nota: cambio.nota ?? null, datos: { remesaId: fila.remesa_id } })
    } else {
      apuntes.push({ envioPropuestoId: id, quien, accion: 'estado', de: estadoActual, a: hasta, nota: cambio.nota ?? null, datos: cambio.motivoDescarte ? { motivoDescarte: cambio.motivoDescarte } : {} })
    }
  }

  /* --- responsable --- */
  if (cambio.responsableId !== undefined && cambio.responsableId !== fila.responsable_id) {
    const nuevo = cambio.responsableId
    // Uno se asigna a sí mismo o se suelta; asignar a otra persona (o quitársela a otro) es de admin
    const esPropio = nuevo === quien || (nuevo === null && fila.responsable_id === quien)
    if (!esPropio && !sesion.esAdmin) throw new ErrorDeEnvio('Solo un administrador puede asignar el envío a otra persona.', 403)
    if (nuevo) {
      const { data: p } = await service.from('profiles').select('id, role').eq('id', nuevo).maybeSingle()
      const rol = (p as { role: string } | null)?.role
      if (rol !== 'admin' && rol !== 'employee') throw new ErrorDeEnvio('Esa persona no es del equipo.', 400)
    }
    actualizar.responsable_id = nuevo
    apuntes.push({ envioPropuestoId: id, quien, accion: 'responsable', de: fila.responsable_id, a: nuevo })
  }

  /* --- fecha límite --- */
  if (cambio.fechaLimite && cambio.fechaLimite !== fila.fecha_limite?.slice(0, 10)) {
    actualizar.fecha_limite = cambio.fechaLimite
    aviso = avisoDeFechaLimite(cambio.fechaLimite, fila.decidir_antes_de.slice(0, 10)) ?? aviso
    apuntes.push({ envioPropuestoId: id, quien, accion: 'fecha_limite', de: fila.fecha_limite?.slice(0, 10) ?? null, a: cambio.fechaLimite })
  }

  /* --- nota (sola; con un cambio de estado va en su apunte) --- */
  if (cambio.nota !== undefined && cambio.nota !== fila.nota) {
    actualizar.nota = cambio.nota
    if (!cambio.estado || cambio.estado === estadoActual) apuntes.push({ envioPropuestoId: id, quien, accion: 'nota', nota: cambio.nota })
  }

  /* --- ajuste (de la IA o a mano), recalculado con la aritmética --- */
  if (cambio.aplicarAjuste) {
    const estadoFinal = (actualizar.estado as EstadoEnvioPropuesto | undefined) ?? estadoActual
    if (!ESTADOS_DECIDIENDO.includes(estadoFinal)) throw new ErrorDeEnvio('Un envío que ya está en preparación, enviado o cerrado no se ajusta.', 409)
    // Lo hablado manda: si hay líneas congeladas, el ajuste va sobre ellas
    const congeladas = actualizar.lineas_aceptadas !== undefined ? (actualizar.lineas_aceptadas as LineaPlan[]) : fila.lineas_aceptadas == null ? null : lista<LineaPlan>(fila.lineas_aceptadas)
    const sobre = congeladas ?? lista<LineaPlan>(fila.lineas)
    const contexto = await contextoDeEnvio(service, fila, hoy)
    const r = aplicarAjusteALineas(sobre, cambio.aplicarAjuste, hoy, contexto)
    if (!r.ok) throw new ErrorDeEnvio(`No se aplica: ${r.motivo}.`, 422)
    if (congeladas) actualizar.lineas_aceptadas = r.lineas
    else {
      actualizar.lineas = r.lineas
      const cifras = cifrasDeLineas(r.lineas)
      actualizar.unidades = cifras.unidades
      actualizar.cajas_estimadas = cifras.cajasEstimadas
    }
    const previos = lista<AjusteIa>(fila.ajustes_aplicados).filter((a) => a.sku !== cambio.aplicarAjuste!.sku)
    actualizar.ajustes_aplicados = [...previos, cambio.aplicarAjuste]
    apuntes.push({ envioPropuestoId: id, quien, accion: 'ajuste_ia', nota: cambio.aplicarAjuste.motivo || null, datos: { ajuste: cambio.aplicarAjuste, antes: r.antes, despues: r.despues } })
  }

  if (Object.keys(actualizar).length === 0) {
    return { envio: (await aGuardados(service, [fila], hoy))[0], aviso: 'No había nada que cambiar.' }
  }

  actualizar.version = version + 1
  actualizar.actualizado_at = ahora
  const { data: guardada, error } = await service
    .from('fba_envios_propuestos')
    .update(actualizar)
    .eq('id', id)
    .eq('version', version)
    .select(COLUMNAS_ENVIO)
  if (error) {
    if (faltaLaTabla(error)) throw new ErrorDeEnvio(AVISO_316, 409, { migracion316: false })
    throw error
  }
  const filas = (guardada ?? []) as unknown as FilaEnvioPropuesto[]
  if (filas.length === 0) throw new ErrorDeEnvio('Alguien acaba de cambiar este envío. Recarga para ver lo último.', 409, { conflicto: true })

  for (const extra of extrasTrasGuardar) await extra()
  await apuntarEnHistorial(service, apuntes)
  invalidarCaches(fila.client_id)
  return { envio: (await aGuardados(service, filas, hoy))[0], aviso }
}

/* =============================================================================================
 * Convertir en remesa (§4.2 + D20)
 * ============================================================================================= */

/** El mercado con el que nace la remesa del cliente (D20): su última enviada o cerrada, o la región. Nunca el de la lectura */
export async function mercadoDeRemesaDeCliente(service: Servicio, clienteId: string): Promise<string> {
  const [{ data: ultima }, { data: conexion }] = await Promise.all([
    service
      .from('fba_remesas')
      .select('marketplace_id')
      .eq('client_id', clienteId)
      .in('estado', ['enviada', 'cerrada'])
      .not('marketplace_id', 'is', null)
      .order('fecha_envio', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    service.from('amazon_connections').select('region').eq('client_id', clienteId).eq('is_active', true).limit(1).maybeSingle(),
  ])
  const region = (conexion as { region: string | null } | null)?.region?.toLowerCase() ?? null
  const r = region === 'eu' || region === 'na' || region === 'fe' ? region : null
  return mercadoDeRemesa((ultima as { marketplace_id: string | null } | null)?.marketplace_id ?? null, r)
}

/** ¿Trabaja este cliente con base de datos de referencias? (D40) Filas en fba_catalogo, o «shoesf» en el nombre */
export async function tieneCatalogo(service: Servicio, clienteId: string, nombre: string | null | undefined): Promise<boolean> {
  if (esClienteConCatalogo(nombre)) return true
  const { count, error } = await service.from('fba_catalogo').select('id', { count: 'exact', head: true }).eq('client_id', clienteId)
  if (error) return false
  return (count ?? 0) > 0
}

const NIVEL_DE_PRIORIDAD: Record<Prioridad, 'alta' | 'media' | 'baja'> = {
  tarde: 'alta', urgente: 'alta', esta_semana: 'media', proximas_2: 'media', este_mes: 'baja', mas_adelante: 'baja',
}

/** Puro: «Reposición · semana 49 (sale antes del 13 dic)» */
export function nombreDeRemesaPropuesta(salirAntesDe: string): string {
  return `Reposición · semana ${semanaIso(salirAntesDe).semana} (sale antes del ${fechaCorta(salirAntesDe)})`
}

/** Puro: las líneas que van a la remesa (lo hablado si lo hay), sin repetidas ni a cero */
export function lineasParaRemesa(
  lineas: LineaPlan[],
  catalogo: Map<string, { ref: string; nombre: string; talla: string; ean: string | null; fnsku: string | null; asin: string | null }>,
): LineaRemesaNueva[] {
  const porSku = new Map<string, LineaRemesaNueva>()
  for (const l of lineas) {
    const unidades = Math.round(l.cantidad)
    if (!l.sku || !(unidades > 0)) continue
    const previa = porSku.get(l.sku)
    if (previa) {
      previa.unidades += unidades
      continue
    }
    const f = catalogo.get(l.sku)
    // Como la propuesta con IA (propuesta-ia.ts): lo del catálogo manda para referencia, nombre, talla y EAN
    porSku.set(l.sku, f
      ? { sku: l.sku, unidades, referencia: f.ref, nombre: f.nombre, variante: f.talla, ean: f.ean, fnsku: f.fnsku ?? l.fnsku, asin: f.asin ?? l.asin }
      : { sku: l.sku, unidades, referencia: null, nombre: l.nombre, variante: l.talla, ean: null, fnsku: l.fnsku, asin: l.asin })
  }
  return [...porSku.values()]
}

/** Puro: el AnalisisIa (analisis-ia.ts) de una remesa que nace del planificador */
export function analisisDelPlan(
  envio: Pick<EnvioPropuestoGuardado, 'id' | 'porque' | 'ia' | 'provisional'>,
  lineas: LineaPlan[],
  contexto: ContextoEnvio,
  generadaEn: string,
): AnalisisIa {
  const ia = envio.ia
  const lineasAnalizadas: AnalisisIa['lineas'] = {}
  for (const l of lineas) {
    if (!(l.cantidad > 0)) continue
    const conf = l.ritmo?.confianza
    lineasAnalizadas[l.sku] = {
      motivo: (l.porque || '').slice(0, 300),
      prioridad: NIVEL_DE_PRIORIDAD[l.prioridad] ?? 'media',
      confianza: conf === 'alta' || conf === 'media' || conf === 'baja' ? conf : null,
      origen: 'calculo',
      base: Math.max(0, Math.round(l.necesidad ?? l.cantidad)),
      propuestas: Math.max(0, Math.round(l.cantidad)),
    }
  }
  const notas = ['Nace de un envío propuesto por el planificador de reposición: las cantidades salen de la aritmética.']
  if (envio.provisional) notas.push('El plan era provisional: las ventas no estaban al día.')
  return {
    version: 1,
    generadaEn,
    ventasHasta: contexto.ventasHasta,
    modelo: ia?.modelo ?? null,
    usada: !!ia && !ia.aviso,
    aviso: ia?.aviso ?? null,
    resumen: ia?.resumen || envio.porque.join(' ') || null,
    estrategia: null,
    riesgos: (ia?.avisos ?? []).filter((a) => a.gravedad !== 'info').map((a) => a.texto).slice(0, 12),
    dudas: [],
    notas: [...notas, ...envio.porque].slice(0, 12),
    parametros: {
      coberturaObjetivo: contexto.ajustes.coberturaObjetivo,
      plazoDias: contexto.plazo.hastaLaVenta,
      margenDias: contexto.plazo.margen,
      multiplo: contexto.ajustes.multiploCaja ?? 1,
      minimoLinea: contexto.ajustes.minLinea,
      topeUnidades: null,
      notas: '',
    },
    lineas: lineasAnalizadas,
    // Lo que el plan dejó fuera de este envío, con su porqué («Fuera del envío» del panel)
    descartadas: lineas
      .filter((l) => !(l.cantidad > 0))
      .slice(0, 200)
      .map((l) => ({ sku: l.sku, nombre: l.nombre, motivo: (l.porque || l.fuera || '').slice(0, 300), base: Math.max(0, Math.round(l.necesidad ?? 0)) })),
  }
}

/**
 * «Convertir en remesa»: crea la remesa en borrador con lo hablado (o el plan) y la enlaza.
 *
 * Sin duplicados (D20): primero se RECLAMA la fila con un update condicional (sigue por decidir, sin remesa y
 * en la versión leída); solo si vuelve una fila se crea la remesa. Si crear falla, el estado se deshace.
 * Idempotente: si ya tiene remesa, devuelve esa.
 */
export async function convertirEnRemesa(
  service: Servicio,
  sesion: Pick<SesionFba, 'userId' | 'actor' | 'clientesEditables'>,
  id: string,
  hoy: string,
  vista?: { version?: number | null; huella?: string | null },
): Promise<{ remesaId: string; yaExistia: boolean; analisisGuardado: boolean }> {
  const fila = await leerFilaEnvio(service, id)
  if (!fila || !puedeEditar(sesion as SesionFba, fila.client_id)) throw new ErrorDeEnvio('Ese envío propuesto ya no existe', 404)
  if (fila.remesa_id) return { remesaId: fila.remesa_id, yaExistia: true, analisisGuardado: false }

  const estadoPrevio = fila.estado as EstadoEnvioPropuesto
  const permiso = puedeCambiar(estadoPrevio, 'en_preparacion', 'agencia')
  if (!permiso.ok) throw new ErrorDeEnvio(permiso.motivo, 409)

  const [envio] = await aGuardados(service, [fila], hoy)
  const lineasPlan = envio.lineasAceptadas ?? envio.lineas
  const propuestas = lineasPlan.filter((l) => l.cantidad > 0)
  if (propuestas.length === 0) throw new ErrorDeEnvio('Este envío no tiene ninguna referencia con unidades: no hay nada que convertir.', 409)
  // A2.1: se convierte lo que la persona tenía en pantalla. Si el plan recalculó las líneas (o alguien las cambió) entre medias, no se convierte a ciegas
  if (vista && ((typeof vista.version === 'number' && vista.version !== (fila.version ?? 0)) || (typeof vista.huella === 'string' && vista.huella !== huellaLineas(lineasPlan)))) {
    throw new ErrorDeEnvio('Las líneas de este envío han cambiado desde que lo abriste (el plan se ha recalculado). Recarga para ver lo último antes de convertirlo.', 409, { conflicto: true, envio })
  }

  /* --- 1) Reclamar la fila --- */
  const version = fila.version ?? 0
  const ahora = new Date().toISOString()
  const { data: reclamada, error: errReclamar } = await service
    .from('fba_envios_propuestos')
    .update({ estado: 'en_preparacion', version: version + 1, estado_cambiado_at: ahora, estado_cambiado_por: sesion.userId, actualizado_at: ahora })
    .eq('id', id)
    .eq('version', version)
    .in('estado', ESTADOS_DECIDIENDO as EstadoEnvioPropuesto[])
    .is('remesa_id', null)
    .select('id')
  if (errReclamar) {
    if (faltaLaTabla(errReclamar)) throw new ErrorDeEnvio(AVISO_316, 409, { migracion316: false })
    throw errReclamar
  }
  if (((reclamada as unknown[] | null) ?? []).length === 0) {
    // Otro lo ha reclamado entre medias: si ya tiene remesa, esa es la respuesta
    const otra = await leerFilaEnvio(service, id)
    if (otra?.remesa_id) return { remesaId: otra.remesa_id, yaExistia: true, analisisGuardado: false }
    throw new ErrorDeEnvio('Alguien acaba de cambiar este envío. Recarga para ver lo último.', 409, { conflicto: true })
  }

  const deshacer = async () => {
    await service
      .from('fba_envios_propuestos')
      .update({ estado: estadoPrevio, version, estado_cambiado_at: fila.estado_cambiado_at, actualizado_at: new Date().toISOString() })
      .eq('id', id)
      .eq('estado', 'en_preparacion')
      .is('remesa_id', null)
      .then(() => undefined, (e: unknown) => console.error('[fba] no se ha podido deshacer la conversión:', e))
  }

  /* --- 2) Crear la remesa --- */
  let remesa: Awaited<ReturnType<typeof crearRemesa>>
  try {
    const [mercado, contexto, catalogo] = await Promise.all([
      mercadoDeRemesaDeCliente(service, fila.client_id),
      contextoDeEnvio(service, fila, hoy),
      listarCatalogo(service, fila.client_id).catch(() => ({ filas: [], sinMigrar: true })),
    ])
    const indice = construirIndice(catalogo.filas)
    const fichas = new Map<string, { ref: string; nombre: string; talla: string; ean: string | null; fnsku: string | null; asin: string | null }>()
    for (const l of propuestas) {
      const f = indice.porSku.get(l.sku)
      if (f) fichas.set(l.sku, { ref: f.ref, nombre: f.nombre, talla: f.talla, ean: f.ean, fnsku: f.fnsku, asin: f.asin })
    }
    const lineas = lineasParaRemesa(propuestas, fichas)
    const salida = envio.salirAntesDe > hoy ? envio.salirAntesDe : hoy
    remesa = await crearRemesa(
      service,
      sesion,
      {
        clienteId: fila.client_id,
        marketplaceId: mercado,
        nombre: nombreDeRemesaPropuesta(envio.salirAntesDe).slice(0, 120),
        fechaEnvio: salida,
        referenciaEnvio: null,
        nota: envio.nota,
        lineas,
        analisisIa: analisisDelPlan(envio, lineasPlan, contexto, ahora),
      },
      { envioPropuestoId: id, extraAnalisis: { origen: 'planificador', envioPropuestoId: id } },
    )
  } catch (error) {
    await deshacer()
    if (error instanceof ErrorDeRemesa && error.codigo === 'ya_convertido') {
      // El índice único de la 316 dice que ya hay una remesa para este envío: se enlaza esa
      const { data: existente } = await service.from('fba_remesas').select('id').eq('envio_propuesto_id', id).maybeSingle()
      const remesaId = (existente as { id: string } | null)?.id
      if (remesaId) {
        await service.from('fba_envios_propuestos').update({ estado: 'en_preparacion', remesa_id: remesaId }).eq('id', id).is('remesa_id', null)
        return { remesaId, yaExistia: true, analisisGuardado: false }
      }
    }
    throw error
  }

  /* --- 3) Enlazar --- */
  // Con el estado otra vez: si una pasada la ha tomado por huérfana entre medias (la ha pasado a «hablado»), vuelve a
  // «en preparación»; si no, quedaría un hablado con remesa cuyas líneas cuentan dos veces como llegada
  const { data: enlazada, error: errEnlace } = await service
    .from('fba_envios_propuestos')
    .update({ remesa_id: remesa.id, estado: 'en_preparacion' })
    .eq('id', id)
    .is('remesa_id', null)
    .select('id')
  if (errEnlace) {
    // Sin enlace la remesa sería un duplicado esperando a pasar: se borra y se deshace
    await service.from('fba_remesas').delete().eq('id', remesa.id)
    await deshacer()
    throw errEnlace
  }
  if (((enlazada as unknown[] | null) ?? []).length === 0) {
    // Otro la ha enlazado entre medias: la suya manda y esta sobra
    await service.from('fba_remesas').delete().eq('id', remesa.id)
    const otra = await leerFilaEnvio(service, id)
    if (otra?.remesa_id) return { remesaId: otra.remesa_id, yaExistia: true, analisisGuardado: false }
    await deshacer()
    throw new ErrorDeEnvio('Alguien acaba de cambiar este envío. Recarga para ver lo último.', 409, { conflicto: true })
  }

  /* --- 4) Rastro en las dos tablas --- */
  await Promise.all([
    apuntarEnHistorial(service, {
      envioPropuestoId: id,
      quien: sesion.userId,
      accion: 'convertir',
      de: estadoPrevio,
      a: 'en_preparacion',
      datos: { remesaId: remesa.id, referencias: remesa.lineas, unidades: propuestas.reduce((s, l) => s + Math.round(l.cantidad), 0), desdeLoHablado: envio.lineasAceptadas !== null },
    }),
    registrarEnHistorial(
      {
        remesaId: remesa.id,
        actor: 'agencia',
        userId: sesion.userId,
        accion: 'creada',
        hasta: 'borrador',
        detalle: { origen: 'planificador', envioPropuestoId: id, clave: fila.clave, referencias: remesa.lineas },
      },
      service,
    ),
  ])
  invalidarCaches(fila.client_id)
  return { remesaId: remesa.id, yaExistia: false, analisisGuardado: remesa.analisisGuardado }
}

/* =============================================================================================
 * La remesa cambia → el envío propuesto la sigue (D19)
 * ============================================================================================= */

/**
 * Aplica `efectoDeRemesa` al envío propuesto enlazado a una remesa. Sin la 316 (o sin envío enlazado) no hace
 * nada. No lanza: es un efecto secundario del cambio de la remesa, que ya se ha guardado.
 * Lo hace el sistema: NO sube `version` (solo las acciones de una persona sobre el envío la suben).
 */
export async function seguirARemesa(
  service: Servicio,
  remesaId: string,
  evento: 'enviada' | 'vuelve_a_lista' | 'borrada',
  quien: string | null,
  envioPropuestoId?: string | null,
): Promise<{ envioPropuestoId: string; de: EstadoEnvioPropuesto; a: EstadoEnvioPropuesto } | null> {
  try {
    let q = service.from('fba_envios_propuestos').select('id, estado, remesa_id, client_id')
    q = envioPropuestoId ? q.eq('id', envioPropuestoId) : q.eq('remesa_id', remesaId)
    const { data, error } = await q.limit(1).maybeSingle()
    if (error) {
      if (!faltaLaTabla(error)) console.error('[fba] no se ha podido leer el envío propuesto de la remesa:', error.message)
      return null
    }
    const envio = data as { id: string; estado: EstadoEnvioPropuesto; remesa_id: string | null; client_id: string } | null
    if (!envio) return null
    // Buscado por su id: solo si sigue enlazado a ESTA remesa (o el borrado ya le quitó el enlace)
    if (envio.remesa_id && envio.remesa_id !== remesaId) return null
    const a = efectoDeRemesa(evento, envio.estado)
    if (!a) return null

    const ahora = new Date().toISOString()
    const cambios: Record<string, unknown> = { estado: a, estado_cambiado_at: ahora, estado_cambiado_por: quien, actualizado_at: ahora }
    if (evento === 'borrada') cambios.remesa_id = null
    const { data: movido, error: errMover } = await service
      .from('fba_envios_propuestos')
      .update(cambios)
      .eq('id', envio.id)
      .eq('estado', envio.estado)
      .select('id')
    if (errMover) throw errMover
    if (((movido as unknown[] | null) ?? []).length === 0) return null

    await apuntarEnHistorial(service, {
      envioPropuestoId: envio.id,
      quien,
      accion: evento === 'borrada' ? 'remesa_borrada' : evento === 'enviada' ? 'remesa_enviada' : 'remesa_vuelve_a_lista',
      de: envio.estado,
      a,
      nota: evento === 'borrada' ? 'remesa_borrada' : null,
      datos: { remesaId },
    })
    invalidarCaches(envio.client_id)
    return { envioPropuestoId: envio.id, de: envio.estado, a }
  } catch (error) {
    console.error('[fba] el envío propuesto no ha seguido a su remesa:', error instanceof Error ? error.message : error)
    return null
  }
}

/** Puro: qué evento de remesa es un cambio de estado (para seguirARemesa). null = ninguno */
export function eventoDeCambioDeRemesa(desde: EstadoRemesa, hasta: EstadoRemesa): 'enviada' | 'vuelve_a_lista' | null {
  // Salir hacia Amazon (o cerrarse sin haber pasado por «enviada») es que el envío ya se ha hecho
  if ((hasta === 'enviada' || hasta === 'cerrada') && desde !== 'enviada' && desde !== 'cerrada') return 'enviada'
  if (desde === 'enviada' && hasta === 'lista') return 'vuelve_a_lista'
  return null
}

/** La sesión es de la agencia (D26: el rol cliente no ve envíos propuestos) */
export function esDeLaAgencia(sesion: Pick<SesionFba, 'actor' | 'role'>): boolean {
  return sesion.actor === 'agencia' && sesion.role !== 'cliente'
}

/* =============================================================================================
 * Para las rutas de /api/fba/envios-propuestos/**
 * ============================================================================================= */

/**
 * La sesión de la agencia o la respuesta de error, lista. El rol `cliente` recibe 403 (D26): los envíos
 * propuestos hablan de prioridades internas, € en juego y responsables.
 */
export async function sesionDeAgencia(nivel: 'ver' | 'editar', clienteId?: string | null): Promise<SesionFba | NextResponse> {
  const sesion = await requireFbaAccess(nivel, clienteId ?? undefined)
  if (sesion instanceof NextResponse) return sesion
  if (!esDeLaAgencia(sesion)) return fail(403, 'Los envíos propuestos los gestiona Liberty Seller')
  return sesion
}

/** Un ErrorDeEnvio (o ErrorDeRemesa) como respuesta JSON; null si es otro error (lo traduce errorResponse) */
export function respuestaDeErrorDeEnvio(error: unknown): NextResponse | null {
  if (error instanceof ErrorDeEnvio) return NextResponse.json({ error: error.message, ...(error.datos ?? {}) }, { status: error.estado })
  if (error instanceof ErrorDeRemesa) return NextResponse.json({ error: error.message }, { status: error.estado })
  return null
}
