import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  startWatch,
  incrementalSync,
  getCalendarId,
  isGoogleConfigured,
} from '@/lib/google-calendar'
import { randomUUID } from 'crypto'

/**
 * Activa (o renueva) el canal de push de Google Calendar y guarda el
 * syncToken inicial. Ejecutar una vez tras configurar Google, y renovar
 * antes de que expire (Google caduca los canales ~cada 7 días / 1 mes).
 * Solo admins.
 */
export async function POST(_request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || (profile.role !== 'admin' && profile.role !== 'partner')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!isGoogleConfigured()) {
    return NextResponse.json(
      { error: 'Google no está configurado (faltan variables de entorno)' },
      { status: 400 }
    )
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.libertyseller.com'
  const webhookUrl = `${appUrl}/api/appointments/google-webhook`
  const channelId = randomUUID()

  try {
    const watch = await startWatch(webhookUrl, channelId)

    // Inicializar syncToken con una carga incremental
    const result = await incrementalSync(null)

    const svc = createServiceClient()
    await svc.from('google_calendar_sync').upsert({
      calendar_id: getCalendarId(),
      sync_token: result.nextSyncToken,
      channel_id: channelId,
      resource_id: watch.resourceId ?? null,
      channel_expiration: watch.expiration
        ? new Date(Number(watch.expiration)).toISOString()
        : null,
      last_full_sync_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    return NextResponse.json({
      ok: true,
      channelId,
      resourceId: watch.resourceId,
      expiration: watch.expiration,
      webhookUrl,
    })
  } catch (err) {
    console.error('Error activando watch:', err)
    return NextResponse.json({ error: (err as Error).message }, { status: 502 })
  }
}
