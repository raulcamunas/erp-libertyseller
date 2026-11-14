import { NextResponse, type NextRequest } from 'next/server'
import { UUID, requireAppAccess } from '@/lib/amazon/api'
import { MARCA_BAJA, MARCA_ENVIADO } from '@/lib/analisis-amazon/correo-servidor'
import { ultimoAnalisisDelLead } from '@/lib/analisis-amazon/servidor'
import { esSinAmazon } from '@/lib/analisis-sin-amazon/construir'
import { depurar } from '@/lib/analisis-sin-amazon/calidad'
import { createServiceClient } from '@/lib/supabase/service'

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

  const [a, { data: correos }] = await Promise.all([
    ultimoAnalisisDelLead(leadId),
    createServiceClient()
      .from('cold_lead_notes')
      .select('body, occurred_at')
      .eq('lead_id', leadId)
      .in('kind', ['email', 'nota'])
      .order('occurred_at', { ascending: false })
      .limit(80),
  ])
  if (!a) return NextResponse.json({ analisis: null }, { headers: { 'Cache-Control': 'no-store' } })
  const filas = (correos ?? []) as Array<{ body: string; occurred_at: string }>
  // El de una tienda sin Amazon se lee con sus límites: la chuleta no cita mercados que el informe no enseña, y la ficha ve su calidad
  const dep = esSinAmazon(a.informe) ? depurar(a.informe) : null
  return NextResponse.json(
    {
      analisis: {
        token: a.token,
        fecha: a.fecha,
        tipo: a.informe?.tipoTexto ?? null,
        guion: (dep ?? a.informe)?.guion ?? null,
        calidad: dep ? { nivel: dep.calidad.nivel, motivos: dep.calidad.motivos } : null,
        aperturas: a.aperturas,
        abiertoPrimera: a.abierto_primera_at,
        abiertoUltima: a.abierto_ultima_at,
        correoEnviadoAt: filas.find((f) => f.body.includes(MARCA_ENVIADO))?.occurred_at ?? null,
        baja: filas.some((f) => f.body.startsWith(MARCA_BAJA)),
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
