import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { isGoogleConfigured } from '@/lib/google-calendar'
import { runSyncCycle } from '@/lib/appointments-sync'

/**
 * Resincronizado completo a petición, desde el botón de la agenda.
 * Fuerza la recarga entera de la ventana en vez de esperar al ciclo de
 * cada 4 horas: útil cuando se acaba de tocar algo en Google Calendar y
 * se quiere ver reflejado ya.
 *
 * Solo admins: es una operación pesada y no tiene sentido que la dispare
 * cualquiera desde su navegador.
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
      { error: 'Google Calendar no está configurado en este servidor' },
      { status: 400 }
    )
  }

  try {
    const stats = await runSyncCycle(createServiceClient(), { force: true })
    return NextResponse.json({ ok: true, ...stats })
  } catch (err) {
    console.error('Error resincronizando con Google:', err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
