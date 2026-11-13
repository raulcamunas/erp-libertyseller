import { NextResponse, type NextRequest } from 'next/server'
import { UUID, requireAppAccess } from '@/lib/amazon/api'
import { ultimoAnalisisDelLead } from '@/lib/analisis-amazon/servidor'

/**
 * EL ANÁLISIS DE AMAZON DE UN LEAD, PARA SU FICHA.
 * Antes se comprueba con la sesión de quien mira (la RLS de cold_leads) que el lead es suyo o que es admin; luego se lee el informe con la
 * clave de servicio. Devuelve lo que pinta la ficha: el enlace, la fecha, las aperturas y la chuleta para la llamada (no el informe entero).
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const sesion = await requireAppAccess('cold-calling')
  if (sesion instanceof NextResponse) return sesion
  const leadId = request.nextUrl.searchParams.get('lead') ?? ''
  if (!UUID.test(leadId)) return NextResponse.json({ error: 'Lead no válido' }, { status: 400 })

  const { data: lead } = await sesion.supabase.from('cold_leads').select('id').eq('id', leadId).maybeSingle()
  if (!lead) return NextResponse.json({ error: 'No tienes acceso a este lead' }, { status: 404 })

  const a = await ultimoAnalisisDelLead(leadId)
  if (!a) return NextResponse.json({ analisis: null }, { headers: { 'Cache-Control': 'no-store' } })
  return NextResponse.json(
    {
      analisis: {
        token: a.token,
        fecha: a.fecha,
        tipo: a.informe?.tipoTexto ?? null,
        guion: a.informe?.guion ?? null,
        aperturas: a.aperturas,
        abiertoPrimera: a.abierto_primera_at,
        abiertoUltima: a.abierto_ultima_at,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
