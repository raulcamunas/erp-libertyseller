import { NextResponse, type NextRequest } from 'next/server'
import { fail, errorResponse, requireAmazonAdmin } from '@/lib/amazon/api'
import { EntraisError } from '@/lib/entrais/api'
import { eanValido, erroresDeOferta, limpiarEan, type OfertaParaSubir } from '@/lib/pccomponentes/datos'
import { MiraklError, buscarProductosPorEan, faltaConfigurarPcc, leerErroresDeImportacion, leerImportacion, leerTodasLasOfertas, subirOfertas } from '@/lib/pccomponentes/mirakl'
import { buscarProductos, productosDelProveedor } from '@/lib/pccomponentes/proveedor'

/**
 * ENTRAIS · PCCOMPONENTES: LAS LLAMADAS DE LA PANTALLA. SOLO ADMIN.
 *
 *   GET  ?accion=proveedor&q=…         busca un producto en la API del proveedor (código, EAN, referencia o texto)
 *   GET  ?accion=producto&ean=…        ¿existe ese EAN en el catálogo de PcComponentes? ¿y la tienda ya lo oferta?
 *   GET  ?accion=cobertura&desde=&max= de los productos del proveedor con EAN, cuántos existen en PcComponentes (no escribe nada)
 *   GET  ?accion=importacion&id=…      cómo va una subida de ofertas y, si falló alguna línea, por qué
 *   POST { ofertas, confirmacion }     sube ofertas (solo las de prueba: hasta 5). ÚNICA que escribe en la tienda
 *
 * Solo administradores: aquí se usa la clave de API de la tienda de un cliente y se pueden publicar ofertas con pedidos reales.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

const MAX_OFERTAS_POR_SUBIDA = 5

function problema(error: unknown, contexto: string): NextResponse {
  const codigo = (e: number | undefined) => (e !== undefined && e >= 400 && e < 600 ? e : 502)
  if (error instanceof MiraklError) return fail(codigo(error.estado), error.cuerpo ? `${error.message}: ${error.cuerpo.slice(0, 200)}` : error.message)
  if (error instanceof EntraisError) return fail(codigo(error.estado), error.message)
  return errorResponse(error, contexto)
}

export async function GET(request: NextRequest) {
  try {
    const sesion = await requireAmazonAdmin()
    if (sesion instanceof NextResponse) return sesion
    const falta = faltaConfigurarPcc()
    if (falta) return fail(503, falta)
    const q = request.nextUrl.searchParams
    const accion = q.get('accion')

    if (accion === 'proveedor') {
      const lectura = await productosDelProveedor()
      return NextResponse.json({ resultados: buscarProductos(lectura.productos, q.get('q') ?? ''), deCache: lectura.deCache, edadMin: lectura.edadMin, llamadasQueQuedan: lectura.llamadasQueQuedan })
    }

    if (accion === 'producto') {
      const ean = limpiarEan(q.get('ean'))
      if (!ean) return fail(400, 'Ese EAN no es válido (8, 12, 13 o 14 cifras con su dígito de control)')
      const [catalogo, ofertas] = await Promise.all([buscarProductosPorEan([ean]), leerTodasLasOfertas()])
      return NextResponse.json({ ean, enCatalogo: catalogo.get(ean) ?? null, nuestraOferta: ofertas.ofertas.find((o) => o.ean === ean) ?? null })
    }

    if (accion === 'cobertura') {
      const desde = Math.max(0, Number(q.get('desde') ?? 0) || 0)
      const max = Math.min(1000, Math.max(10, Number(q.get('max') ?? 300) || 300))
      const lectura = await productosDelProveedor()
      // Solo los que se pueden cruzar (EAN válido) y se pueden vender (no digitales, con stock)
      const candidatos = lectura.productos.filter((p) => p.ean && !p.digital && p.stock > 0)
      const trozo = candidatos.slice(desde, desde + max)
      const hallados = await buscarProductosPorEan(trozo.map((p) => p.ean!))
      const existen = trozo.filter((p) => hallados.has(p.ean!))
      return NextResponse.json({
        productosDelProveedor: lectura.productos.length,
        sinEan: lectura.productos.filter((p) => !p.ean).length,
        candidatos: candidatos.length,
        desde,
        mirados: trozo.length,
        existenEnPcc: existen.length,
        siguiente: desde + max < candidatos.length ? desde + max : null,
        ejemplos: existen.slice(0, 40).map((p) => ({ ...p, pcc: hallados.get(p.ean!)! })),
        llamadasQueQuedan: lectura.llamadasQueQuedan,
      })
    }

    if (accion === 'importacion') {
      const id = q.get('id') ?? ''
      const importacion = await leerImportacion(id)
      const errores = importacion.terminada && importacion.lineasConError > 0 ? await leerErroresDeImportacion(id) : ''
      return NextResponse.json({ importacion, errores })
    }

    return fail(400, 'Esa acción no existe')
  } catch (error) {
    return problema(error, 'No se ha podido hablar con PcComponentes')
  }
}

export async function POST(request: NextRequest) {
  try {
    const sesion = await requireAmazonAdmin()
    if (sesion instanceof NextResponse) return sesion
    const falta = faltaConfigurarPcc()
    if (falta) return fail(503, falta)

    const cuerpo = (await request.json().catch(() => null)) as { ofertas?: unknown; confirmacion?: unknown } | null
    if (!cuerpo || !Array.isArray(cuerpo.ofertas) || cuerpo.ofertas.length === 0) return fail(400, 'No hay ninguna oferta que subir')
    if (cuerpo.ofertas.length > MAX_OFERTAS_POR_SUBIDA) return fail(400, `Desde aquí se suben como mucho ${MAX_OFERTAS_POR_SUBIDA} ofertas de prueba de una vez`)

    const ofertas: OfertaParaSubir[] = []
    for (const crudo of cuerpo.ofertas as Array<Record<string, unknown>>) {
      const ean = limpiarEan(crudo.ean) ?? String(crudo.ean ?? '')
      const o: OfertaParaSubir = {
        sku: String(crudo.sku ?? '').trim(),
        ean,
        precio: Number(crudo.precio),
        cantidad: Number(crudo.cantidad),
        plazoEnvioDias: crudo.plazoEnvioDias === undefined ? undefined : Number(crudo.plazoEnvioDias),
        tipoIva: crudo.tipoIva === undefined ? undefined : Number(crudo.tipoIva),
        canon: crudo.canon === undefined ? undefined : Number(crudo.canon),
      }
      const errores = erroresDeOferta(o)
      if (errores.length > 0 || !eanValido(ean)) return fail(400, `${o.sku || 'Oferta'}: ${errores.join('; ')}`)
      ofertas.push(o)
    }

    const { importacionId } = await subirOfertas(ofertas, typeof cuerpo.confirmacion === 'string' ? cuerpo.confirmacion : '')
    return NextResponse.json({ ok: true, importacionId, ofertas: ofertas.length })
  } catch (error) {
    return problema(error, 'No se ha podido subir la oferta')
  }
}
