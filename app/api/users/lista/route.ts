import { NextResponse } from 'next/server'
import { estaDesactivado } from '@/lib/usuarios/gestion'
import { requireGestorDeUsuarios } from '@/lib/usuarios/gestion-servidor'

export const dynamic = 'force-dynamic'

/**
 * LA LISTA DE USUARIOS PARA GESTIÓN DE USUARIOS. SOLO EL GESTOR DE USUARIOS (lib/usuarios/gestion.ts).
 *
 * Tres consultas en total, sin N+1: los perfiles, todas las casillas y el sistema de acceso (para saber quién está desactivado y cuándo entró por última vez, que no está en
 * `profiles`). Hay decenas de usuarios, así que va todo de una vez y la pantalla filtra en el navegador. Si el sistema de acceso no contesta, la lista sale igual, sin estado.
 */

interface UsuarioAuth {
  id: string
  last_sign_in_at?: string | null
  banned_until?: string | null
}

export async function GET() {
  const sesion = await requireGestorDeUsuarios()
  if (sesion instanceof NextResponse) return sesion
  const { servicio } = sesion

  const [perfiles, permisos] = await Promise.all([
    servicio.from('profiles').select('*').order('created_at', { ascending: false }),
    servicio.from('user_app_permissions').select('id, user_id, app_id, can_access, created_at, updated_at'),
  ])
  if (perfiles.error) return NextResponse.json({ error: 'No se han podido leer los usuarios' }, { status: 500 })
  if (permisos.error) return NextResponse.json({ error: 'No se han podido leer los accesos' }, { status: 500 })

  // El sistema de acceso, en páginas de 1000 (sobra: hay decenas)
  const auth = new Map<string, UsuarioAuth>()
  let sinEstado = false
  for (let pagina = 1; pagina <= 5; pagina++) {
    const { data, error } = await servicio.auth.admin.listUsers({ page: pagina, perPage: 1000 })
    if (error) {
      sinEstado = true
      break
    }
    for (const u of data.users as UsuarioAuth[]) auth.set(u.id, u)
    if (data.users.length < 1000) break
  }

  const porUsuario = new Map<string, Array<Record<string, unknown>>>()
  for (const p of permisos.data ?? []) {
    const lista = porUsuario.get(p.user_id as string) ?? []
    lista.push(p)
    porUsuario.set(p.user_id as string, lista)
  }

  const usuarios = (perfiles.data ?? []).map((p: Record<string, unknown>) => {
    const a = auth.get(p.id as string)
    return {
      id: p.id,
      email: (p.email as string) || '',
      full_name: (p.full_name as string | null) ?? null,
      role: p.role,
      puesto: (p.puesto as string | null) ?? null,
      is_comercial: p.is_comercial === true,
      calendar_color: (p.calendar_color as string | null) ?? null,
      created_at: p.created_at,
      permissions: porUsuario.get(p.id as string) ?? [],
      ultimo_acceso: a?.last_sign_in_at ?? null,
      desactivado: estaDesactivado(a?.banned_until ?? null),
    }
  })

  return NextResponse.json({ usuarios, sinEstado })
}
