import { NextResponse, type NextRequest } from 'next/server'
import { accesoPreparador, fichaYPreparacion, proponerConIa } from '@/lib/agenda/preparar-servidor'
import { createServiceClient } from '@/lib/supabase/service'

/** Un guion propuesto por la IA para esta cita (no se guarda: lo revisa y lo guarda quien prepara). La IA barata del ERP, ~0,002 $ */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'Cita no válida' }, { status: 400 })
  const a = await accesoPreparador()
  if (a instanceof NextResponse) return a
  try {
    const r = await fichaYPreparacion(createServiceClient(), a, params.id)
    if (!r) return NextResponse.json({ error: 'No encuentro esa cita o no es tuya' }, { status: 404 })
    const ia = await proponerConIa(r.ficha)
    if ('error' in ia) return NextResponse.json({ error: ia.error }, { status: 502 })
    return NextResponse.json(ia)
  } catch (e) {
    console.error('[agenda/preparar] ia', e)
    return NextResponse.json({ error: 'No se ha podido preparar con la IA' }, { status: 500 })
  }
}
