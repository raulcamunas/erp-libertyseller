import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isGoogleConfigured, getCalendarId } from '@/lib/google-calendar'
import { calendar, auth as googleAuth } from '@googleapis/calendar'

/**
 * Diagnóstico de la integración con Google Calendar, sin hacer un sync
 * completo (que puede colgarse y provocar un 502 en el proxy). Hace una
 * única llamada mínima con timeout corto para ver exactamente qué falla.
 * Solo admins.
 */
export async function GET(_request: NextRequest) {
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

  const envStatus = {
    GOOGLE_SA_CLIENT_EMAIL: Boolean(process.env.GOOGLE_SA_CLIENT_EMAIL),
    GOOGLE_SA_PRIVATE_KEY: Boolean(process.env.GOOGLE_SA_PRIVATE_KEY),
    GOOGLE_IMPERSONATE_SUBJECT: Boolean(process.env.GOOGLE_IMPERSONATE_SUBJECT),
    GOOGLE_CALENDAR_ID: Boolean(process.env.GOOGLE_CALENDAR_ID),
  }

  if (!isGoogleConfigured()) {
    return NextResponse.json({
      ok: false,
      step: 'env',
      envStatus,
      error: 'Faltan variables de entorno de Google en este servidor',
    })
  }

  // Llamada mínima con timeout corto (8s) para no colgar el proxy
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)

  try {
    const clientEmail = process.env.GOOGLE_SA_CLIENT_EMAIL!
    const privateKey = process.env.GOOGLE_SA_PRIVATE_KEY!.replace(/\\n/g, '\n')
    const subject = process.env.GOOGLE_IMPERSONATE_SUBJECT!

    const authClient = new googleAuth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ['https://www.googleapis.com/auth/calendar'],
      subject,
    })

    const cal = calendar({ version: 'v3', auth: authClient })
    const start = Date.now()
    const res = await cal.events.list(
      {
        calendarId: getCalendarId(),
        maxResults: 1,
        timeMin: new Date().toISOString(),
      },
      { signal: controller.signal }
    )
    clearTimeout(timeout)

    return NextResponse.json({
      ok: true,
      step: 'api_call',
      envStatus,
      calendarId: getCalendarId(),
      subject,
      latencyMs: Date.now() - start,
      eventsFound: res.data.items?.length ?? 0,
    })
  } catch (err: unknown) {
    clearTimeout(timeout)
    const e = err as {
      message?: string
      code?: string | number
      response?: { status?: number; data?: unknown }
      name?: string
    }
    return NextResponse.json({
      ok: false,
      step: 'api_call',
      envStatus,
      error: e.message || String(err),
      errorName: e.name,
      errorCode: e.code,
      httpStatus: e.response?.status,
      httpBody: e.response?.data,
      aborted: controller.signal.aborted,
    })
  }
}
