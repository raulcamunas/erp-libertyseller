import { SupabaseClient } from '@supabase/supabase-js'
import { calendar_v3 } from '@googleapis/calendar'
import { incrementalSync, getCalendarId } from '@/lib/google-calendar'

/**
 * Título de la cita en Google Calendar. El nombre del lead es la parte
 * dinámica: "Consultoría Estratégica Amazon · Liberty Seller · {lead}".
 */
export function buildAppointmentSummary(leadName: string): string {
  return `Consultoría Estratégica Amazon · Liberty Seller · ${leadName}`
}

/**
 * Descripción del evento en Google Calendar. El lead ve este texto en
 * la invitación, así que es contenido de cara al cliente, sin datos
 * internos (quién agendó, teléfono, notas del equipo).
 */
export function buildAppointmentDescription(): string {
  return (
    'Durante la sesión analizaremos el rendimiento general, identificaremos ' +
    'oportunidades de mejora y definiremos acciones estratégicas con el ' +
    'objetivo de presentarte una propuesta de colaboración alineada con tus ' +
    'necesidades comerciales.'
  )
}

/**
 * Aplica una lista de eventos de Google Calendar sobre la tabla
 * `appointments`. Usado tanto por el import inicial (full sync) como
 * por el webhook incremental, para no duplicar la lógica.
 *
 * - Evento con erpAppointmentId o google_event_id ya conocido → se
 *   actualiza la cita gestionada por el ERP (reagendado/cancelado desde
 *   Google se refleja aquí).
 * - Evento sin vínculo al ERP → se importa como "externo" (solo lectura,
 *   sirve para no agendar encima de un hueco ya ocupado).
 */
export async function applyGoogleEventsToErp(
  svc: SupabaseClient,
  events: calendar_v3.Schema$Event[]
): Promise<{ updated: number; imported: number; cancelled: number }> {
  let updated = 0
  let imported = 0
  let cancelled = 0

  for (const ev of events) {
    if (!ev.id) continue

    if (ev.status === 'cancelled') {
      const { data, error } = await svc
        .from('appointments')
        .update({
          status: 'cancelled',
          updated_source: 'google',
          last_synced_at: new Date().toISOString(),
        })
        .eq('google_event_id', ev.id)
        .select('id')
      if (error) throw new Error(`Supabase (cancel): ${error.message}`)
      if (data && data.length > 0) cancelled += data.length
      continue
    }

    const start = ev.start?.dateTime
    const end = ev.end?.dateTime
    // Eventos de todo el día (sin dateTime) no se representan en el calendario semanal
    if (!start || !end) continue

    const erpId = ev.extendedProperties?.private?.erpAppointmentId

    const { data: byEvent, error: lookupError } = await svc
      .from('appointments')
      .select('id')
      .eq('google_event_id', ev.id)
      .maybeSingle()
    if (lookupError) throw new Error(`Supabase (lookup): ${lookupError.message}`)

    const targetId = byEvent?.id ?? erpId ?? null

    if (targetId) {
      const { error: updateError } = await svc
        .from('appointments')
        .update({
          start_time: start,
          end_time: end,
          google_event_id: ev.id,
          google_html_link: ev.htmlLink ?? null,
          google_meet_link: ev.hangoutLink ?? null,
          updated_source: 'google',
          sync_status: 'synced',
          last_synced_at: new Date().toISOString(),
        })
        .eq('id', targetId)
      if (updateError) throw new Error(`Supabase (update): ${updateError.message}`)
      updated++
      continue
    }

    // Evento creado directamente en Google, sin vínculo al ERP:
    // se importa como externo (solo lectura). Por privacidad no se
    // guarda el título ni la descripción reales del evento — solo se
    // marca el hueco como ocupado. `byEvent` ya confirmó arriba que no
    // existía ninguna cita con este google_event_id.
    const { error: insertError } = await svc.from('appointments').insert({
      comercial_id: null,
      lead_name: 'Hueco no disponible',
      notes: null,
      start_time: start,
      end_time: end,
      status: 'scheduled',
      is_external: true,
      google_event_id: ev.id,
      google_calendar_id: ev.organizer?.email ?? null,
      google_html_link: ev.htmlLink ?? null,
      google_meet_link: ev.hangoutLink ?? null,
      updated_source: 'google',
      sync_status: 'synced',
      last_synced_at: new Date().toISOString(),
    })
    if (insertError) throw new Error(`Supabase (insert): ${insertError.message}`)
    imported++
  }

  return { updated, imported, cancelled }
}

/**
 * Ciclo completo de sincronización: lee el syncToken guardado, pide a
 * Google los cambios desde entonces (o una carga inicial si no hay
 * token todavía), los aplica al ERP y guarda el nuevo token. Usado por
 * el webhook de Google y por el cron de sync periódico — así el
 * calendario del ERP nunca se queda desactualizado sin depender de que
 * nadie pulse un botón.
 */
export async function runSyncCycle(svc: SupabaseClient) {
  const calendarId = getCalendarId()

  const { data: syncRow } = await svc
    .from('google_calendar_sync')
    .select('sync_token')
    .eq('calendar_id', calendarId)
    .maybeSingle()

  let result = await incrementalSync(syncRow?.sync_token ?? null)
  if (result.needsFullSync) {
    result = await incrementalSync(null)
  }

  const stats = await applyGoogleEventsToErp(svc, result.events)

  if (result.nextSyncToken) {
    await svc.from('google_calendar_sync').upsert({
      calendar_id: calendarId,
      sync_token: result.nextSyncToken,
      updated_at: new Date().toISOString(),
    })
  }

  return stats
}
