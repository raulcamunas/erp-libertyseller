import { NextResponse, type NextRequest } from 'next/server'
import { sincronizarTodo } from '@/lib/tareas-clientes/notion/sync'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'
import { generarAutomaticas } from '@/lib/tareas-clientes/automaticas-servidor'
import { ejecutarRecurrencias } from '@/lib/tareas-clientes/plantillas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * LA PASADA PERIÓDICA CON NOTION (cada 2 minutos: el reloj lo decide `tocaAhora()` desde cron_config, y se cambia desde Sistema).
 *
 * Es la red de seguridad del webhook: si Notion no avisa de un cambio, esta pasada lo trae. Solo se entra con la cabecera x-cron-secret (CRON_SECRET). Una pasada que
 * encuentra otra en marcha se salta sola (el turno de sync.ts), así que no se acumulan.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  if (request.nextUrl.searchParams.get('forzar') !== '1') {
    const veredicto = await tocaAhora('tareas-notion')
    if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
  }
  const salida = await conRegistro('tareas-notion', lanzadoPorDe(request.headers), async () => {
    // Las tareas que se repiten sin que nadie tenga el ERP abierto: se crean aquí
    const repetidas = await ejecutarRecurrencias().catch(() => ({ creadas: 0, fallidas: 0 }))
    const r = await sincronizarTodo({ presupuestoMs: 50_000 })
    // Las tareas que abre el propio ERP (alertas de FBA, listings suprimidos): solo si un administrador encendió alguna fuente, y como mucho una vez cada 50 minutos
    const automaticas = await generarAutomaticas().catch(() => null)
    return { ...r, repetidas, automaticas }
  })
  return NextResponse.json(salida)
}
