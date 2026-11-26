import { NextResponse, type NextRequest } from 'next/server'
import { comentariosDeLaCuenta } from '@/lib/seo/comentarios-servidor'
import { edicionesDeLaCuenta } from '@/lib/seo/edicion-servidor'
import { registroDeLaCuenta } from '@/lib/seo/registro-servidor'
import { abrirCuentaSeo, errorDeRutaSeo } from '@/lib/seo/ruta'

/**
 * SEO TEST · LA PESTAÑA «CAMBIOS». Mismos permisos que el resto de SEO Test (lib/seo/ruta.ts). Solo LEE (los comentarios se escriben en ./comentarios).
 *
 *   GET ?cuenta=  → { ediciones: las de toda la cuenta y país (la pantalla calcula el resultado de las aplicadas con el historial), registro: quién hizo qué (lib/seo/registro-servidor.ts), comentarios (migración 342), yo, sinMigracion }
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  try {
    const a = await abrirCuentaSeo(request.nextUrl.searchParams.get('cuenta'))
    if (a instanceof NextResponse) return a
    const c = { connectionId: a.connectionId, marketplaceId: a.marketplaceId }
    const { ediciones, sinMigracion } = await edicionesDeLaCuenta(c)
    const [registro, com] = await Promise.all([registroDeLaCuenta(c, ediciones), comentariosDeLaCuenta(c)])
    return NextResponse.json({ ediciones, registro, sinMigracion, comentarios: com.comentarios, sinComentarios: com.sinTabla, yo: a.sesion.userId })
  } catch (error) {
    return errorDeRutaSeo(error, 'SEO: leer los cambios de la cuenta')
  }
}
