import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { entrarConEnlace, respuestaDeFalloInterno } from '@/lib/fba/encaje-http'
import { ipDe } from '@/lib/fba/limite-publico'
import { aceptarPropuesta } from '@/lib/fba/portal'
import { leerCuerpoConTope } from '@/lib/subidas-limite'

/**
 * «ACEPTO» DESDE EL PORTAL DEL CLIENTE.
 *
 * NO aprueba el envío: lo deja pendiente de revisión, con el nombre que escribe, la hora y la IP. La agencia
 * ve las diferencias frente a lo propuesto y aprueba desde el ERP (decisión de Raúl, 14 nov 2026).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const r = await entrarConEnlace(request, params.token, 'aceptar')
    if (r instanceof NextResponse) return r
    const cuerpo = await leerCuerpoConTope(request, 8 * 1024)
    if (cuerpo instanceof NextResponse) return cuerpo
    let json: { nombre?: unknown; comentario?: unknown; version?: unknown } | null
    try {
      json = JSON.parse(cuerpo.texto)
    } catch {
      return fail(400, 'No se ha entendido lo que se ha mandado')
    }
    const res = await aceptarPropuesta(r, json ?? {}, ipDe(request))
    if (!res.ok) return NextResponse.json({ error: res.error, conflicto: res.conflicto ?? false }, { status: res.estado, headers: { 'Cache-Control': 'no-store' } })
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return respuestaDeFalloInterno(error, 'Portal del cliente: no se ha podido aceptar la propuesta')
  }
}
