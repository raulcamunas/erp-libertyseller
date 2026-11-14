import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { AMAZON_MARKETPLACES } from '@/lib/types/amazon'
import { consultasGuardadas, fichasGuardadas } from '@/lib/seo/datos'
import { keywordsDelAsin, perfilesAdsDe, terminosDeAdsDelAsin } from '@/lib/seo/publicidad'
import { busquedasSinExacta, terminosQueFaltanEnLaFicha } from '@/lib/seo/publicidad-calculo'
import { abrirCuentaSeo, errorDeRutaSeo } from '@/lib/seo/ruta'

/**
 * SEO TEST · LO QUE DICE MARKETING TEST DE UN PRODUCTO. Solo administradores. Solo LEE (de la base del ERP; nada de Amazon Ads se escribe desde aquí).
 *
 *   GET ?cuenta=&asin=   → {hayMarketingTest, campanas, vendePorPublicidad: términos con pedidos que faltan en la ficha, sinExacta: búsquedas que venden sin keyword EXACTA}
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  try {
    const a = await abrirCuentaSeo(request.nextUrl.searchParams.get('cuenta'))
    if (a instanceof NextResponse) return a
    const asin = (request.nextUrl.searchParams.get('asin') ?? '').trim().toUpperCase()
    if (!/^[A-Z0-9]{10}$/.test(asin)) return fail(400, 'Falta el ASIN.')
    const pais = AMAZON_MARKETPLACES.find((m) => m.id === a.marketplaceId)?.countryCode ?? ''
    const perfiles = await perfilesAdsDe(a.clientId, pais)
    if (perfiles.length === 0) return NextResponse.json({ hayMarketingTest: false, campanas: 0, vendePorPublicidad: [], sinExacta: [] })
    const [terminos, keywords, fichas, mes, semana] = await Promise.all([
      terminosDeAdsDelAsin(perfiles, asin),
      keywordsDelAsin(perfiles, asin),
      fichasGuardadas(a.connectionId, a.marketplaceId),
      consultasGuardadas(a.connectionId, a.marketplaceId, 'MONTH'),
      consultasGuardadas(a.connectionId, a.marketplaceId, 'WEEK'),
    ])
    const ficha = fichas.find((f) => f.asin === asin) ?? null
    const delMes = mes.filter((c) => c.asin === asin)
    const consultas = delMes.length > 0 ? delMes : semana.filter((c) => c.asin === asin)
    return NextResponse.json({
      hayMarketingTest: true,
      campanas: keywords.campanas,
      vendePorPublicidad: terminosQueFaltanEnLaFicha(terminos, ficha),
      sinExacta: keywords.campanas > 0 ? busquedasSinExacta(consultas, keywords.exactas, keywords.otras) : [],
    })
  } catch (error) {
    return errorDeRutaSeo(error, 'SEO: cruzar con Marketing Test')
  }
}
