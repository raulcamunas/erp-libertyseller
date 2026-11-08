import type { NextRequest } from 'next/server'
import { generarAutomaticas, guardarFuente, panelDeAutomaticas, vincularConAmazon } from '@/lib/tareas-clientes/automaticas-servidor'
import { conPermiso, cuerpoDe } from '@/lib/tareas-clientes/rutas'
import { ErrorDeTareas } from '@/lib/tareas-clientes/servidor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

/** Las tareas que crea el ERP: qué fuentes hay, cuáles están encendidas y cómo se cruzan los clientes con los de Amazon. Solo administradores */
export async function GET() {
  return conPermiso(async (p) => {
    if (!p.esAdmin) throw new ErrorDeTareas('Solo un administrador puede ver esto.', 403)
    return panelDeAutomaticas()
  })
}

/**
 * `{ fuente, activa?, estado?, responsables? }` cambia una fuente; `{ vincular: { clienteId, amazonClientId } }` enlaza un cliente a mano;
 * `{ ejecutar: true }` hace una pasada ahora mismo.
 */
export async function PUT(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conPermiso(async (p) => {
    if (!p.esAdmin) throw new ErrorDeTareas('Solo un administrador puede cambiar esto.', 403)
    if (c.ejecutar === true) return { resumen: await generarAutomaticas({ forzar: true }), panel: await panelDeAutomaticas() }
    if (c.vincular && typeof c.vincular === 'object') {
      const v = c.vincular as Record<string, unknown>
      await vincularConAmazon(String(v.clienteId ?? ''), typeof v.amazonClientId === 'string' && v.amazonClientId ? v.amazonClientId : null)
    } else {
      await guardarFuente(p.userId, c.fuente, c)
    }
    return { panel: await panelDeAutomaticas() }
  })
}
