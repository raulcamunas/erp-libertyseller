import { NextResponse } from 'next/server'
import { errorResponse } from '@/lib/amazon/api'
import { requireFbaAccess } from '@/lib/fba/acceso'
import { diaEnEspana } from '@/lib/fba/fechas'
import { tableroDeRemesas } from '@/lib/fba/tablero-datos'

/**
 * EL TABLERO DE REMESAS: todas las propuestas en marcha de los clientes que ve quien pregunta, por fases.
 * Se pide al abrir la pestaña «Tablero» y al pulsar «Actualizar»; no hay sondeo.
 */
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const sesion = await requireFbaAccess('ver')
    if (sesion instanceof NextResponse) return sesion
    const hoy = diaEnEspana()
    const tarjetas = await tableroDeRemesas(sesion, hoy)
    return NextResponse.json({ hoy, tarjetas, verComo: sesion.actor }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error, 'No se ha podido leer el tablero')
  }
}
