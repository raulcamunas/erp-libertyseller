import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { guardarApariencia, leerApariencias } from '@/lib/tareas-clientes/apariencia-servidor'
import { cuerpoDe, respuestaDeError } from '@/lib/tareas-clientes/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** El icono y el color de cada persona se eligen desde la barra del ERP: vale cualquiera con sesión, tenga o no Tareas de clientes */
async function conSesion(fn: (userId: string) => Promise<unknown>): Promise<NextResponse> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No has iniciado sesión.' }, { status: 401 })
  try {
    return NextResponse.json(await fn(user.id))
  } catch (e) {
    return respuestaDeError(e)
  }
}

/** El icono y el color que ha elegido cada persona: `{ mapa, disponible, nombres }` */
export async function GET() {
  return conSesion(async () => leerApariencias())
}

/** Elige el tuyo: `{ color: 'azul' | null, icono: 'cohete' | null }`. Lo que ya tiene otra persona se rechaza (409) */
export async function PUT(request: NextRequest) {
  const c = await cuerpoDe(request)
  return conSesion(async (userId) => ({ mapa: await guardarApariencia(userId, { color: c.color, icono: c.icono }) }))
}
