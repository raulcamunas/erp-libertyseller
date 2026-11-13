import { NextResponse, type NextRequest } from 'next/server'
import { UUID } from '@/lib/amazon/api'
import { enviarCorreoDelAnalisis, prepararCorreo } from '@/lib/analisis-amazon/correo-servidor'
import { requerirCorreo } from '@/lib/correo/rutas'

/**
 * EL CORREO CON EL ANÁLISIS DE AMAZON DE UN LEAD (lib/analisis-amazon/correo-servidor.ts).
 *   GET  ?lead=   prepara el borrador: la IA escribe asunto y entradilla para ESTE lead; devuelve también el informe para la vista previa
 *   POST {leadId, para, asunto, saludo, entradilla}   lo envía desde el buzón de quien lo pide y lo apunta en el historial del lead
 * Solo el equipo con Correo, y solo sobre leads que su sesión puede ver.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const SIN_CACHE = { 'Cache-Control': 'no-store' }

export async function GET(request: NextRequest) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion
  const leadId = request.nextUrl.searchParams.get('lead') ?? ''
  if (!UUID.test(leadId)) return NextResponse.json({ error: 'Lead no válido' }, { status: 400 })
  try {
    const r = await prepararCorreo(sesion, leadId.toLowerCase())
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.estado, headers: SIN_CACHE })
    return NextResponse.json(r, { headers: SIN_CACHE })
  } catch (e) {
    console.error('[analisis-correo] fallo al preparar', { mensaje: (e as Error).message })
    return NextResponse.json({ error: 'No se ha podido preparar el correo. Vuelve a probar.' }, { status: 500, headers: SIN_CACHE })
  }
}

export async function POST(request: NextRequest) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion
  let b: Record<string, unknown>
  try {
    b = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'No se ha entendido lo que se ha mandado' }, { status: 400 })
  }
  const txt = (v: unknown) => (typeof v === 'string' ? v : '')
  const leadId = txt(b.leadId)
  if (!UUID.test(leadId)) return NextResponse.json({ error: 'Lead no válido' }, { status: 400 })
  try {
    const r = await enviarCorreoDelAnalisis(sesion, { leadId: leadId.toLowerCase(), para: txt(b.para), asunto: txt(b.asunto), saludo: txt(b.saludo), entradilla: txt(b.entradilla) })
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.estado, headers: SIN_CACHE })
    return NextResponse.json(r, { headers: SIN_CACHE })
  } catch (e) {
    console.error('[analisis-correo] fallo al enviar', { mensaje: (e as Error).message })
    return NextResponse.json({ error: 'No se ha podido enviar. Revisa en Correo → Enviados si ha salido antes de repetirlo.' }, { status: 500, headers: SIN_CACHE })
  }
}
