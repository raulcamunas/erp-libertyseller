import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { terminarEncaje } from '@/lib/fba/encaje-enlace'
import { entrarConEnlace, respuestaDeFalloInterno } from '@/lib/fba/encaje-http'

/**
 * «HE TERMINADO DE ENCAJAR», DESDE LA PÁGINA PÚBLICA.
 *
 * El mismo paso de «Encajando» a «Lista para enviar» que da el cliente en el ERP, con las mismas
 * comprobaciones (`puedeAvanzar`, de lib/fba/flujo.ts): que las cajas cuadren con lo declarado y que
 * cada una tenga medidas y peso. Lo decide la base en este instante, no lo que la página crea tener.
 * Si no se puede, se devuelven TODOS los motivos de una vez, ya resumidos.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const r = await entrarConEnlace(request, params.token, 'terminar')
    if (r instanceof NextResponse) return r

    const res = await terminarEncaje(r)
    if (!res.ok) {
      return res.motivos ? NextResponse.json({ error: res.error, motivos: res.motivos }, { status: res.estado }) : fail(res.estado, res.error)
    }
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return respuestaDeFalloInterno(error, 'Encaje público: no se ha podido terminar')
  }
}
