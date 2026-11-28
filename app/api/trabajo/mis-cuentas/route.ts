import type { NextRequest } from 'next/server'
import { conPermiso } from '@/lib/tareas-clientes/rutas'
import { misCuentasHoy } from '@/lib/trabajo/mis-cuentas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** «Tus cuentas hoy» de «Mi día» (lib/trabajo/mis-cuentas.ts). Un administrador puede ver las de otra persona con ?usuario= */
export async function GET(request: NextRequest) {
  const pedido = request.nextUrl.searchParams.get('usuario')
  return conPermiso(async (p) => {
    const quien = pedido && p.esAdmin ? pedido : p.userId
    return { cuentas: await misCuentasHoy(quien) }
  })
}
