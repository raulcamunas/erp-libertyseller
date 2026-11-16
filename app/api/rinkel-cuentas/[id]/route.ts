import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth/api'
import { cifrarClave, validarCuenta } from '@/lib/rinkel-cuentas'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Cambia el correo, las notas o la contraseña (clave '' = quitarla; sin clave = no tocarla) */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const s = await requireAdmin()
  if (s instanceof NextResponse) return s
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Cuenta no válida' }, { status: 400 })
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const v = validarCuenta(body, false)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
  const cambios: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (v.email !== undefined) cambios.email = v.email
  if (v.notas !== undefined) cambios.notas = v.notas
  if (v.clave !== undefined) {
    try {
      cambios.password_cifrada = v.clave === '' ? null : cifrarClave(v.clave)
    } catch {
      return NextResponse.json({ error: 'El servidor no tiene la clave de cifrado configurada.' }, { status: 503 })
    }
  }
  const { data, error } = await createServiceClient().from('rinkel_cuentas').update(cambios).eq('id', params.id).select('id, email, password_cifrada, notas, position').single()
  if (error || !data) return NextResponse.json({ error: 'No se ha podido guardar' }, { status: 500 })
  const c = data as { id: string; email: string; password_cifrada: string | null; notas: string | null; position: number | null }
  return NextResponse.json({ cuenta: { id: c.id, email: c.email, tiene_clave: !!c.password_cifrada, notas: c.notas, position: c.position } })
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const s = await requireAdmin()
  if (s instanceof NextResponse) return s
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Cuenta no válida' }, { status: 400 })
  const { error } = await createServiceClient().from('rinkel_cuentas').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: 'No se ha podido borrar' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
