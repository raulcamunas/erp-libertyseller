import { NextResponse, type NextRequest } from 'next/server'
import { hojaDeReunionPdf } from '@/lib/agenda/preparar-pdf'
import { guionDeArranque } from '@/lib/agenda/preparar'
import { accesoPreparador, fichaYPreparacion } from '@/lib/agenda/preparar-servidor'
import { createServiceClient } from '@/lib/supabase/service'

/** La hoja de la reunión en PDF (una hoja A4 con la marca), con lo GUARDADO: la pantalla guarda antes de pedirla */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'Cita no válida' }, { status: 400 })
  const a = await accesoPreparador()
  if (a instanceof NextResponse) return a
  try {
    const r = await fichaYPreparacion(createServiceClient(), a, params.id)
    if (!r) return NextResponse.json({ error: 'No encuentro esa cita o no es tuya' }, { status: 404 })
    const p = r.preparacion ?? { ...guionDeArranque(r.ficha), notas: '' }
    const preparadoEl = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date())
    const bytes = hojaDeReunionPdf({ ficha: r.ficha, objetivo: p.objetivo, puntos: p.puntos, preguntas: p.preguntas, notas: p.notas, preparadoEl })
    const nombre = `Reunion ${r.ficha.nombre} ${r.ficha.inicio.slice(0, 10)}`.replace(/[^\w\s.-]/g, '').replace(/\s+/g, ' ').trim()
    return new NextResponse(Buffer.from(bytes), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${nombre}.pdf"`, 'Cache-Control': 'no-store' },
    })
  } catch (e) {
    console.error('[agenda/preparar] pdf', e)
    return NextResponse.json({ error: 'No se ha podido hacer el PDF' }, { status: 500 })
  }
}
