import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { abrirCuenta, errorDeRuta } from '@/lib/ads/ruta'
import { cambiarEstado, cambiarPresupuesto, cambiarPuja, detalleDeCampana, type TipoDeObjetivo } from '@/lib/ads/segmentaciones'

/**
 * LAS SEGMENTACIONES DE UNA CAMPAÑA (Marketing Test, al abrir una campaña). Solo administradores.
 *
 *   GET  ?perfilId=&campaignId=&dias=7|14|30   → grupos de anuncios, keywords y segmentaciones en vivo, con sus métricas del periodo
 *   POST { perfilId, campaignId, nombreCampana, accion: 'puja' | 'estado' | 'presupuesto', … }   → ESCRIBE en la cuenta del cliente y lo apunta en el log
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ID = /^\d{1,30}$/
const TIPOS: readonly string[] = ['keyword', 'producto', 'auto', 'grupo']

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams
    const a = await abrirCuenta(q.get('perfilId'))
    if (a instanceof NextResponse) return a
    const campaignId = q.get('campaignId') ?? ''
    if (!ID.test(campaignId)) return fail(400, 'Falta la campaña.')
    const dias = [7, 14, 30].includes(Number(q.get('dias'))) ? Number(q.get('dias')) : 14
    return NextResponse.json(await detalleDeCampana(a.cuenta, campaignId, dias))
  } catch (error) {
    return errorDeRuta(error, 'Ads: leer las segmentaciones de una campaña')
  }
}

export async function POST(request: NextRequest) {
  try {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const a = await abrirCuenta(b.perfilId)
    if (a instanceof NextResponse) return a
    const campaignId = String(b.campaignId ?? '')
    if (!ID.test(campaignId)) return fail(400, 'Falta la campaña.')
    const ctx = { cuenta: a.cuenta, campaignId, nombreCampana: typeof b.nombreCampana === 'string' ? b.nombreCampana.slice(0, 300) : null, userId: a.sesion.userId }
    const id = String(b.id ?? '')
    const tipo = String(b.tipo ?? '')
    const texto = typeof b.texto === 'string' ? b.texto : ''

    if (b.accion === 'puja') {
      if (!ID.test(id) || !TIPOS.includes(tipo)) return fail(400, 'Segmentación no válida.')
      const puja = await cambiarPuja(ctx, { tipo: tipo as TipoDeObjetivo | 'grupo', id, texto, pujaAnterior: typeof b.pujaAnterior === 'number' ? b.pujaAnterior : null, pujaNueva: b.puja })
      return NextResponse.json({ ok: true, puja })
    }
    if (b.accion === 'estado') {
      if (!ID.test(id) || !['keyword', 'producto', 'auto'].includes(tipo)) return fail(400, 'Segmentación no válida.')
      await cambiarEstado(ctx, { tipo: tipo as TipoDeObjetivo, id, texto, activar: b.activar === true })
      return NextResponse.json({ ok: true })
    }
    if (b.accion === 'presupuesto') {
      const presupuesto = await cambiarPresupuesto(ctx, { anterior: typeof b.anterior === 'number' ? b.anterior : null, nuevo: b.presupuesto })
      return NextResponse.json({ ok: true, presupuesto })
    }
    return fail(400, 'Acción desconocida.')
  } catch (error) {
    return errorDeRuta(error, 'Ads: cambiar una segmentación')
  }
}
