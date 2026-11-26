import { NextResponse, type NextRequest } from 'next/server'
import { fail, UUID } from '@/lib/amazon/api'
import { borrarComentario, comentar, hiloValido, MAX_TEXTO } from '@/lib/seo/comentarios-servidor'
import { abrirCuentaSeo, errorDeRutaSeo } from '@/lib/seo/ruta'
import { isMissingSchema } from '@/lib/plataforma/eventos'

/**
 * SEO TEST · COMENTARIOS DE LA PESTAÑA «CAMBIOS» (migración 342). Mismos permisos que el resto de SEO Test.
 *
 *   POST   { cuenta, hilo, asin?, texto } → { comentario }   (el autor es quien tiene la sesión)
 *   DELETE { cuenta, id }                 → { ok }            (solo los propios)
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SIN_TABLA = 'Falta lanzar la migración 342 en Supabase (comentarios de SEO).'

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { cuenta?: unknown; hilo?: unknown; asin?: unknown; texto?: unknown } | null
    const a = await abrirCuentaSeo(body?.cuenta)
    if (a instanceof NextResponse) return a
    if (!hiloValido(body?.hilo)) return fail(400, 'No se sabe a qué cambio va el comentario.')
    const texto = typeof body?.texto === 'string' ? body.texto.trim() : ''
    if (!texto) return fail(400, 'El comentario está vacío.')
    if (texto.length > MAX_TEXTO) return fail(400, `Máximo ${MAX_TEXTO} caracteres.`)
    const asin = typeof body?.asin === 'string' && /^[A-Z0-9]{10}$/.test(body.asin) ? body.asin : null
    const comentario = await comentar({ connectionId: a.connectionId, marketplaceId: a.marketplaceId }, a.sesion.userId, body.hilo as string, asin, texto)
    return NextResponse.json({ comentario })
  } catch (error) {
    if (isMissingSchema(error)) return fail(409, SIN_TABLA)
    return errorDeRutaSeo(error, 'SEO: comentar un cambio')
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { cuenta?: unknown; id?: unknown } | null
    const a = await abrirCuentaSeo(body?.cuenta)
    if (a instanceof NextResponse) return a
    if (typeof body?.id !== 'string' || !UUID.test(body.id)) return fail(400, 'Falta el comentario.')
    const ok = await borrarComentario({ connectionId: a.connectionId, marketplaceId: a.marketplaceId }, a.sesion.userId, body.id)
    if (!ok) return fail(404, 'Ese comentario no existe o no es tuyo.')
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (isMissingSchema(error)) return fail(409, SIN_TABLA)
    return errorDeRutaSeo(error, 'SEO: borrar un comentario')
  }
}
