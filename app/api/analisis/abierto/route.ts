import { NextResponse, type NextRequest } from 'next/server'
import { analisisPorToken, registrarApertura } from '@/lib/analisis-amazon/servidor'
import { createClient } from '@/lib/supabase/server'

/**
 * EL LEAD HA ABIERTO SU ANÁLISIS (lo llama la página pública, sin sesión).
 * La única credencial es el token del informe. No se guarda nada de quien abre salvo si es móvil u ordenador. Si quien lo abre tiene
 * sesión en el ERP (un comercial comprobando el enlace), no se cuenta ni se avisa a nadie.
 */
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  let cuerpo: { token?: unknown; dispositivo?: unknown }
  try {
    cuerpo = (await request.json()) as typeof cuerpo
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 })
  }
  const token = typeof cuerpo.token === 'string' ? cuerpo.token : ''
  const dispositivo = cuerpo.dispositivo === 'movil' || cuerpo.dispositivo === 'ordenador' ? cuerpo.dispositivo : null

  const a = await analisisPorToken(token)
  if (!a) return NextResponse.json({ ok: false }, { status: 404 })

  try {
    const { data } = await (await createClient()).auth.getUser()
    if (data.user) return NextResponse.json({ ok: true, equipo: true })
  } catch {
    /* sin sesión: es el lead */
  }

  await registrarApertura(a, dispositivo)
  return NextResponse.json({ ok: true })
}
