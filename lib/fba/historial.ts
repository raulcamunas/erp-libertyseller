import { createServiceClient } from '@/lib/supabase/service'

/**
 * EL HISTORIAL DE UNA REMESA: QUIÉN HIZO QUÉ Y CUÁNDO.
 * ====================================================
 * SOLO SERVIDOR (las funciones de escribir y leer). Las de texto son puras y se prueban en
 * historial.prueba.ts.
 *
 * Antes solo quedaban sellos sueltos —aprobada_por, reabierta_por…— que se sobrescribían. Ahora cada ruta
 * que cambia algo deja una fila en fba_remesa_historial (migración 309): estado, líneas, cajas, enlace,
 * etiquetas, Excel y lo que hace el cliente desde su enlace, con la IP cuando no hay usuario.
 *
 * ============ NUNCA TUMBA EL TRABAJO ============
 *
 * Registrar es un apunte, no parte de la operación: si la tabla no existe todavía (la 309 se lanza a mano)
 * o la escritura falla, se avisa en el registro del servidor y la ruta sigue. Perder un apunte es malo;
 * dejar a alguien sin poder guardar sus cajas por un apunte es peor.
 *
 * ============ LOS GUARDADOS AUTOMÁTICOS SE AGRUPAN ============
 *
 * El encaje y la propuesta del cliente se guardan solos a cada cambio. Una fila por guardado serían cien
 * «guardó las cajas» en una tarde. Con `agruparMinutos`, si el mismo actor repitió la misma acción hace
 * menos de eso, se actualiza esa fila (hora, detalle y `veces`) en vez de meter otra.
 */

export type ActorDeHistorial = 'agencia' | 'cliente' | 'enlace' | 'sistema'

export type AccionDeHistorial =
  | 'creada'
  | 'estado'
  | 'lineas'
  | 'cajas'
  | 'enlace_creado'
  | 'enlace_revocado'
  | 'enlace_abierto'
  | 'propuesta_enviada'
  | 'propuesta_cliente'
  | 'propuesta_aceptada'
  | 'propuesta_devuelta'
  | 'etiquetas'
  | 'manifiesto'
  | 'embalaje'
  | 'encaje_terminado'
  | 'envio_amazon'
  | 'transporte_aceptado'

export interface ApunteDeHistorial {
  remesaId: string
  actor: ActorDeHistorial
  accion: AccionDeHistorial
  userId?: string | null
  enlaceId?: string | null
  desde?: string | null
  hasta?: string | null
  detalle?: Record<string, unknown>
  ip?: string | null
  /** Si el mismo actor hizo lo mismo hace menos de estos minutos, se actualiza esa fila en vez de meter otra */
  agruparMinutos?: number
}

export interface EventoDeHistorial {
  id: string
  at: string
  actor: ActorDeHistorial
  userId: string | null
  /** El nombre de quien lo hizo, si es un usuario del ERP */
  autor: string | null
  enlaceId: string | null
  accion: AccionDeHistorial
  desde: string | null
  hasta: string | null
  detalle: Record<string, unknown>
  ip: string | null
  veces: number
}

type ClienteDeBase = ReturnType<typeof createServiceClient>

const faltaLaTabla = (e: { code?: string } | null): boolean => e?.code === '42P01' || e?.code === 'PGRST205' || e?.code === '42703'

/** Deja el apunte. No lanza nunca */
export async function registrarEnHistorial(a: ApunteDeHistorial, service: ClienteDeBase = createServiceClient(), ahora = new Date()): Promise<void> {
  try {
    const iso = ahora.toISOString()
    if (a.agruparMinutos && a.agruparMinutos > 0) {
      const desde = new Date(ahora.getTime() - a.agruparMinutos * 60_000).toISOString()
      let q = service
        .from('fba_remesa_historial')
        .select('id, veces')
        .eq('remesa_id', a.remesaId)
        .eq('accion', a.accion)
        .eq('actor', a.actor)
        .gte('at', desde)
      q = a.userId ? q.eq('user_id', a.userId) : q.is('user_id', null)
      q = a.enlaceId ? q.eq('enlace_id', a.enlaceId) : q.is('enlace_id', null)
      const { data: previa, error: errPrevia } = await q.order('at', { ascending: false }).limit(1).maybeSingle()
      if (errPrevia) {
        if (faltaLaTabla(errPrevia)) return
        throw errPrevia
      }
      if (previa) {
        const p = previa as { id: string; veces: number | null }
        const { error } = await service
          .from('fba_remesa_historial')
          .update({ at: iso, detalle: a.detalle ?? {}, veces: (p.veces ?? 1) + 1, ip: a.ip ?? null })
          .eq('id', p.id)
        if (error && !faltaLaTabla(error)) throw error
        return
      }
    }
    const { error } = await service.from('fba_remesa_historial').insert({
      remesa_id: a.remesaId,
      at: iso,
      actor: a.actor,
      user_id: a.userId ?? null,
      enlace_id: a.enlaceId ?? null,
      accion: a.accion,
      desde: a.desde ?? null,
      hasta: a.hasta ?? null,
      detalle: a.detalle ?? {},
      ip: a.ip ?? null,
    })
    if (error && !faltaLaTabla(error)) throw error
  } catch (error) {
    console.error('[fba] no se ha podido apuntar en el historial:', error instanceof Error ? error.message : error)
  }
}

