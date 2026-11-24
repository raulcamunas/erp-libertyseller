import { NextResponse } from 'next/server'
import { accesoPreparador, citasParaPreparar } from '@/lib/agenda/preparar-servidor'
import { createServiceClient } from '@/lib/supabase/service'

/** Las citas de los próximos 14 días que este usuario puede preparar (lib/agenda/preparar-servidor.ts) */
export const dynamic = 'force-dynamic'

export async function GET() {
  const a = await accesoPreparador()
  if (a instanceof NextResponse) return a
  try {
    const citas = await citasParaPreparar(createServiceClient(), a)
    return NextResponse.json({ citas, verTodas: a.verTodas }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[agenda/preparar] lista', e)
    return NextResponse.json({ error: 'No se han podido leer las citas' }, { status: 500 })
  }
}
