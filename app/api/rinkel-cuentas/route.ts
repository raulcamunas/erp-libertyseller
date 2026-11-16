import { NextResponse, type NextRequest } from 'next/server'
import { requireAdmin } from '@/lib/auth/api'
import { cifrarClave, validarCuenta, type CuentaRinkel } from '@/lib/rinkel-cuentas'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * CUENTAS DE RINKEL (correo + contraseña). Solo administradores. La contraseña se guarda CIFRADA y NO sale en la lista:
 * se pide a /api/rinkel-cuentas/[id]/clave solo cuando alguien pulsa «ver» o «copiar».
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SIN_CACHE = { 'Cache-Control': 'no-store' }

export async function GET() {
  const s = await requireAdmin()
  if (s instanceof NextResponse) return s
  const { data, error } = await createServiceClient().from('rinkel_cuentas').select('id, email, password_cifrada, notas, position').order('position', { ascending: true, nullsFirst: false })
  if (error) {
    const sinMigrar = /rinkel_cuentas/.test(error.message) && /does not exist|schema cache|relation/i.test(error.message)
    return NextResponse.json({ error: sinMigrar ? 'Falta lanzar la migración 319 (Cuentas de Rinkel).' : 'No se han podido leer las cuentas', sinMigrar }, { status: sinMigrar ? 503 : 500, headers: SIN_CACHE })
  }
  const cuentas: CuentaRinkel[] = ((data ?? []) as Array<{ id: string; email: string; password_cifrada: string | null; notas: string | null; position: number | null }>).map((c) => ({ id: c.id, email: c.email, tiene_clave: !!c.password_cifrada, notas: c.notas, position: c.position }))
  return NextResponse.json({ cuentas }, { headers: SIN_CACHE })
}

export async function POST(request: NextRequest) {
  const s = await requireAdmin()
  if (s instanceof NextResponse) return s
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const v = validarCuenta(body, true)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
  const service = createServiceClient()
  const { data: ultima } = await service.from('rinkel_cuentas').select('position').order('position', { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
  let password_cifrada: string | null = null
  try {
    password_cifrada = v.clave ? cifrarClave(v.clave) : null
  } catch {
    return NextResponse.json({ error: 'El servidor no tiene la clave de cifrado configurada: no se puede guardar la contraseña.' }, { status: 503 })
  }
  const { data, error } = await service.from('rinkel_cuentas').insert({ email: v.email, notas: v.notas ?? null, password_cifrada, position: ((ultima as { position: number | null } | null)?.position ?? 0) + 1 }).select('id, email, password_cifrada, notas, position').single()
  if (error || !data) return NextResponse.json({ error: 'No se ha podido crear la cuenta' }, { status: 500 })
  const c = data as { id: string; email: string; password_cifrada: string | null; notas: string | null; position: number | null }
  return NextResponse.json({ cuenta: { id: c.id, email: c.email, tiene_clave: !!c.password_cifrada, notas: c.notas, position: c.position } satisfies CuentaRinkel }, { status: 201, headers: SIN_CACHE })
}
