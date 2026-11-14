import type { NextRequest } from 'next/server'
import { cerrarEncuesta, ErrorDeChat, votar } from '@/lib/chat/servidor'
import { conChat, cuerpoDe } from '@/lib/chat/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Votar en una encuesta (`{ accion: 'votar', id, opcion }`) o cerrarla (`{ accion: 'cerrar', id }`) */
export async function POST(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conChat((quien) => {
    if (c.accion === 'votar') return votar(quien, c.id, c.opcion)
    if (c.accion === 'cerrar') return cerrarEncuesta(quien, c.id)
    throw new ErrorDeChat('Esa acción no existe.')
  })
}
