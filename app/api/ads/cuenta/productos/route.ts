import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail } from '@/lib/amazon/api'
import { actualizarProducto, crearProducto, estructurasDeCuenta, productosDeCuenta, quitarProducto } from '@/lib/ads/cuenta'
import { productoDesdeCuerpo } from '@/lib/ads/validar'
import { abrirCuenta, errorDeRuta } from '@/lib/ads/ruta'
import { guardarCostesPegados, leerCostesPegados } from '@/lib/ads/costes-pegados'
import { anadirDetectados, productosConCampanas } from '@/lib/ads/productos-detectados'

/**
 * LOS PRODUCTOS A LOS QUE SE LES HACE MARKETING, con su coste. Solo administradores.
 *
 *   GET    ?perfilId=                → productos y las campañas que el ERP les ha creado
 *   POST   {perfilId, …producto}     → añade uno (el ASIN no se repite en una cuenta)
 *   POST   {perfilId, accion: 'anadir-detectados', asins?} → da de alta los productos que ya tienen campañas en la cuenta (todos, o esos ASIN)
 *   POST   {perfilId, accion: 'pegar-costes', texto} → pone el coste a los productos por SKU (dos columnas pegadas de una hoja de cálculo)
 *   PUT    {perfilId, id, …producto} → lo edita
 *   DELETE {perfilId, id}            → lo quita (no si ya tiene campañas creadas desde el ERP)
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const a = await abrirCuenta(request.nextUrl.searchParams.get('perfilId'))
    if (a instanceof NextResponse) return a
    const [productos, estructuras] = await Promise.all([productosDeCuenta(a.cuenta.id), estructurasDeCuenta(a.cuenta.id)])
    // Las campañas que ya hay en la cuenta, por ASIN (en vivo). Si Amazon falla, la lista de productos se ve igual
    const campanas = await productosConCampanas(a.cuenta, productos).catch((e) => {
      console.error('Ads: no se han podido leer las campañas por producto:', e instanceof Error ? e.message : e)
      return null
    })
    return NextResponse.json({ productos, estructuras, campanasPorAsin: campanas?.porAsin ?? null, detectados: campanas?.detectados ?? [] })
  } catch (error) {
    return errorDeRuta(error, 'Ads: leer los productos')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const a = await abrirCuenta(body.perfilId)
    if (a instanceof NextResponse) return a
    if (body.accion === 'anadir-detectados') {
      const asins = Array.isArray(body.asins) ? body.asins.filter((x): x is string => typeof x === 'string' && /^[A-Z0-9]{10}$/.test(x)) : null
      return NextResponse.json({ ok: true, ...(await anadirDetectados(a.cuenta, asins, a.sesion.userId)) })
    }
    if (body.accion === 'pegar-costes') {
      const leido = leerCostesPegados(typeof body.texto === 'string' ? body.texto.slice(0, 200_000) : '')
      if (leido.costes.length === 0) return fail(400, 'No se ha entendido ninguna línea: pega dos columnas, SKU y coste.')
      const r = await guardarCostesPegados(a.cuenta, leido.costes, a.sesion.userId)
      return NextResponse.json({ ok: true, ...r, leidos: leido.costes.length, descartadas: leido.descartadas })
    }
    const campos = productoDesdeCuerpo(body)
    if (!campos.ok) return fail(400, campos.error)
    return NextResponse.json({ producto: await crearProducto(a.cuenta.id, campos.campos, a.sesion.userId) })
  } catch (error) {
    return errorDeRuta(error, 'Ads: añadir un producto')
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const a = await abrirCuenta(body.perfilId)
    if (a instanceof NextResponse) return a
    if (typeof body.id !== 'string' || !UUID.test(body.id)) return fail(400, 'Falta el producto.')
    const campos = productoDesdeCuerpo(body)
    if (!campos.ok) return fail(400, campos.error)
    return NextResponse.json({ producto: await actualizarProducto(a.cuenta.id, body.id, campos.campos) })
  } catch (error) {
    return errorDeRuta(error, 'Ads: editar un producto')
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const a = await abrirCuenta(body.perfilId)
    if (a instanceof NextResponse) return a
    if (typeof body.id !== 'string' || !UUID.test(body.id)) return fail(400, 'Falta el producto.')
    const r = await quitarProducto(a.cuenta.id, body.id)
    return r.ok ? NextResponse.json({ ok: true }) : fail(409, r.motivo)
  } catch (error) {
    return errorDeRuta(error, 'Ads: quitar un producto')
  }
}
