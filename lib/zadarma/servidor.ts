import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { leadDeLaLlamada, indiceDeTelefonos } from '@/lib/cold-calling/vinculos'
import { leerLeadsParaVincular } from '@/lib/cold-calling/vinculos-servidor'
import { ErrorDeZadarma, pedirZadarma } from './api'

/**
 * ZADARMA EN EL ERP — SERVIDOR (migración 326). SOLO SERVIDOR.
 *
 *   · El teléfono web de cada comercial: la llave de 72 h que da Zadarma para SU extensión (nunca la de otro).
 *   · Las llamadas: Zadarma avisa al acabar cada una (webhook) y se guardan en `rinkel_llamadas` con el id «zadarma:<pbx_call_id>», así el historial del lead, la
 *     transcripción, Mi rendimiento y los avisos de hitos las tratan igual que las de Rinkel. El lead se busca por el teléfono entre los leads de esa comercial.
 *   · Las grabaciones: `grabacion_id` = «zadarma:<call_id_with_rec>»; el enlace temporal se pide a Zadarma cuando alguien la escucha o se transcribe.
 */

export const PREFIJO = 'zadarma:'
const DIAS_DE_GRABACION = 90

export interface ExtensionDe {
  userId: string
  extension: string
  numero: string | null
}

export async function extensionDe(userId: string): Promise<ExtensionDe | null> {
  const { data, error } = await createServiceClient().from('zadarma_extensiones').select('user_id, extension, numero').eq('user_id', userId).eq('activa', true).maybeSingle()
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  const d = data as { user_id: string; extension: string; numero: string | null } | null
  return d ? { userId: d.user_id, extension: d.extension, numero: d.numero } : null
}

async function extensiones(): Promise<ExtensionDe[]> {
  const { data, error } = await createServiceClient().from('zadarma_extensiones').select('user_id, extension, numero').eq('activa', true)
  if (error) {
    if (isMissingSchema(error)) return []
    throw error
  }
  return ((data ?? []) as Array<{ user_id: string; extension: string; numero: string | null }>).map((d) => ({ userId: d.user_id, extension: d.extension, numero: d.numero }))
}

let pbx: { id: string; en: number } | null = null
/** El número de la centralita (el «606852» de «606852-100») */
export async function idDeCentralita(): Promise<string> {
  if (pbx && Date.now() - pbx.en < 6 * 3_600_000) return pbx.id
  const r = await pedirZadarma<{ pbx_id: number }>('/v1/pbx/internal/')
  pbx = { id: String(r.pbx_id), en: Date.now() }
  return pbx.id
}

const llaves = new Map<string, { key: string; en: number }>()
/** La llave del teléfono web de una comercial (dura 72 h; se renueva cada 24) */
export async function llaveDelTelefono(userId: string): Promise<{ key: string; sip: string; extension: string; numero: string | null } | null> {
  const ext = await extensionDe(userId)
  if (!ext) return null
  const sip = `${await idDeCentralita()}-${ext.extension}`
  const ya = llaves.get(sip)
  if (ya && Date.now() - ya.en < 24 * 3_600_000) return { key: ya.key, sip, extension: ext.extension, numero: ext.numero }
  const r = await pedirZadarma<{ key: string }>('/v1/webrtc/get_key/', { sip })
  llaves.set(sip, { key: r.key, en: Date.now() })
  return { key: r.key, sip, extension: ext.extension, numero: ext.numero }
}

/** Un número tal como lo manda Zadarma («525512345678», «+52 55…», «0034…») en internacional. Sin prefijo y con 10 cifras, México */
export function aInternacional(crudo: string | null | undefined): string | null {
  const t = String(crudo ?? '').trim()
  if (!t) return null
  let cifras = t.replace(/\D/g, '')
  if (cifras.startsWith('00')) cifras = cifras.slice(2)
  if (cifras.length === 10) return `+52${cifras}`
  return cifras.length >= 8 && cifras.length <= 15 ? `+${cifras}` : null
}

