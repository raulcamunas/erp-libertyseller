import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'
import { hayPasadaEnMarchaDe, PASADA_DEL_CALENDARIO_MUERTA_TRAS_MS } from '@/lib/correo/cron-solape'
import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { isGoogleConfigured } from '@/lib/google-calendar'
import { runSyncCycle } from '@/lib/appointments-sync'

/**
 * Sincronización periódica llamada desde el cron del propio contenedor
 * (scripts/google-calendar-sync.sh, cada minuto). No depende de
 * las notificaciones push de Google (que exigen verificar el dominio),
 * así que la agenda se mantiene sincronizada siempre, sin intervención
 * manual: cualquier cita creada/movida/borrada directamente en Google
 * Calendar aparece en el ERP en cosa de un minuto (y de ahí, al instante, en
 * las agendas abiertas: components/agenda/useCitas.ts).
 *
 * Una pasada dura ~1 s, pero si Google va lento y pasa de un minuto, la
 * siguiente NO empieza encima (lib/correo/cron-solape.ts): dos a la vez
 * importarían dos veces el mismo hueco.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret && request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  /**
   * ¿TOCA?
   *
   * El crontab del contenedor llama aquí CADA MINUTO; el intervalo de verdad
   * está en cron_config y lo decide tocaAhora(), para poder cambiarlo desde la
   * pantalla de Sistema. `?forzar=1` lo pone el botón «Lanzar ahora».
   */
  if (request.nextUrl.searchParams.get('forzar') !== '1') {
    const veredicto = await tocaAhora('calendario')
    if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
    if (await hayPasadaEnMarchaDe(createServiceClient(), 'calendario', PASADA_DEL_CALENDARIO_MUERTA_TRAS_MS)) {
      return NextResponse.json({ ok: true, saltado: 'la pasada anterior sigue en marcha' })
    }
  }

  if (!isGoogleConfigured()) {
    return NextResponse.json({ ok: true, skipped: 'Google no configurado' })
  }

  try {
    const stats = await conRegistro('calendario', lanzadoPorDe(request.headers), () =>
      runSyncCycle(createServiceClient())
    )
    return NextResponse.json({ ok: true, ...stats })
  } catch (err) {
    console.error('Error en cron-sync:', err)
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 })
  }
}
