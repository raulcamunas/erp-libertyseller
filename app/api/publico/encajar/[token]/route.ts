import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { MAX_BYTES_ENCAJE, datosParaEncajar, guardarEncaje } from '@/lib/fba/encaje-enlace'
import { entrarConEnlace, respuestaDeFalloInterno } from '@/lib/fba/encaje-http'
import { leerCuerpoConTope } from '@/lib/subidas-limite'

/**
 * LA PÁGINA PÚBLICA DEL ENCAJE: LEER Y GUARDAR LAS CAJAS.
 *
 * SIN SESIÓN: quien llega trae un enlace (lib/fba/encaje-enlace.ts) y el enlace da paso a UN envío y a
 * nada más. El middleware deja pasar todo /api/; el filtro de verdad está dentro: `entrarConEnlace`
 * frena al que insiste y comprueba el token, y `guardarEncaje` repite las reglas del ERP con otras
 * más estrictas (solo referencias de este envío y nunca más unidades de las declaradas).
 *
 * El cuerpo se lee con tope y a trozos —`leerCuerpoConTope`— porque aquí no hay sesión que corte antes
 * de que se coma la memoria: ver lib/subidas-limite.ts.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

const SIN_CACHE = { 'Cache-Control': 'no-store' }

export async function GET(request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const r = await entrarConEnlace(request, params.token, 'ver')
    if (r instanceof NextResponse) return r
    return NextResponse.json(await datosParaEncajar(r), { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFalloInterno(error, 'Encaje público: no se han podido leer las cajas')
  }
}

export async function PUT(request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const r = await entrarConEnlace(request, params.token, 'guardar')
    if (r instanceof NextResponse) return r

    const cuerpo = await leerCuerpoConTope(request, MAX_BYTES_ENCAJE)
    if (cuerpo instanceof NextResponse) return cuerpo

    let json: unknown
    try {
      json = JSON.parse(cuerpo.texto)
    } catch {
      return fail(400, 'No se ha entendido lo que se ha mandado')
    }

    const res = await guardarEncaje(r, (json as { cajas?: unknown } | null)?.cajas)
    if (!res.ok) return fail(res.estado, res.error)
    return NextResponse.json({ ok: true, guardadoAt: res.guardadoAt, cajas: res.cajas, listo: res.listo }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFalloInterno(error, 'Encaje público: no se han podido guardar las cajas')
  }
}
