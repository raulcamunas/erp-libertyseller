import { createServiceClient } from '@/lib/supabase/service'
import { ajustesDesdeFila, type FilaReposicionConfig } from './ajustes-reposicion'
import {
  MEDIDAS_VACIAS,
  cajasDelEncaje,
  configParaPlazo,
  medidasDesdeEnvios,
  recibosSinDuplicar,
  type FilaConfigAlertas,
  type FilaReposicionSku,
  type ReciboFila,
} from './ajustes-api'
import { leerTodo } from './paginar'
import { faltaLaTabla } from './planificacion'
import { plazoDelCliente } from './planificador'
import type { AjustesReposicion, MedidasCliente, PlazoEtapas } from './plan-tipos'

/**
 * LAS LECTURAS DE LAS RUTAS DE AJUSTES DE REMESAS (paquete S6). SOLO SERVIDOR, SOLO LECTURA.
 * ==========================================================================================
 * Las comparten `/api/fba/alertas/config` (para «Confirmar plazos» y el plazo vigente), `/api/fba/reposicion-config` y
 * `/api/fba/reposicion-sku`. Lo que se decide con estos datos es puro y está en `ajustes-api.ts`.
 *
 * Todo degrada: sin la migración 316 (`fba_reposicion_config`, `fba_reposicion_sku`) se dice con `migracion316: false`; sin la
 * 291 la config se lee sin etapas; sin la 267, sin config.
 */

type Servicio = ReturnType<typeof createServiceClient>

export const FALTA_LA_MIGRACION_316 = 'Falta lanzar la migración 316 en Supabase: los ajustes de reposición todavía no se pueden guardar.'

const CON_ETAPAS = 'plazo_reposicion_dias, antelacion_dias, avisar, dias_preparacion, dias_transporte, dias_recepcion, margen_dias'
const SIN_ETAPAS = 'plazo_reposicion_dias, antelacion_dias, avisar'

/** Remesas enviadas o cerradas que se miran: las 8 de la cadencia, las 6 de transporte y recepción, y las de la caja deducida */
const REMESAS_QUE_SE_MIRAN = 40
/** De esas, en cuántas se buscan cajas del encaje */
const REMESAS_PARA_ENCAJE = 12

/* ------------------------------------------------------------------ */
/* Config de plazos (fba_alertas_config)                                */
/* ------------------------------------------------------------------ */

export interface ConfigAlertasLeida {
  fila: FilaConfigAlertas | null
  /** La 291 (etapas) no está lanzada: solo hay total */
  sinMigrar291: boolean
  /** La 267 no está lanzada: no hay ni tabla */
  falta267: boolean
}

export async function leerConfigAlertas(service: Servicio, clienteId: string): Promise<ConfigAlertasLeida> {
  let sinMigrar291 = false
  let r = await service.from('fba_alertas_config').select(CON_ETAPAS).eq('client_id', clienteId).maybeSingle()
  if (r.error && faltaLaTabla(r.error)) {
    sinMigrar291 = true
    r = (await service.from('fba_alertas_config').select(SIN_ETAPAS).eq('client_id', clienteId).maybeSingle()) as typeof r
  }
  if (r.error) {
    if (faltaLaTabla(r.error)) return { fila: null, sinMigrar291: true, falta267: true }
    throw r.error
  }
  return { fila: (r.data as unknown as FilaConfigAlertas | null) ?? null, sinMigrar291, falta267: false }
}

/* ------------------------------------------------------------------ */
/* Ajustes del planificador (fba_reposicion_config, 316)                */
/* ------------------------------------------------------------------ */

export async function leerFilaReposicion(service: Servicio, clienteId: string): Promise<{ fila: FilaReposicionConfig | null; migracion316: boolean }> {
  const { data, error } = await service.from('fba_reposicion_config').select('*').eq('client_id', clienteId).maybeSingle()
  if (error) {
    if (faltaLaTabla(error)) return { fila: null, migracion316: false }
    throw error
  }
  return { fila: (data as FilaReposicionConfig | null) ?? null, migracion316: true }
}

