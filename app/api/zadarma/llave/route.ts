import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { llaveDelTelefono } from '@/lib/zadarma/servidor'
import { hayZadarma } from '@/lib/zadarma/api'

/**
 * La llave del teléfono web de Zadarma de QUIEN PIDE (su extensión de la centralita, migración 326). Sin extensión, 404: el teléfono no se enseña.
 * La llave dura 72 h y solo sirve para esa extensión; la clave de la API no sale nunca del servidor.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Hay que iniciar sesión' }, { status: 401 })
  if (!hayZadarma()) return NextResponse.json({ error: 'Zadarma no está configurado en el servidor.' }, { status: 503 })
  try {
    const llave = await llaveDelTelefono(user.id)
    if (!llave) return NextResponse.json({ error: 'No tienes extensión de Zadarma.' }, { status: 404 })
    return NextResponse.json(llave, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[zadarma] llave', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'No se ha podido preparar el teléfono. Prueba otra vez en un momento.' }, { status: 502 })
  }
}
