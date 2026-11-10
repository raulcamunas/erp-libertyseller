import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail } from '@/lib/amazon/api'
import { productoDeCuenta } from '@/lib/ads/cuenta'
import { crear, previsualizar } from '@/lib/ads/crear-estructura'
import { abrirCuenta, errorDeRuta } from '@/lib/ads/ruta'

/**
 * CREAR LA ESTRUCTURA DE 4 CAMPAÑAS DE UN PRODUCTO. Solo administradores. ESCRIBE en la cuenta del cliente.
 *
 *   POST {perfilId, productoId, presupuestoDiario, pujaBase, accion: 'previsualizar' | 'crear'}
 *
 * «previsualizar» solo lee (las campañas que ya hay) y devuelve el plan; «crear» lo ejecuta y deja las campañas PAUSADAS. Pausadas y sin keywords: no gastan nada hasta que alguien las active.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const a = await abrirCuenta(body.perfilId)
    if (a instanceof NextResponse) return a
    if (typeof body.productoId !== 'string' || !UUID.test(body.productoId)) return fail(400, 'Falta el producto.')
    const producto = await productoDeCuenta(a.cuenta.id, body.productoId)
    if (!producto) return fail(404, 'Ese producto no está en esta cuenta.')
    if (!producto.activo) return fail(400, 'Ese producto está marcado como inactivo.')

    const presupuestoDiario = Number(body.presupuestoDiario)
    const pujaBase = Number(body.pujaBase)
    if (!Number.isFinite(presupuestoDiario) || !Number.isFinite(pujaBase)) return fail(400, 'Faltan el presupuesto diario o la puja base.')
    const opciones = { presupuestoDiario, pujaBase }

    if (body.accion === 'previsualizar') {
      const r = await previsualizar(a.cuenta, producto, opciones)
      return r.ok ? NextResponse.json(r.vista) : fail(400, r.error)
    }
    if (body.accion === 'crear') {
      const r = await crear(a.cuenta, producto, opciones, a.sesion.userId)
      return r.ok ? NextResponse.json({ resultados: r.resultados }) : fail(400, r.error)
    }
    return fail(400, 'Acción desconocida.')
  } catch (error) {
    return errorDeRuta(error, 'Ads: crear la estructura de campañas')
  }
}
