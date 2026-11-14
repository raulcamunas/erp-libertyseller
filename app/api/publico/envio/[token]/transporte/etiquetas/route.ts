import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { entrarConEnlace, respuestaDeFalloInterno } from '@/lib/fba/encaje-http'
import { FalloDelEnvio, enlacesDeEtiquetas } from '@/lib/fba/envio-amazon-motor'
import { registrarEnHistorial } from '@/lib/fba/historial'
import { HOJAS_DE_CAJA, type HojaDeCaja } from '@/lib/fba/inbound-v2024'
import { ipDe } from '@/lib/fba/limite-publico'

/**
 * LAS ETIQUETAS DE CAJA Y DE UPS DESDE EL ENLACE DEL CLIENTE, cuando el transporte está confirmado.
 * Devuelve los enlaces de Amazon (caducan): se abren al momento. Con el límite de «etiquetas» (12/min).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: NextRequest, { params }: { params: { token: string } }) {
  try {
    const r = await entrarConEnlace(request, params.token, 'etiquetas')
    if (r instanceof NextResponse) return r
    const body = (await request.json().catch(() => ({}))) as { hoja?: unknown }
    const hoja: HojaDeCaja = typeof body.hoja === 'string' && body.hoja in HOJAS_DE_CAJA ? (body.hoja as HojaDeCaja) : 'a4_2'
    let enlaces
    try {
      enlaces = await enlacesDeEtiquetas(r.remesa.id, hoja)
    } catch (e) {
      if (e instanceof FalloDelEnvio) return fail(409, 'Las etiquetas de caja todavía no están disponibles')
      throw e
    }
    await registrarEnHistorial({ remesaId: r.remesa.id, actor: 'enlace', enlaceId: r.enlace.id, accion: 'etiquetas', ip: ipDe(request), detalle: { tipo: 'caja', hoja, envios: enlaces.length } })
    // Al cliente no se le cuenta el detalle técnico de un fallo de Amazon
    return NextResponse.json(
      { enlaces: enlaces.map((e) => ({ confirmacion: e.confirmacion, cajas: e.cajas, url: e.url, error: e.error ? 'No se han podido generar ahora. Vuelve a probar en un minuto.' : null })) },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    return respuestaDeFalloInterno(error, 'Portal del cliente: no se han podido pedir las etiquetas de caja')
  }
}
