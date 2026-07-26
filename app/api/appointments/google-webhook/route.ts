import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { isGoogleConfigured } from '@/lib/google-calendar'
import { runSyncCycle } from '@/lib/appointments-sync'

/**
 * Webhook de Google Calendar (push notifications), por si en el futuro
 * se activa la verificación de dominio necesaria para usarlo. Mientras
 * tanto la sincronización real corre por cron (ver cron-sync/route.ts),
 * que no depende de esa verificación.
 */
export async function POST(request: NextRequest) {
  const state = request.headers.get('x-goog-resource-state')
  if (state === 'sync') return NextResponse.json({ ok: true })
  if (!isGoogleConfigured()) return NextResponse.json({ ok: true })

  try {
    const stats = await runSyncCycle(createServiceClient())
    return NextResponse.json({ ok: true, ...stats })
  } catch (err) {
    console.error('Error en webhook de Google:', err)
    // Respondemos 200 igualmente para que Google no reintente en bucle
    return NextResponse.json({ ok: false, error: (err as Error).message })
  }
}