/** El historial de una remesa, de lo más nuevo a lo más viejo. [] si la 309 no está lanzada */
export async function historialDe(remesaId: string, service: ClienteDeBase = createServiceClient(), limite = 200): Promise<{ eventos: EventoDeHistorial[]; sinMigrar: boolean }> {
  const { data, error } = await service
    .from('fba_remesa_historial')
    .select('id, at, actor, user_id, enlace_id, accion, desde, hasta, detalle, ip, veces')
    .eq('remesa_id', remesaId)
    .order('at', { ascending: false })
    .limit(limite)
  if (error) {
    if (faltaLaTabla(error)) return { eventos: [], sinMigrar: true }
    throw error
  }
  const filas = (data ?? []) as Array<{
    id: string
    at: string
    actor: ActorDeHistorial
    user_id: string | null
    enlace_id: string | null
    accion: AccionDeHistorial
    desde: string | null
    hasta: string | null
    detalle: Record<string, unknown> | null
    ip: string | null
    veces: number | null
  }>
  // Los nombres de una vez, no uno por evento
  const ids = [...new Set(filas.map((f) => f.user_id).filter((x): x is string => !!x))]
  const nombres = new Map<string, string>()
  if (ids.length > 0) {
    const { data: perfiles } = await service.from('profiles').select('id, full_name, email').in('id', ids)
    for (const p of (perfiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) {
      nombres.set(p.id, p.full_name?.trim() || p.email?.split('@')[0] || 'Alguien')
    }
  }
  return {
    sinMigrar: false,
    eventos: filas.map((f) => ({
      id: f.id,
      at: f.at,
      actor: f.actor,
      userId: f.user_id,
      autor: f.user_id ? nombres.get(f.user_id) ?? null : null,
      enlaceId: f.enlace_id,
      accion: f.accion,
      desde: f.desde,
      hasta: f.hasta,
      detalle: f.detalle ?? {},
      ip: f.ip,
      veces: f.veces ?? 1,
    })),
  }
}

/* ------------------------------------------------------------------ */
/* Cómo se cuenta en pantalla (puro)                                   */
/* ------------------------------------------------------------------ */

const NOMBRE_ESTADO: Record<string, string> = {
  borrador: 'Borrador',
  aprobada: 'Aprobada',
  encajando: 'Encajando',
  lista: 'Lista para enviar',
  enviada: 'Enviada',
  cerrada: 'Cerrada',
}

export type TonoDeEvento = 'info' | 'ok' | 'aviso' | 'peligro' | 'neutro'

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const n0 = (x: number) => x.toLocaleString('es-ES')

/** Quién, dicho para una persona: «Ana (agencia)», «El cliente, por su enlace» */
export function quienLoHizo(e: Pick<EventoDeHistorial, 'actor' | 'autor'>): string {
  if (e.actor === 'enlace') return 'El cliente, desde su enlace'
  if (e.actor === 'sistema') return 'El sistema'
  if (e.actor === 'cliente') return e.autor ? `${e.autor} (cliente)` : 'El cliente'
  return e.autor ?? 'Liberty Seller'
}

/** El titular de un evento: una frase corta, sin el quién */
export function tituloDeEvento(e: Pick<EventoDeHistorial, 'accion' | 'desde' | 'hasta' | 'detalle' | 'veces'>): string {
  const d = e.detalle ?? {}
  switch (e.accion) {
    case 'creada':
      return 'Creó la propuesta'
    case 'estado': {
      const hasta = e.hasta ? NOMBRE_ESTADO[e.hasta] ?? e.hasta : '¿?'
      const desde = e.desde ? NOMBRE_ESTADO[e.desde] ?? e.desde : null
      if (e.hasta === 'aprobada' && e.desde === 'borrador') return 'Aprobó el envío'
      if (e.hasta === 'borrador') return 'Volvió a borrador'
      return desde ? `Pasó de «${desde}» a «${hasta}»` : `Pasó a «${hasta}»`
    }
    case 'lineas': {
      const refs = num(d.referencias)
      const uds = num(d.unidades)
      return refs !== null && uds !== null ? `Cambió las referencias (${n0(refs)} ref. · ${n0(uds)} uds.)` : 'Cambió las referencias'
    }
    case 'cajas': {
      const cajas = num(d.cajas)
      const base = cajas !== null ? `Guardó las cajas (${n0(cajas)} caja${cajas === 1 ? '' : 's'})` : 'Guardó las cajas'
      return e.veces > 1 ? `${base} · ${e.veces} guardados` : base
    }
    case 'enlace_creado':
      return 'Creó el enlace del cliente'
    case 'enlace_revocado':
      return 'Desactivó el enlace del cliente'
    case 'enlace_abierto':
      return e.veces > 1 ? `Abrió su enlace (${e.veces} veces)` : 'Abrió su enlace'
    case 'propuesta_enviada':
      return 'Mandó la propuesta al cliente'
    case 'propuesta_cliente': {
      const cambiadas = num(d.cambiadas) ?? 0
      const nuevas = num(d.nuevas) ?? 0
      const partes = [cambiadas ? `${cambiadas} cambiada${cambiadas === 1 ? '' : 's'}` : null, nuevas ? `${nuevas} nueva${nuevas === 1 ? '' : 's'}` : null].filter(Boolean)
      return partes.length ? `Tocó la propuesta (${partes.join(' · ')})` : 'Tocó la propuesta'
    }
    case 'propuesta_aceptada':
      return typeof d.nombre === 'string' && d.nombre ? `Aceptó la propuesta como «${d.nombre}»` : 'Aceptó la propuesta'
    case 'propuesta_devuelta':
      return 'Devolvió la propuesta al cliente'
    case 'etiquetas': {
      const n = num(d.etiquetas)
      return n !== null ? `Descargó ${n0(n)} etiqueta${n === 1 ? '' : 's'} FNSKU` : 'Descargó las etiquetas FNSKU'
    }
    case 'manifiesto':
      return 'Descargó el manifiesto para Amazon'
    case 'embalaje':
      return 'Descargó el Excel de embalaje'
    case 'encaje_terminado':
      return 'Terminó de encajar'
    case 'envio_amazon':
      return tituloDeEnvioAmazon(e.hasta, d)
    case 'transporte_aceptado': {
      const coste = num(d.coste)
      const quien = typeof d.nombre === 'string' && d.nombre ? ` como «${d.nombre}»` : ''
      return coste !== null ? `Aceptó el coste del transporte (${coste.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${typeof d.moneda === 'string' ? d.moneda : '€'})${quien}` : `Aceptó el coste del transporte${quien}`
    }
    default:
      return 'Hizo un cambio'
  }
}

export function tonoDeEvento(e: Pick<EventoDeHistorial, 'accion' | 'hasta'>): TonoDeEvento {
  if (e.accion === 'estado') {
    if (e.hasta === 'borrador') return 'aviso'
    if (e.hasta === 'aprobada' || e.hasta === 'lista' || e.hasta === 'enviada' || e.hasta === 'cerrada') return 'ok'
    return 'info'
  }
  if (e.accion === 'propuesta_aceptada' || e.accion === 'encaje_terminado' || e.accion === 'transporte_aceptado') return 'ok'
  if (e.accion === 'envio_amazon') {
    if (e.hasta === 'reparto_confirmado' || e.hasta === 'transporte_confirmado') return 'ok'
    if (e.hasta === 'cancelado' || e.hasta === 'cancelando' || e.hasta === 'cajas_reabiertas') return 'aviso'
    return 'info'
  }
  if (e.accion === 'enlace_revocado' || e.accion === 'propuesta_devuelta') return 'aviso'
  if (e.accion === 'propuesta_cliente') return 'info'
  return 'neutro'
}

/** El titular de un apunte del envío a Amazon por API (lib/fba/envio-amazon-motor.ts) */
function tituloDeEnvioAmazon(hasta: string | null, d: Record<string, unknown>): string {
  if (typeof d.error === 'string' && d.error) return `Amazon rechazó un paso del envío: ${d.error.slice(0, 140)}`
  switch (hasta) {
    case 'modo_api':
      return 'Pasó el envío a «Desde el ERP» (API de Amazon)'
    case 'modo_manual':
      return 'Pasó el envío a «Manual» (Seller Central)'
    case 'plan':
      return 'Mandó el envío a Amazon (plan creado)'
    case 'cajas_reenviadas':
      return 'Volvió a mandar las cajas a Amazon'
    case 'cajas_reabiertas':
      return 'Reabrió las cajas del envío a Amazon'
    case 'reparto_confirmando':
      return 'Confirmó el reparto por centros'
    case 'reparto_confirmado':
      return 'Amazon creó los envíos FBA'
    case 'transporte_cotizando':
      return 'Pidió la cotización del transporte'
    case 'transporte_elegido':
      return 'Cambió el transporte elegido'
    case 'transporte_confirmando':
      return 'Confirmó el transporte con Amazon'
    case 'transporte_confirmado':
      return 'Transporte confirmado: etiquetas disponibles'
    case 'cancelando':
      return 'Pidió cancelar el plan en Amazon'
    case 'cancelado':
      return 'Plan cancelado en Amazon'
    default:
      return 'Paso del envío a Amazon'
  }
}
