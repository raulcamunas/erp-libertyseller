import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { entrarConEnlace, respuestaDeFalloInterno } from '@/lib/fba/encaje-http'
import { aceptarTransporte, transporteParaElCliente } from '@/lib/fba/envio-amazon-motor'
import { ipDe } from '@/lib/fba/limite-publico'
import { leerCuerpoConTope } from '@/lib/subidas-limite'

/**
 * EL TRANSPORTE EN EL PORTAL DEL CLIENTE (/envio/<token>, fase «Envío»).
 *
 *   GET  → la cotización del transporte (UPS de Amazon) con su coste y caducidad, y si ya la aceptó.
 *   POST → «Acepto el coste del transporte» con su nombre y el coste que ve. Guarda fecha, IP y quién. NO
 *          confirma nada en Amazon: después la agencia confirma el transporte (decisión de Raúl).
 *
 * SIN SESIÓN: el token es la credencial y todo pasa por `entrarConEnlace` (límite + token).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const SIN_CACHE = { 'Cache-Control': 'no-store' }

export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const r = await entrarConEnlace(request, params.token, 'ver')
    if (r instanceof NextResponse) return r
    return NextResponse.json({ transporte: await transporteParaElCliente(r.remesa.id) }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFalloInterno(error, 'Portal del cliente: no se ha podido leer el transporte')
  }
}

export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const r = await entrarConEnlace(request, params.token, 'aceptar')
    if (r instanceof NextResponse) return r
    const cuerpo = await leerCuerpoConTope(request, 4 * 1024)
    if (cuerpo instanceof NextResponse) return cuerpo
    let json: { nombre?: unknown; coste?: unknown } | null
    try {
      json = JSON.parse(cuerpo.texto)
    } catch {
      return fail(400, 'No se ha entendido lo que se ha mandado')
    }
    const coste = typeof json?.coste === 'number' ? json.coste : NaN
    if (!Number.isFinite(coste)) return fail(400, 'Falta el coste que has visto')
    const res = await aceptarTransporte(r.remesa.id, { nombre: typeof json?.nombre === 'string' ? json.nombre : '', costeVisto: coste, ip: ipDe(request), enlaceId: r.enlace.id })
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.estado, headers: SIN_CACHE })
    return NextResponse.json({ ok: true, transporte: await transporteParaElCliente(r.remesa.id) }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFalloInterno(error, 'Portal del cliente: no se ha podido aceptar el transporte')
  }
}