/** Lo que guarda un aviso de fin de llamada (NOTIFY_OUT_END saliente, NOTIFY_END entrante) */
export async function guardarFinDeLlamada(evento: 'NOTIFY_OUT_END' | 'NOTIFY_END', c: Record<string, string>): Promise<'guardada' | 'sin-comercial' | 'sin-id'> {
  const pbxCallId = c.pbx_call_id?.trim()
  if (!pbxCallId) return 'sin-id'
  const todas = await extensiones()
  const saliente = evento === 'NOTIFY_OUT_END'
  const ext = (c.internal || c.last_internal || '').trim()
  const numeroDelOtro = aInternacional(saliente ? c.destination : c.caller_id)
  const nuestro = saliente ? null : aInternacional(c.called_did)
  const dueno = todas.find((x) => x.extension === ext) ?? (nuestro ? todas.find((x) => x.numero === nuestro) : undefined)
  if (!dueno) return 'sin-comercial'

  const duracion = Math.max(0, Math.round(Number(c.duration) || 0))
  const disposicion = (c.disposition ?? '').trim().toLowerCase()
  const contestada = disposicion === 'answered'
  // La hora: la de ahora menos lo que duró (call_start viene en la zona horaria de la cuenta de Zadarma, que no sabemos)
  const fecha = new Date(Date.now() - duracion * 1000).toISOString()
  const grabada = c.is_recorded === '1' && c.call_id_with_rec
  const service = createServiceClient()

  let leadId: string | null = null
  if (numeroDelOtro) {
    const leads = await leerLeadsParaVincular(service, dueno.userId)
    leadId = leadDeLaLlamada(numeroDelOtro, dueno.userId, indiceDeTelefonos(leads))?.id ?? null
  }
  const fila: Record<string, unknown> = {
    user_id: dueno.userId,
    rinkel_id: `${PREFIJO}${pbxCallId}`,
    call_id: pbxCallId,
    fecha,
    direccion: saliente ? 'outbound' : 'inbound',
    duracion_s: duracion,
    estado: contestada ? 'ANSWERED' : (disposicion.replace(/[^a-z]+/g, '_').toUpperCase() || 'MISSED'),
    motivo_perdida: contestada ? null : disposicion || null,
    numero: numeroDelOtro,
    numero_anonimo: !numeroDelOtro,
    numero_propio: dueno.numero,
    ...(grabada ? { grabacion_id: `${PREFIJO}${c.call_id_with_rec}`, grabacion_hasta: new Date(Date.now() + DIAS_DE_GRABACION * 86_400_000).toISOString() } : {}),
    // Sin lead no se manda la columna: un aviso repetido no le quita el lead que ya tuviera
    ...(leadId ? { lead_id: leadId } : {}),
  }
  const { error } = await service.from('rinkel_llamadas').upsert(fila, { onConflict: 'user_id,rinkel_id' })
  if (error) throw error
  return 'guardada'
}

/** El aviso de que la grabación ya está (puede llegar después del de fin de llamada) */
export async function guardarGrabacion(c: Record<string, string>): Promise<boolean> {
  const pbxCallId = c.pbx_call_id?.trim()
  const rec = c.call_id_with_rec?.trim()
  if (!pbxCallId || !rec) return false
  const { error, count } = await createServiceClient()
    .from('rinkel_llamadas')
    .update({ grabacion_id: `${PREFIJO}${rec}`, grabacion_hasta: new Date(Date.now() + DIAS_DE_GRABACION * 86_400_000).toISOString() }, { count: 'exact' })
    .eq('rinkel_id', `${PREFIJO}${pbxCallId}`)
  if (error) throw error
  return (count ?? 0) > 0
}

export const esGrabacionDeZadarma = (grabacionId: string | null | undefined): boolean => Boolean(grabacionId?.startsWith(PREFIJO))

/** El enlace temporal (3 h) al mp3 de una grabación de Zadarma */
export async function urlDeGrabacionZadarma(grabacionId: string): Promise<string> {
  if (!esGrabacionDeZadarma(grabacionId)) throw new ErrorDeZadarma('No es una grabación de Zadarma.')
  const r = await pedirZadarma<{ link?: string; links?: string[] }>('/v1/pbx/record/request/', { call_id: grabacionId.slice(PREFIJO.length), lifetime: '10800' })
  const url = r.link ?? r.links?.[0]
  if (!url) throw new ErrorDeZadarma('Zadarma no ha dado la grabación.')
  const host = new URL(url).hostname
  if (!host.endsWith('zadarma.com')) throw new ErrorDeZadarma('La grabación no viene de Zadarma.')
  return url
}
