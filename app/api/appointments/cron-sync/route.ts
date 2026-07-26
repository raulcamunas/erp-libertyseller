import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { isGoogleConfigured } from '@/lib/google-calendar'
import { runSyncCycle } from '@/lib/appointments-sync'

/**
 * Sincronización periódica llamada desde el cron del propio contenedor
 * (scripts/google-calendar-sync.sh, cada pocos minutos). No depende de
 * las notificaciones push de Google (que exigen verificar el dominio),
 * así que la agenda se mantiene sincronizada siempre, sin intervención
 * manual: cualquier cita creada/movida/borrada directamente en Google
 * Calendar aparece en el ERP en cuestión de minutos.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isGoogleConfigured()) {
    return NextResponse.json({ ok: true, skipped: 'Google no configurado' })
  }

  try {
    const stats = await runSyncCycle(createServiceClient())
    return NextResponse.json({ ok: true, ...stats })
  } catch (err) {
    console.error('Error en cron-sync:', err)
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}
