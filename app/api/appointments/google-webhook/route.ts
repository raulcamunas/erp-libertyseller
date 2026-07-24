import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  incrementalSync,
  getCalendarId,
  isGoogleConfigured,
} from '@/lib/google-calendar'

/**
 * Webhook de Google Calendar (push notifications).
 * Google llama aquí cuando el calendario cambia. Hacemos sync incremental
 * y reflejamos en el ERP los cambios hechos directamente en Google
 * (reagendados y cancelaciones de eventos que ya existen en el ERP).
 */
export async function POST(request: NextRequest) {
  // Google manda cabeceras X-Goog-*; en el primer 'sync' no hay que hacer nada.
  const state = request.headers.get('x-goog-resource-state')
  if (state === 'sync') return NextResponse.json({ ok: true })

  if (!isGoogleConfigured()) return NextResponse.json({ ok: true })

  const svc = createServiceClient()
  const calendarId = getCalendarId()

  try {
    const { data: syncRow } = await svc
      .from('google_calendar_sync')
      .select('*')
      .eq('calendar_id', calendarId)
      .maybeSingle()

    let token = syncRow?.sync_token ?? null
    let result = await incrementalSync(token)
    if (result.needsFullSync) {
      result = await incrementalSync(null)
    }

    for (const ev of result.events) {
      if (!ev.id) continue

      // Evento borrado/cancelado en Google
      if (ev.status === 'cancelled') {
        await svc
          .from('appointments')
          .update({
            status: 'cancelled',
            updated_source: 'google',
            last_synced_at: new Date().toISOString(),
          })
          .eq('google_event_id', ev.id)
        continue
      }

      const start = ev.start?.dateTime
      const end = ev.end?.dateTime
      if (!start || !end) continue

      const erpId = ev.extendedProperties?.private?.erpAppointmentId

      // Buscar la cita: primero por google_event_id, luego por erpAppointmentId
      const { data: byEvent } = await svc
        .from('appointments')
        .select('id')
        .eq('google_event_id', ev.id)
        .maybeSingle()

      const targetId = byEvent?.id ?? erpId ?? null
      if (!targetId) {
        // Evento creado directamente en Google sin vínculo al ERP: se ignora en v1.
        continue
      }

      await svc
        .from('appointments')
        .update({
          start_time: start,
          end_time: end,
          google_event_id: ev.id,
          google_html_link: ev.htmlLink ?? null,
          updated_source: 'google',
          sync_status: 'synced',
          last_synced_at: new Date().toISOString(),
        })
        .eq('id', targetId)
    }

    // Guardar el nuevo syncToken
    if (result.nextSyncToken) {
      await svc.from('google_calendar_sync').upsert({
        calendar_id: calendarId,
        sync_token: result.nextSyncToken,
        updated_at: new Date().toISOString(),
      })
    }

    return NextResponse.json({ ok: true, processed: result.events.length })
  } catch (err) {
    console.error('Error en webhook de Google:', err)
    // Respondemos 200 igualmente para que Google no reintente en bucle
    return NextResponse.json({ ok: false, error: (err as Error).message })
  }
}
