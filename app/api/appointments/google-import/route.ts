import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { incrementalSync, isGoogleConfigured } from '@/lib/google-calendar'
import { applyGoogleEventsToErp } from '@/lib/appointments-sync'

/**
 * Importa (una vez) todos los eventos que ya existían en el calendario de
 * Google antes de tener este módulo, como eventos externos de solo lectura.
 * Así el ERP no deja agendar citas encima de huecos ya ocupados.
 * Solo admins. Se puede volver a ejecutar sin duplicar (dedupe por
 * google_event_id).
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

  try {
    // Carga completa (sin syncToken) de los próximos eventos del calendario
    const result = await incrementalSync(null)
    const svc = createServiceClient()
    const stats = await applyGoogleEventsToErp(svc, result.events)

    return NextResponse.json({ ok: true, ...stats })
  } catch (err) {
    console.error('Error importando eventos de Google:', err)
    return NextResponse.json({ error: (err as Error).message }, { status: 502 })
  }
}
