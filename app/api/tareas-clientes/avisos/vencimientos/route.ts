import { conPermiso } from '@/lib/tareas-clientes/rutas'
import { generarAvisosDeFecha } from '@/lib/tareas-clientes/servidor'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Los recordatorios de fecha de quien lo pide: «vence hoy», «vence mañana» y el resumen de vencidas. Lo llama la campana al abrir el ERP y cada media hora */
export async function POST() {
  return conPermiso(async (p) => ({ avisos: await generarAvisosDeFecha(p.userId, p.clientes) }))
}
