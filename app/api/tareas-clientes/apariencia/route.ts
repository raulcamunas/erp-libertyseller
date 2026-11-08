import type { NextRequest } from 'next/server'
import { guardarApariencia, leerApariencias } from '@/lib/tareas-clientes/apariencia-servidor'
import { conPermiso, cuerpoDe } from '@/lib/tareas-clientes/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** El icono y el color que ha elegido cada persona: `{ mapa, disponible }` */
export async function GET() {
  return conPermiso(async () => leerApariencias())
}

/** Elige el tuyo: `{ color: 'azul' | null, icono: 'cohete' | null }`. Lo que ya tiene otra persona se rechaza (409) */
export async function PUT(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conPermiso(async (p) => ({ mapa: await guardarApariencia(p.userId, { color: c.color, icono: c.icono }) }))
}