/* ------------------------------------------------------------------ */
/* Remesas enviadas, Receipts y medidas                                 */
/* ------------------------------------------------------------------ */

export interface RemesaEnviada {
  id: string
  fechaEnvio: string
  referenciaEnvio: string | null
  unidades: number
  lineas: Array<{ sku: string; unidades: number }>
}

/** Las remesas enviadas o cerradas del cliente con fecha de envío, de la más reciente a la más vieja, con sus líneas */
export async function leerRemesasEnviadas(service: Servicio, clienteId: string, limite = REMESAS_QUE_SE_MIRAN): Promise<RemesaEnviada[]> {
  const { data, error } = await service
    .from('fba_remesas')
    .select('id, fecha_envio, referencia_envio')
    .eq('client_id', clienteId)
    .in('estado', ['enviada', 'cerrada'])
    .not('fecha_envio', 'is', null)
    .order('fecha_envio', { ascending: false })
    .order('id', { ascending: true })
    .limit(limite)
  if (error) throw error
  const remesas = (data ?? []) as Array<{ id: string; fecha_envio: string; referencia_envio: string | null }>
  if (remesas.length === 0) return []

  const lineas = await leerTodo<{ remesa_id: string; sku: string; unidades: number }>((a, b) =>
    service
      .from('fba_remesa_lineas')
      .select('remesa_id, sku, unidades')
      .in('remesa_id', remesas.map((r) => r.id))
      .order('id', { ascending: true })
      .range(a, b),
  )
  const porRemesa = new Map<string, Array<{ sku: string; unidades: number }>>()
  for (const l of lineas) {
    const lista = porRemesa.get(l.remesa_id) ?? []
    lista.push({ sku: l.sku, unidades: Number(l.unidades) || 0 })
    porRemesa.set(l.remesa_id, lista)
  }
  return remesas.map((r) => {
    const ls = porRemesa.get(r.id) ?? []
    return {
      id: r.id,
      fechaEnvio: String(r.fecha_envio).slice(0, 10),
      referenciaEnvio: r.referencia_envio?.trim() || null,
      unidades: ls.reduce((s, l) => s + l.unidades, 0),
      lineas: ls,
    }
  })
}

/** Los Receipts del libro de esos números de envío (índice `fba_movimientos_referencia_idx`), sin la copia de cada mercado */
export async function leerRecibos(service: Servicio, referencias: string[]): Promise<Map<string, Array<{ fecha: string; cantidad: number }>>> {
  const refs = [...new Set(referencias.filter(Boolean))]
  if (refs.length === 0) return new Map()
  const filas = await leerTodo<{ referencia: string; marketplace_id: string; fecha: string; cantidad: number }>((a, b) =>
    service
      .from('fba_movimientos')
      .select('referencia, marketplace_id, fecha, cantidad')
      .eq('tipo', 'Receipts')
      .in('referencia', refs)
      .order('id', { ascending: true })
      .range(a, b),
  )
  return recibosSinDuplicar(
    filas.map((f): ReciboFila => ({ referencia: f.referencia, marketplaceId: f.marketplace_id, fecha: f.fecha, cantidad: Number(f.cantidad) })),
  )
}

/** Las medidas del cliente (transporte, recepción, cadencia). Si algo falla en la lectura, vacías: nunca tumba la ruta */
export async function leerMedidasCliente(service: Servicio, clienteId: string, hoy: string, remesas?: RemesaEnviada[]): Promise<MedidasCliente> {
  try {
    const lista = remesas ?? (await leerRemesasEnviadas(service, clienteId))
    if (lista.length === 0) return { ...MEDIDAS_VACIAS }
    const recibos = await leerRecibos(service, lista.slice(0, 12).map((r) => r.referenciaEnvio ?? ''))
    return medidasDesdeEnvios(lista, recibos, hoy)
  } catch (error) {
    console.error('[fba/ajustes] no se han podido medir los plazos del cliente', clienteId, error)
    return { ...MEDIDAS_VACIAS }
  }
}

