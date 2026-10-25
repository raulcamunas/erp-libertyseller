import { createClient } from '@/lib/supabase/client'
import { cuerpoDelApunteDeWhatsapp, esSituacionDeWhatsapp, type MensajeDeWhatsapp, type SituacionDeWhatsapp } from './mensajes'

/**
 * LOS MENSAJES DE WHATSAPP Y SU APUNTE EN EL HISTORIAL — SOLO NAVEGADOR.
 * ======================================================================
 * Lee y escribe con la sesión de quien está delante, así que las políticas RLS de `plantillas_whatsapp` (migración 247) y de `cold_lead_notes`
 * (migración 212) son las que mandan: esto solo decide qué se enseña.
 *
 * SIN LA MIGRACIÓN 247 EL BOTÓN FUNCIONA IGUAL: la lectura dice «falta la migración» y la pantalla ofrece los mensajes de serie. Lo único que
 * no se puede es guardar los propios.
 *
 * Los mensajes se leen UNA vez por sesión del navegador (el botón está en cada ficha, y volver a pedirlos con cada lead sería ruido) y se
 * vuelven a pedir cuando alguien los cambia.
 */

export const FALTA_LA_MIGRACION_247 = 'Falta lanzar la migración 247_plantillas_whatsapp.sql en el editor SQL de Supabase para poder guardar mensajes. Mientras tanto se ofrecen los de serie.'
const CODIGOS_SIN_TABLA = new Set(['42P01', 'PGRST205', 'PGRST200'])

export interface LecturaDeMensajes {
  /** Los guardados: primero los míos y luego los del equipo, cada grupo por orden de creación */
  mensajes: MensajeDeWhatsapp[]
  faltaMigracion: boolean
  /** Un fallo que NO es la migración: se enseña y se vuelve a intentar la próxima vez */
  error: string | null
}

let lectura: Promise<LecturaDeMensajes> | null = null

async function pedirMensajes(yoId: string | null): Promise<LecturaDeMensajes> {
  try {
    const { data, error } = await createClient().from('plantillas_whatsapp').select('id, user_id, situacion, texto').order('creada_at', { ascending: true })
    if (error) {
      const sinTabla = CODIGOS_SIN_TABLA.has(error.code ?? '')
      return { mensajes: [], faltaMigracion: sinTabla, error: sinTabla ? null : 'No se han podido leer los mensajes de WhatsApp.' }
    }
    const todos = ((data ?? []) as Array<{ id: string; user_id: string | null; situacion: string; texto: string }>)
      .filter((m): m is { id: string; user_id: string | null; situacion: SituacionDeWhatsapp; texto: string } => esSituacionDeWhatsapp(m.situacion))
      .map((m) => ({ id: m.id, user_id: m.user_id, situacion: m.situacion, texto: m.texto }))
    // Los míos primero: son los que quien escribe ha querido para sí; los del equipo, después
    const mios = todos.filter((m) => yoId !== null && m.user_id === yoId)
    const delEquipo = todos.filter((m) => m.user_id === null)
    return { mensajes: [...mios, ...delEquipo], faltaMigracion: false, error: null }
  } catch {
    return { mensajes: [], faltaMigracion: false, error: 'No se han podido leer los mensajes de WhatsApp.' }
  }
}

/** Los mensajes guardados. `forzar` los vuelve a pedir (tras guardar o borrar uno) */
export function leerMensajes(yoId: string | null, forzar = false): Promise<LecturaDeMensajes> {
  if (forzar || !lectura) {
    const esta = pedirMensajes(yoId)
    lectura = esta
    // Un fallo no se queda guardado: la próxima vez se vuelve a intentar
    void esta.then((r) => {
      if (r.error && lectura === esta) lectura = null
    })
  }
  return lectura
}

export type ResultadoDeEscritura = { ok: true } | { ok: false; mensaje: string }

export async function guardarMensaje(m: { id: string | null; user_id: string | null; situacion: SituacionDeWhatsapp; texto: string }): Promise<ResultadoDeEscritura> {
  try {
    const supabase = createClient()
    const cuerpo = { situacion: m.situacion, texto: m.texto.trim() }
    const r = m.id ? await supabase.from('plantillas_whatsapp').update(cuerpo).eq('id', m.id) : await supabase.from('plantillas_whatsapp').insert({ ...cuerpo, user_id: m.user_id })
    if (r.error) return { ok: false, mensaje: CODIGOS_SIN_TABLA.has(r.error.code ?? '') ? FALTA_LA_MIGRACION_247 : 'No se ha podido guardar el mensaje.' }
    lectura = null
    return { ok: true }
  } catch {
    return { ok: false, mensaje: 'No se ha podido guardar el mensaje.' }
  }
}

export async function borrarMensaje(id: string): Promise<ResultadoDeEscritura> {
  try {
    const { error } = await createClient().from('plantillas_whatsapp').delete().eq('id', id)
    if (error) return { ok: false, mensaje: 'No se ha podido borrar el mensaje.' }
    lectura = null
    return { ok: true }
  } catch {
    return { ok: false, mensaje: 'No se ha podido borrar el mensaje.' }
  }
}

/**
 * Apunta en el historial del lead que se ha abierto WhatsApp con ese mensaje, y sella su último contacto. NO cambia el estado del lead (eso lo
 * decide la persona) ni suma un intento de llamada. Igual que apuntarCorreoEnLead (lib/correo/lead-cliente.ts): si algo falla no se
 * rompe nada, solo se devuelve que no ha quedado apuntado para que la pantalla lo diga.
 */
export async function apuntarWhatsappEnLead(datos: { leadId: string; userId: string; numero: string; texto: string }): Promise<{ ok: true; cuando: string } | { ok: false }> {
  try {
    const supabase = createClient()
    const cuando = new Date().toISOString()
    const { error } = await supabase.from('cold_lead_notes').insert({ lead_id: datos.leadId, author_id: datos.userId, kind: 'whatsapp', body: cuerpoDelApunteDeWhatsapp({ numero: datos.numero, texto: datos.texto }) })
    if (error) {
      console.error('WhatsApp · no se ha podido apuntar en el historial del lead', { codigo: error.code ?? null })
      return { ok: false }
    }
    const { error: errorLead } = await supabase.from('cold_leads').update({ last_contacted_at: cuando }).eq('id', datos.leadId)
    if (errorLead) console.error('WhatsApp · no se ha podido sellar el último contacto del lead', { codigo: errorLead.code ?? null })
    return { ok: true, cuando }
  } catch (error) {
    console.error('WhatsApp · fallo al apuntar en el lead', { mensaje: error instanceof Error ? error.message : 'desconocido' })
    return { ok: false }
  }
}
