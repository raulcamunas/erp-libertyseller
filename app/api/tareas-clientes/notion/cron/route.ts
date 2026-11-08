import { NextResponse, type NextRequest } from 'next/server'
import { sincronizarTodo } from '@/lib/tareas-clientes/notion/sync'
import { ejecutarRecurrencias } from '@/lib/tareas-clientes/plantillas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * LA PASADA PERIÓDICA CON NOTION (cada minuto, desde el mismo programador que llama a /api/correo/cron).
 *
 * Es la red de seguridad del webhook: si Notion no avisa de un cambio, esta pasada lo trae. Solo se entra con la cabecera x-cron-secret (CRON_SECRET). Una pasada que
 * encuentra otra en marcha se salta sola (el turno de sync.ts), así que no se acumulan.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  // Las tareas que se repiten sin que nadie tenga el ERP abierto: se crean aquí
  const repetidas = await ejecutarRecurrencias().catch(() => ({ creadas: 0, fallidas: 0 }))
  const r = await sincronizarTodo({ presupuestoMs: 50_000 })
  return NextResponse.json({ ...r, repetidas })
}
