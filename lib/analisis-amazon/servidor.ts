/**
 * EL ANÁLISIS DE AMAZON EN EL SERVIDOR: leerlo por su enlace, saber quién es el comercial y apuntar cuándo lo abre el lead.
 *
 * Todo con la clave de servicio: las tablas de la migración 303 están cerradas al navegador. La página pública solo conoce el token;
 * la ficha de Cold Calling comprueba antes, con la sesión de quien mira, que ese lead es suyo (o que es admin).
 */
import { randomBytes } from 'crypto'
import { createServiceClient } from '@/lib/supabase/service'
import type { ContactoComercial } from '@/components/analisis-amazon/InformeAnalisis'
import type { InformeAnalisis } from './construir'

export type FilaDeAnalisis = {
  id: string
  lead_id: string
  seller_id: string
  token: string
  fecha: string
  version: number
  tipo: string | null
  informe: InformeAnalisis
  aperturas: number
  abierto_primera_at: string | null
  abierto_ultima_at: string | null
}

/** Un token largo y al azar (base64url, 32 caracteres): el enlace no se puede adivinar */
export const nuevoToken = () => randomBytes(24).toString('base64url')

const TOKEN_VALIDO = /^[A-Za-z0-9_-]{20,64}$/

/** ¿La base todavía no tiene la migración 303? (tabla o columna que no existe) */
export function falta303(error: unknown): boolean {
  const c = (error as { code?: string } | null)?.code
  return c === '42P01' || c === 'PGRST205' || c === '42703' || c === 'PGRST204'
}

export async function analisisPorToken(token: string): Promise<FilaDeAnalisis | null> {
  if (!TOKEN_VALIDO.test(token)) return null
  const { data, error } = await createServiceClient().from('analisis_amazon').select('*').eq('token', token).maybeSingle()
  if (error) {
    if (!falta303(error)) console.error('Análisis · no se ha podido leer el informe', { codigo: (error as { code?: string }).code })
    return null
  }
  return (data as FilaDeAnalisis | null) ?? null
}

/** El último informe de un lead (sin el JSON entero si no hace falta) */
export async function ultimoAnalisisDelLead(leadId: string): Promise<FilaDeAnalisis | null> {
  const { data, error } = await createServiceClient()
    .from('analisis_amazon')
    .select('*')
    .eq('lead_id', leadId)
    .order('fecha', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    if (!falta303(error)) console.error('Análisis · no se ha podido leer el informe del lead', { codigo: (error as { code?: string }).code })
    return null
  }
  return (data as FilaDeAnalisis | null) ?? null
}

/** El comercial del lead: su nombre, su WhatsApp (perfil) y su línea de Rinkel para «Llamar» */
export async function contactoDelLead(leadId: string): Promise<(ContactoComercial & { id: string }) | null> {
  const { data: lead } = await createServiceClient().from('cold_leads').select('assigned_to').eq('id', leadId).maybeSingle()
  const uid = (lead as { assigned_to?: string | null } | null)?.assigned_to
  return uid ? contactoDeUsuario(uid) : null
}

/** Una persona del equipo como contacto: nombre de pila, WhatsApp y línea de Rinkel */
export async function contactoDeUsuario(uid: string): Promise<(ContactoComercial & { id: string }) | null> {
  const s = createServiceClient()
  const [{ data: perfil }, { data: rinkel }] = await Promise.all([
    s.from('profiles').select('*').eq('id', uid).maybeSingle(),
    s.from('rinkel_vinculos').select('rinkel_numero').eq('user_id', uid).maybeSingle(),
  ])
  const p = perfil as { full_name?: string | null; whatsapp?: string | null } | null
  if (!p) return null
  return {
    id: uid,
    nombre: (p.full_name ?? '').trim().split(/\s+/)[0] || 'Liberty Seller',
    whatsapp: p.whatsapp ?? null,
    telefono: (rinkel as { rinkel_numero?: string | null } | null)?.rinkel_numero ?? null,
  }
}

/** Cada cuánto, como poco, un mismo informe vuelve a avisar al comercial (abrirlo tres veces seguidas es una apertura) */
export const MINUTOS_ENTRE_AVISOS = 30

const hora = (d: Date) =>
  d.toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/**
 * EL LEAD HA ABIERTO SU INFORME.
 * Se apunta siempre la apertura; el aviso al comercial (campana + ventana abajo a la derecha) y la nota en el historial del lead,
 * solo si es la primera vez o han pasado MINUTOS_ENTRE_AVISOS desde la anterior.
 */
export async function registrarApertura(a: FilaDeAnalisis, dispositivo: 'movil' | 'ordenador' | null): Promise<void> {
  const s = createServiceClient()
  const ahora = new Date()
  const anterior = a.abierto_ultima_at ? new Date(a.abierto_ultima_at) : null
  const avisar = !anterior || ahora.getTime() - anterior.getTime() > MINUTOS_ENTRE_AVISOS * 60_000

  await s.from('analisis_amazon_aperturas').insert({ analisis_id: a.id, lead_id: a.lead_id, dispositivo })
  await s
    .from('analisis_amazon')
    .update({ aperturas: a.aperturas + 1, abierto_ultima_at: ahora.toISOString(), abierto_primera_at: a.abierto_primera_at ?? ahora.toISOString() })
    .eq('id', a.id)

  if (!avisar) return
  const contacto = await contactoDelLead(a.lead_id)
  const nombre = a.informe?.vendedor?.nombre ?? 'Un lead'
  const veces = a.aperturas + 1
  const texto = `${nombre} ha abierto su análisis de Amazon${dispositivo === 'movil' ? ' (desde el móvil)' : ''} · ${hora(ahora)}${veces > 1 ? ` · ${veces}.ª vez` : ''}`

  await s.from('cold_lead_notes').insert({ lead_id: a.lead_id, author_id: null, kind: 'nota', body: `📈 ${texto}`, occurred_at: ahora.toISOString() })
  if (contacto) {
    const { error } = await s.from('notifications').insert({
      user_id: contacto.id,
      type: 'analisis_abierto',
      title: `${nombre} está viendo su análisis`,
      message: texto,
      clave: `analisis:${a.id}:${ahora.getTime()}`,
      datos: { app: 'analisis', leadId: a.lead_id, analisisId: a.id },
    })
    if (error) console.error('Análisis · no se ha podido avisar al comercial', { codigo: (error as { code?: string }).code })
  }
}
