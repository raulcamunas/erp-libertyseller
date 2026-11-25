import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { requireSession } from '@/lib/auth/api'
import { imagenesDe } from '@/lib/productos/imagenes-servidor'

/**
 * LA IMAGEN PRINCIPAL DE UNOS PRODUCTOS (lib/productos/imagenes-servidor.ts). Cualquier persona con sesión: son imágenes públicas del catálogo de Amazon. Solo LEE de Amazon.
 *
 *   GET ?mkt=<marketplaceId>&asins=B0…,B0…[&conexion=<id>]   → { imagenes: { [asin]: url | null } }
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const s = await requireSession()
  if (s instanceof NextResponse) return s
  const p = request.nextUrl.searchParams
  const mkt = (p.get('mkt') ?? '').trim()
  if (!/^[A-Z0-9]{8,20}$/.test(mkt)) return fail(400, 'Falta el país (marketplaceId).')
  const asins = (p.get('asins') ?? '').split(',').filter(Boolean)
  if (asins.length === 0) return NextResponse.json({ imagenes: {} })
  try {
    const imagenes = await imagenesDe(mkt, asins, { connectionId: p.get('conexion') })
    return NextResponse.json({ imagenes }, { headers: { 'Cache-Control': 'private, max-age=3600' } })
  } catch (e) {
    console.error('Imágenes de producto:', e)
    return fail(500, 'No se han podido leer las imágenes.')
  }
}
