import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { entrarConEnlace, respuestaDeFalloInterno } from '@/lib/fba/encaje-http'
import { ipDe } from '@/lib/fba/limite-publico'
import { datosDelPortal, guardarPropuestaDelCliente } from '@/lib/fba/portal'
import { MAX_BYTES_PROPUESTA } from '@/lib/fba/propuesta-cliente'
import { leerCuerpoConTope } from '@/lib/subidas-limite'

/**
 * EL PORTAL DEL CLIENTE (/envio/<token>): LEERLO Y GUARDAR SUS CAMBIOS A LA PROPUESTA.
 *
 * SIN SESIÓN: el token es la credencial (lib/fba/encaje-enlace.ts) y da paso a UN envío. Todo pasa por
 * `entrarConEnlace` (límite de peticiones + token) y lo que se guarda lo decide lib/fba/portal.ts con las
 * reglas de lib/fba/propuesta-cliente.ts: solo cantidades, comentarios y productos de SU catálogo.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const SIN_CACHE = { 'Cache-Control': 'no-store' }

export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const r = await entrarConEnlace(request, params.token, 'ver')
    if (r instanceof NextResponse) return r
    return NextResponse.json(await datosDelPortal(r), { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFalloInterno(error, 'Portal del cliente: no se ha podido leer el envío')
  }
}

export async function PUT(request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const r = await entrarConEnlace(request, params.token, 'propuesta')
    if (r instanceof NextResponse) return r

    const cuerpo = await leerCuerpoConTope(request, MAX_BYTES_PROPUESTA)
    if (cuerpo instanceof NextResponse) return cuerpo
    let json: { lineas?: unknown; version?: unknown } | null
    try {
      json = JSON.parse(cuerpo.texto)
    } catch {
      return fail(400, 'No se ha entendido lo que se ha mandado')
    }

    const res = await guardarPropuestaDelCliente(r, json ?? {}, ipDe(request))
    if (!res.ok) return NextResponse.json({ error: res.error, conflicto: res.conflicto ?? false }, { status: res.estado, headers: SIN_CACHE })
    return NextResponse.json({ ok: true, version: res.version, lineas: res.lineas }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFalloInterno(error, 'Portal del cliente: no se ha podido guardar la propuesta')
  }
}
