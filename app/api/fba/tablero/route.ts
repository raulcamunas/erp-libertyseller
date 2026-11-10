import { NextResponse } from 'next/server'
import { errorResponse } from '@/lib/amazon/api'
import { requireFbaAccess } from '@/lib/fba/acceso'
import { diaEnEspana } from '@/lib/fba/fechas'
import { columnasDelTablero } from '@/lib/fba/tablero-servidor'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * EL TABLERO DE REMESAS: los envíos de TODOS los clientes que esta persona puede ver, en columnas (una por cliente).
 *
 * Un admin ve todos los de amazon_clients; cualquier otro, solo los de fba_accesos (y la lista se calcula aquí, en el servidor, como en la pantalla principal). Nunca se pide un cliente por id:
 * no hay forma de leer uno que no esté en la lista de la sesión.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  try {
    const sesion = await requireFbaAccess('ver')
    if (sesion instanceof NextResponse) return sesion
    const service = createServiceClient()
    let clientes: Array<{ id: string; nombre: string; puedeEditar: boolean }>
    if (sesion.clientesPermitidos === null) {
      const { data } = await service.from('amazon_clients').select('id, name').order('name', { ascending: true })
      clientes = ((data ?? []) as Array<{ id: string; name: string }>).map((c) => ({ id: c.id, nombre: c.name, puedeEditar: true }))
    } else {
      const { data } = await service.from('amazon_clients').select('id, name').in('id', sesion.clientesPermitidos)
      const editables = new Set(sesion.clientesEditables ?? [])
      clientes = ((data ?? []) as Array<{ id: string; name: string }>).map((c) => ({ id: c.id, nombre: c.name, puedeEditar: editables.has(c.id) }))
    }
    const columnas = await columnasDelTablero(clientes, diaEnEspana())
    return NextResponse.json({ ok: true, hoy: diaEnEspana(), columnas })
  } catch (error) {
    return errorResponse(error, 'No se ha podido leer el tablero de remesas')
  }
}
