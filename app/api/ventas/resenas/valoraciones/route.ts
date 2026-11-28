import { NextResponse } from 'next/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { clientesGrowth } from '@/lib/growth/clientes'
import { valoracionesDeClientes } from '@/lib/resenas/valoraciones'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Las valoraciones de los productos de todos los clientes (lib/resenas/valoraciones.ts). Solo administradores, como la pantalla de Reseñas */
export async function GET() {
  const perfil = await getUserProfile()
  if (!perfil || perfil.role !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  try {
    const [filas, clientes] = await Promise.all([valoracionesDeClientes(), clientesGrowth()])
    const nombre = new Map(clientes.filter((c) => c.amazonClientId).map((c) => [c.amazonClientId as string, c.nombre]))
    return NextResponse.json({ productos: filas.map((f) => ({ ...f, cliente: nombre.get(f.amazonClientId) ?? '—' })) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'No se han podido leer las valoraciones' }, { status: 500 })
  }
}
