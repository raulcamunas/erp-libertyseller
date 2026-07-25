import { SupabaseClient } from '@supabase/supabase-js'
import { calendar_v3 } from '@googleapis/calendar'

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
      const { data } = await svc
        .from('appointments')
        .update({
          status: 'cancelled',
          updated_source: 'google',
          last_synced_at: new Date().toISOString(),
        })
        .eq('google_event_id', ev.id)
        .select('id')
      if (data && data.length > 0) cancelled += data.length
      continue
    }

    const start = ev.start?.dateTime
    const end = ev.end?.dateTime
    // Eventos de todo el día (sin dateTime) no se representan en el calendario semanal
    if (!start || !end) continue

    const erpId = ev.extendedProperties?.private?.erpAppointmentId

    const { data: byEvent } = await svc
      .from('appointments')
      .select('id')
      .eq('google_event_id', ev.id)
      .maybeSingle()

    const targetId = byEvent?.id ?? erpId ?? null

    if (targetId) {
      await svc
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
      updated++
      continue
    }

    // Evento creado directamente en Google, sin vínculo al ERP:
    // se importa como externo (solo lectura). `byEvent` ya confirmó
    // arriba que no existía ninguna cita con este google_event_id.
    await svc.from('appointments').insert({
      comercial_id: null,
      lead_name: ev.summary || '(Sin título)',
      notes: ev.description || null,
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
    imported++
  }

  return { updated, imported, cancelled }
}
