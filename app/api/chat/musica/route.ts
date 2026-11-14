import type { NextRequest } from 'next/server'
import { accionDeMusica, leerMusica } from '@/lib/chat/musica-servidor'
import { conChat, cuerpoDe } from '@/lib/chat/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** La música de la sala de un canal: `?canalId=` → `{ estado, ahora }` (`ahora` es la hora del servidor, para que cada navegador calcule por dónde va la pista) */
export async function GET(request: NextRequest) {
  const canalId = request.nextUrl.searchParams.get('canalId')
  return conChat((quien) => leerMusica(quien, canalId))
}

/**
 * Hacer algo con la música de la sala (solo quien está dentro): `{ canalId, accion }` con `anadir` (`ids`: vídeos de YouTube ya sacados del enlace o de la lista), `siguiente` (`desde`: la pista que acabó),
 * `anterior`, `pausar`, `reanudar`, `buscar` (`posMs`), `saltar` (`ms`, con signo: rebobinar o adelantar), `irA` (`indice`), `quitar` (`id`) y `vaciar`.
 */
export async function POST(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conChat((quien) => accionDeMusica(quien, c.canalId, c))
}
