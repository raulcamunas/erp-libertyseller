import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail } from '@/lib/amazon/api'
import { productoDeCuenta } from '@/lib/ads/cuenta'
import { abrirCuenta, errorDeRuta } from '@/lib/ads/ruta'
import { aplicarSemillas, proponerSemillas } from '@/lib/ads/semillas-servidor'
import type { DestinoDeSemilla, Semilla } from '@/lib/ads/semillas'
import type { FilaCerebro, FilaGrabber } from '@/lib/ads/helium10'

/**
 * LAS PALABRAS, ASIN Y NEGATIVAS CON LAS QUE ARRANCAN LAS CAMPAÑAS DE UN PRODUCTO (lib/ads/semillas*.ts). Quien lleva cuentas (lib/cuentas/acceso.ts).
 *
 *   POST {perfilId, productoId, accion: 'proponer', pujaBase, marca?, cerebro?, grabber?} → solo LEE: la propuesta con su motivo, y qué fuentes se han podido mirar
 *   POST {perfilId, productoId, accion: 'aplicar', semillas}                               → ESCRIBE en la cuenta: keywords, ASIN y negativas en las campañas del producto
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const DESTINOS: readonly DestinoDeSemilla[] = ['frase', 'exacta', 'asin', 'negativa', 'negativa-asin']

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const a = await abrirCuenta(body.perfilId)
    if (a instanceof NextResponse) return a
    if (typeof body.productoId !== 'string' || !UUID.test(body.productoId)) return fail(400, 'Falta el producto.')
    const producto = await productoDeCuenta(a.cuenta.id, body.productoId)
    if (!producto) return fail(404, 'Ese producto no está en esta cuenta.')

    if (body.accion === 'proponer') {
      const pujaBase = Number(body.pujaBase)
      if (!(pujaBase >= 0.02)) return fail(400, 'Falta la puja base.')
      const cerebro = Array.isArray(body.cerebro) ? (body.cerebro as FilaCerebro[]).filter((f) => typeof f?.keyword === 'string').slice(0, 3000) : undefined
      const grabber = Array.isArray(body.grabber) ? (body.grabber as FilaGrabber[]).filter((f) => typeof f?.asin === 'string').slice(0, 500) : undefined
      const r = await proponerSemillas(a.cuenta, producto, { pujaBase, cerebro, grabber, marca: typeof body.marca === 'string' ? body.marca : null })
      return NextResponse.json(r)
    }
    if (body.accion === 'aplicar') {
      if (!Array.isArray(body.semillas) || body.semillas.length === 0) return fail(400, 'No hay nada marcado para aplicar.')
      const semillas: Semilla[] = (body.semillas as Semilla[])
        .filter((s) => s && typeof s.texto === 'string' && s.texto.trim() && s.texto.length <= 80 && DESTINOS.includes(s.destino))
        .map((s) => ({ ...s, texto: s.texto.trim().toLowerCase(), puja: s.puja == null ? null : Math.min(20, Math.max(0.02, Number(s.puja) || 0.02)) }))
      if (semillas.some((s) => (s.destino === 'asin' || s.destino === 'negativa-asin') && !/^b0[a-z0-9]{8}$/.test(s.texto))) return fail(400, 'Hay un ASIN que no tiene la forma B0XXXXXXXX.')
      const r = await aplicarSemillas(a.cuenta, producto, semillas, a.sesion.userId)
      return NextResponse.json(r)
    }
    return fail(400, 'Acción desconocida.')
  } catch (error) {
    return errorDeRuta(error, 'Ads: palabras de arranque')
  }
}
