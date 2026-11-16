import { NextResponse, type NextRequest } from 'next/server'
import { HOJAS_DE_CAJA, type HojaDeCaja } from '@/lib/fba/inbound-v2024'
import { SIN_CACHE, respuestaDeFallo, soloAdminConRemesa } from '@/lib/fba/envio-amazon-http'
import { enlacesDeEtiquetas, enlacesDeEtiquetasDePalet } from '@/lib/fba/envio-amazon-motor'
import { registrarEnHistorial } from '@/lib/fba/historial'

/**
 * LAS ETIQUETAS DE CAJA Y DE UPS (getLabels v0), por envío FBA. Devuelve enlaces de Amazon que CADUCAN:
 * se piden al pulsar y se abren al momento.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const p = await soloAdminConRemesa(params.id)
    if (p instanceof NextResponse) return p
    const body = (await request.json().catch(() => ({}))) as { hoja?: unknown; tipo?: unknown }
    const hoja: HojaDeCaja = typeof body.hoja === 'string' && body.hoja in HOJAS_DE_CAJA ? (body.hoja as HojaDeCaja) : 'a4_2'
    const tipo = body.tipo === 'palet' ? 'palet' : 'caja'
    const enlaces = tipo === 'palet' ? await enlacesDeEtiquetasDePalet(params.id, hoja) : await enlacesDeEtiquetas(params.id, hoja)
    await registrarEnHistorial({ remesaId: params.id, actor: 'agencia', userId: p.sesion.userId, accion: 'etiquetas', detalle: { tipo, hoja, envios: enlaces.length } })
    return NextResponse.json({ enlaces }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFallo(error, 'No se han podido pedir las etiquetas de caja')
  }
}
