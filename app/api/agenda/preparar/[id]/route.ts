import { NextResponse, type NextRequest } from 'next/server'
import { limpiarPreparacion } from '@/lib/agenda/preparar'
import { accesoPreparador, fichaYPreparacion, guardarPreparacion } from '@/lib/agenda/preparar-servidor'
import { createServiceClient } from '@/lib/supabase/service'

/** La ficha de una cita y lo preparado (GET), y guardar lo preparado (PUT). Solo citas propias, salvo quien ve al equipo */
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f-]{36}$/i

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Cita no válida' }, { status: 400 })
  const a = await accesoPreparador()
  if (a instanceof NextResponse) return a
  try {
    const r = await fichaYPreparacion(createServiceClient(), a, params.id)
    if (!r) return NextResponse.json({ error: 'No encuentro esa cita o no es tuya' }, { status: 404 })
    return NextResponse.json(r, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[agenda/preparar] ficha', e)
    return NextResponse.json({ error: 'No se ha podido leer la ficha' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'Cita no válida' }, { status: 400 })
  const a = await accesoPreparador()
  if (a instanceof NextResponse) return a
  const datos = limpiarPreparacion(await req.json().catch(() => null))
  if (!datos) return NextResponse.json({ error: 'Datos no válidos' }, { status: 400 })
  try {
    const r = await guardarPreparacion(createServiceClient(), a, params.id, datos)
    if (r === 'no_existe') return NextResponse.json({ error: 'No encuentro esa cita o no es tuya' }, { status: 404 })
    if (r === 'sin_tabla') return NextResponse.json({ error: 'Falta lanzar la migración 336 para poder guardar' }, { status: 409 })
    return NextResponse.json({ ok: true, guardadoAt: new Date().toISOString() })
  } catch (e) {
    console.error('[agenda/preparar] guardar', e)
    return NextResponse.json({ error: 'No se ha podido guardar' }, { status: 500 })
  }
}
