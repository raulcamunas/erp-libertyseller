import { NextResponse, type NextRequest } from 'next/server'
import { almacenDeSupabase, avanzarElCiclo } from '@/lib/cold-calling/ciclo-servidor'
import { hayPasadaEnMarchaDe } from '@/lib/correo/cron-solape'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * CICLO COMERCIAL: UNA PASADA DEL CRON.
 *
 * Cada minuto el crontab del contenedor entra aquí y `tocaAhora('ciclo-leads')` decide si ya toca (cada dos minutos, o lo que se ponga en Sistema; o apagado). Una pasada
 * (lib/cold-calling/ciclo-servidor.ts) mira los leads de las listas de ciclo que están en el ritmo —los que ya tienen fase y los que acaban de empezar una secuencia— y los pasa de fase si toca.
 * Sin ninguna lista de ciclo son tres consultas pequeñas. Mientras no esté lanzada la migración 264 la pasada lo dice y no hace nada.
 *
 * `?ensayo=1` no guarda nada y dice lo que haría: sirve para mirar antes de encender y para comprobar en producción (con `?forzar=1` salta el reloj de Sistema).
 * `conRegistro` envuelve SOLO el trabajo: abre su fila ANTES de trabajar.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

/** La ruta no puede durar más de 120 s; sin terminar pasado esto (con margen) la pasada se da por muerta y deja de bloquear a la siguiente */
const PASADA_MUERTA_TRAS_MS = 150_000

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  if (request.nextUrl.searchParams.get('forzar') !== '1') {
    const veredicto = await tocaAhora('ciclo-leads')
    if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
  }

  try {
    const db = createServiceClient()
    // Una pasada que sigue en marcha (la base va lenta) no deja que otra empiece encima: dos a la vez leerían lo mismo y se pisarían. Las que se lanzan a mano no cuentan (lib/correo/cron-solape.ts)
    if (request.nextUrl.searchParams.get('forzar') !== '1' && (await hayPasadaEnMarchaDe(db, 'ciclo-leads', PASADA_MUERTA_TRAS_MS))) {
      return NextResponse.json({ ok: true, saltado: 'sigue en marcha la pasada anterior' })
    }
    const ensayo = request.nextUrl.searchParams.get('ensayo') === '1'
    const salida = await conRegistro('ciclo-leads', lanzadoPorDe(request.headers), async () => {
      const resumen = await avanzarElCiclo(almacenDeSupabase(db), { ensayo })
      return { ...resumen }
    })
    if (salida.faltaLaMigracion) return NextResponse.json({ ok: true, saltado: salida.resumen })
    return NextResponse.json({ ok: true, ...salida })
  } catch (error) {
    console.error('[ciclo-leads] error en el cron:', (error as Error).message)
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 })
  }
}
