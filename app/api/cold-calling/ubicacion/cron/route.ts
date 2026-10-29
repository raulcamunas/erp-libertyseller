import { NextResponse, type NextRequest } from 'next/server'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'
import { createServiceClient } from '@/lib/supabase/service'
import { ubicarPendientes } from '@/lib/ubicacion/pendientes'

/**
 * UBICACIÓN DE LOS LEADS: UNA PASADA DEL CRON.
 *
 * Cada minuto el crontab del contenedor entra aquí y `tocaAhora('ubicacion-leads')` decide si ya toca (cada dos minutos, o lo que se ponga en Sistema; o apagado). Una pasada
 * (lib/ubicacion/pendientes.ts) coge los leads sin ubicar —los nuevos y los que han cambiado de ciudad, provincia, dirección, registro, teléfono o web—, deduce su comunidad
 * autónoma y la guarda. La primera vez, con los ~35.000 que hay, son seis o siete pasadas (unos 12 minutos). Sin nada pendiente es una consulta de milisegundos.
 *
 * Mientras no esté lanzada la migración 263 la pasada lo dice y no hace nada. `conRegistro` envuelve SOLO el trabajo: abre su fila ANTES de trabajar.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  if (request.nextUrl.searchParams.get('forzar') !== '1') {
    const veredicto = await tocaAhora('ubicacion-leads')
    if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
  }

  try {
    const db = createServiceClient()
    const salida = await conRegistro('ubicacion-leads', lanzadoPorDe(request.headers), async () => {
      const resumen = await ubicarPendientes(db)
      return { ...resumen }
    })
    if (salida.faltaLaMigracion) return NextResponse.json({ ok: true, saltado: salida.resumen })
    return NextResponse.json({ ok: true, ...salida })
  } catch (error) {
    console.error('[ubicacion-leads] error en el cron:', (error as Error).message)
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 })
  }
}
