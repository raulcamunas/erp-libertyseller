import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  incrementalSync,
  getCalendarId,
  isGoogleConfigured,
} from '@/lib/google-calendar'
import { applyGoogleEventsToErp } from '@/lib/appointments-sync'

/**
 * Webhook de Google Calendar (push notifications).
 * Google llama aquí cuando el calendario cambia. Hacemos sync incremental
 * y reflejamos en el ERP tanto los cambios de citas ya gestionadas por el
 * ERP (reagendados/cancelaciones) como los eventos nuevos creados
 * directamente en Google (se importan como eventos externos de solo lectura).
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

    return NextResponse.json({ ok: true, ...stats })
  } catch (err) {
    console.error('Error en webhook de Google:', err)
    // Respondemos 200 igualmente para que Google no reintente en bucle
    return NextResponse.json({ ok: false, error: (err as Error).message })
  }
}