/* ------------------------------------------------------------------ */
/* Cajas del encaje                                                     */
/* ------------------------------------------------------------------ */

/** La caja por referencia según el encaje de sus últimas remesas (cajas de una sola referencia). Sin cajas, vacío */
export async function leerCajasDelEncaje(service: Servicio, remesaIds: string[]): Promise<Map<string, number>> {
  const ids = remesaIds.slice(0, REMESAS_PARA_ENCAJE)
  if (ids.length === 0) return new Map()
  const { data: cajas, error } = await service.from('fba_cajas').select('id').in('remesa_id', ids)
  if (error) {
    if (faltaLaTabla(error)) return new Map()
    throw error
  }
  const cajaIds = ((cajas ?? []) as Array<{ id: string }>).map((c) => c.id)
  if (cajaIds.length === 0) return new Map()
  const contenido = await leerTodo<{ caja_id: string; sku: string; unidades: number }>((a, b) =>
    service.from('fba_caja_contenido').select('caja_id, sku, unidades').in('caja_id', cajaIds).order('id', { ascending: true }).range(a, b),
  )
  const porCaja = new Map<string, Array<{ sku: string; unidades: number }>>()
  for (const c of contenido) {
    const lista = porCaja.get(c.caja_id) ?? []
    lista.push({ sku: c.sku, unidades: Number(c.unidades) || 0 })
    porCaja.set(c.caja_id, lista)
  }
  return cajasDelEncaje([...porCaja.values()].map((contenido) => ({ contenido })))
}

/* ------------------------------------------------------------------ */
/* Ajustes de las referencias (fba_reposicion_sku, 316)                 */
/* ------------------------------------------------------------------ */

export async function leerFilasSku(service: Servicio, clienteId: string, skus?: string[]): Promise<{ filas: FilaReposicionSku[]; migracion316: boolean }> {
  try {
    const filas = await leerTodo<FilaReposicionSku>((a, b) => {
      let q = service
        .from('fba_reposicion_sku')
        .select('client_id, sku, unidades_caja, cobertura_dias, excluir, motivo, actualizado_at, actualizado_por')
        .eq('client_id', clienteId)
      if (skus && skus.length > 0) q = q.in('sku', skus)
      return q.order('sku', { ascending: true }).range(a, b)
    })
    return { filas, migracion316: true }
  } catch (error) {
    if (faltaLaTabla(error as { code?: string })) return { filas: [], migracion316: false }
    throw error
  }
}

/* ------------------------------------------------------------------ */
/* Todo junto: ajustes, medidas y plazo vigentes                        */
/* ------------------------------------------------------------------ */

export interface AjustesVigentes {
  ajustes: AjustesReposicion
  medidas: MedidasCliente
  plazo: PlazoEtapas
  /** La fila tal cual (lo puesto a mano; null = nada puesto) */
  guardado: FilaReposicionConfig | null
  config: ConfigAlertasLeida
  migracion316: boolean
}

/**
 * Los ajustes efectivos (manual > medido > partida), las medidas y el plazo por etapas del cliente (`plazoDelCliente`, el mismo
 * que usan el plan, las alertas y la propuesta a medida). `hoy` en España.
 */
export async function leerAjustesVigentes(service: Servicio, clienteId: string, hoy: string): Promise<AjustesVigentes> {
  const [repo, config, medidas] = await Promise.all([
    leerFilaReposicion(service, clienteId),
    leerConfigAlertas(service, clienteId),
    leerMedidasCliente(service, clienteId, hoy),
  ])
  const ajustes = ajustesDesdeFila(repo.fila, medidas)
  const plazo = plazoDelCliente(configParaPlazo(config.fila), medidas, hoy, { transporteUrgenteDias: ajustes.transporteUrgenteDias })
  return { ajustes, medidas, plazo, guardado: repo.fila, config, migracion316: repo.migracion316 }
}
