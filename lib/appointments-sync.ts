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
/** Cada cuánto se rehace la carga completa, además del sync incremental */
const FULL_SYNC_EVERY_MS = 4 * 60 * 60 * 1000

/** Ventana de la carga completa: una semana atrás y cuatro meses vista */
const FULL_SYNC_PAST_DAYS = 7
const FULL_SYNC_FUTURE_DAYS = 120

export async function runSyncCycle(svc: SupabaseClient, options?: { force?: boolean }) {
  const calendarId = getCalendarId()

  const { data: syncRow } = await svc
    .from('google_calendar_sync')
    .select('sync_token, last_full_sync_at')
    .eq('calendar_id', calendarId)
    .maybeSingle()

  // El sync incremental solo trae CAMBIOS. Las series recurrentes van
  // generando instancias nuevas según pasa el tiempo, y eso para Google no
  // es un cambio: nunca llegarían. Por eso, cada pocas horas se tira el
  // token y se recarga la ventana entera, ya desplazada.
  const lastFull = syncRow?.last_full_sync_at
    ? new Date(syncRow.last_full_sync_at).getTime()
    : 0
  const fullSyncDue =
    options?.force || !syncRow?.sync_token || Date.now() - lastFull > FULL_SYNC_EVERY_MS

  const now = Date.now()
  const range = {
    timeMin: new Date(now - FULL_SYNC_PAST_DAYS * 86400000).toISOString(),
    timeMax: new Date(now + FULL_SYNC_FUTURE_DAYS * 86400000).toISOString(),
  }

  let didFullSync = fullSyncDue
  let result = fullSyncDue
    ? await incrementalSync(null, range)
    : await incrementalSync(syncRow!.sync_token)

  if (result.needsFullSync) {
    // El token había caducado (410): se recarga entera
    didFullSync = true
    result = await incrementalSync(null, range)
  }

  const stats = await applyGoogleEventsToErp(svc, result.events)

  let pruned = 0
  if (didFullSync) {
    pruned = await pruneMissingExternalEvents(svc, result.events, range)
  }

  await svc.from('google_calendar_sync').upsert({
    calendar_id: calendarId,
    ...(result.nextSyncToken ? { sync_token: result.nextSyncToken } : {}),
    ...(didFullSync ? { last_full_sync_at: new Date().toISOString() } : {}),
    updated_at: new Date().toISOString(),
  })

  return { ...stats, pruned, fullSync: didFullSync }
}

/**
 * Borra los huecos externos que ya no existen en Google. Sin esto, un
 * evento borrado en Google fuera de la ventana de cambios se queda
 * bloqueando la agenda para siempre.
 *
 * Solo toca eventos importados (`is_external`): las citas gestionadas por
 * el ERP no se borran nunca desde aquí.
 */
async function pruneMissingExternalEvents(
  svc: SupabaseClient,
  events: calendar_v3.Schema$Event[],
  range: { timeMin: string; timeMax: string }
): Promise<number> {
  const alive = new Set(
    events.filter((e) => e.status !== 'cancelled' && e.id).map((e) => e.id as string)
  )

  const { data: externals, error } = await svc
    .from('appointments')
    .select('id, google_event_id')
    .eq('is_external', true)
    .not('google_event_id', 'is', null)
    .gte('start_time', range.timeMin)
    .lt('start_time', range.timeMax)

  if (error) throw new Error(`Supabase (prune lookup): ${error.message}`)
  if (!externals || externals.length === 0) return 0

  const stale = externals
    .filter((a) => !alive.has(a.google_event_id as string))
    .map((a) => a.id as string)

  if (stale.length === 0) return 0

  const { error: deleteError } = await svc.from('appointments').delete().in('id', stale)
  if (deleteError) throw new Error(`Supabase (prune delete): ${deleteError.message}`)

  return stale.length
}
