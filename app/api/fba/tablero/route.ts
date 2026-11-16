import { NextResponse } from 'next/server'
import { errorResponse } from '@/lib/amazon/api'
import { requireFbaAccess } from '@/lib/fba/acceso'
import { clientesDeSesion } from '@/lib/fba/clientes-de-sesion'
import { diaEnEspana } from '@/lib/fba/fechas'
import { columnasDelTablero } from '@/lib/fba/tablero-servidor'

/**
 * EL TABLERO DE REMESAS: los envíos de TODOS los clientes que esta persona puede ver, en columnas (una por cliente).
 *
 * Un admin o un empleado con la casilla `remesas` ve todos los de amazon_clients; cualquier otro, solo los de fba_accesos (D27: la lista sale de
 * clientesDeSesion, la misma que la pantalla principal). Un cliente de fuera con varias cuentas ve aquí un tablero reducido de las suyas (D39). Nunca se pide un cliente por id:
 * no hay forma de leer uno que no esté en la lista de la sesión.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  try {
    const sesion = await requireFbaAccess('ver')
    if (sesion instanceof NextResponse) return sesion
    // La lista sale de la misma puerta que la página (clientesDeSesion): filtrada en la consulta, nunca en pantalla. Sin detalle: el
    // tablero no necesita lecturas, catálogo ni salud.
    const { clientes: deSesion } = await clientesDeSesion(sesion.userId, { detalle: false })
    const clientes = deSesion.map((c) => ({ id: c.id, nombre: c.nombre, puedeEditar: c.puedeEditar }))
    const hoy = diaEnEspana()
    const columnas = await columnasDelTablero(clientes, hoy)
    return NextResponse.json({ ok: true, hoy, columnas })
  } catch (error) {
    return errorResponse(error, 'No se ha podido leer el tablero de remesas')
  }
}
