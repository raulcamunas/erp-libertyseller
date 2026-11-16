import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth/api'
import { descifrarClave } from '@/lib/rinkel-cuentas'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** La contraseña descifrada de UNA cuenta, solo cuando un administrador pulsa «ver» o «copiar». Nunca se cachea */
export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const s = await requireAdmin()
  if (s instanceof NextResponse) return s
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Cuenta no válida' }, { status: 400 })
  const { data } = await createServiceClient().from('rinkel_cuentas').select('password_cifrada').eq('id', params.id).maybeSingle()
  const guardada = (data as { password_cifrada: string | null } | null)?.password_cifrada
  if (!guardada) return NextResponse.json({ error: 'Esta cuenta no tiene contraseña guardada' }, { status: 404 })
  try {
    return NextResponse.json({ clave: descifrarClave(guardada) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'No se ha podido descifrar (¿cambió la clave de cifrado del servidor?)' }, { status: 500 })
  }
}
