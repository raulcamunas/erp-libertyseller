import { NextResponse, type NextRequest } from 'next/server'
import { registrarBaja } from '@/lib/analisis-amazon/correo-servidor'
import { analisisPorToken } from '@/lib/analisis-amazon/servidor'

/**
 * LA BAJA DEL CORREO DEL ANÁLISIS (pública, como la página del informe).
 * POST {token}: desde la página /analisis/<token>/baja al pulsar el botón, y POST con el cuerpo «List-Unsubscribe=One-Click» de Gmail/Outlook.
 * Se pide pulsar (no basta con abrir el enlace): los antivirus de correo abren todos los enlaces y darían de baja a quien no lo ha pedido.
 */
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  let token = request.nextUrl.searchParams.get('t') ?? ''
  if (!token) {
    try {
      token = String(((await request.json()) as { token?: unknown }).token ?? '')
    } catch {
      token = ''
    }
  }
  const a = await analisisPorToken(token)
  if (!a) return NextResponse.json({ error: 'Enlace no válido' }, { status: 404 })
  await registrarBaja(a.lead_id, a.informe?.vendedor?.nombre ?? 'el lead')
  return NextResponse.json({ ok: true })
}
