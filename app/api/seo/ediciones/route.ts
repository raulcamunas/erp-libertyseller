import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { createServiceClient } from '@/lib/supabase/service'
import { aplicarEdicion, edicionesDe, validarEdicion } from '@/lib/seo/edicion-servidor'
import { MAX_VINETAS, type TextosFicha } from '@/lib/seo/edicion'
import { abrirCuentaSeo, errorDeRutaSeo } from '@/lib/seo/ruta'

/**
 * SEO TEST · EL EDITOR DE FICHA. Administradores y quien tenga la casilla de SEO Test (decisión de Raúl, 14 nov 2026).
 *
 *   GET  ?cuenta=&asin=                                   → el historial de ediciones del producto (quién, cuándo, antes/después, qué dijo Amazon y si quedó)
 *   POST {cuenta, accion: 'validar', asin, despues}       → VALIDA en Amazon (VALIDATION_PREVIEW). No cambia la ficha. Apunta la edición validada o rechazada
 *   POST {cuenta, accion: 'aplicar', id, saltarVentana?}  → ESCRIBE EN LA FICHA DEL CLIENTE. Solo una edición validada; la pantalla pide confirmación antes
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const asinDe = (v: unknown) => (typeof v === 'string' && /^[A-Z0-9]{10}$/.test(v.trim().toUpperCase()) ? v.trim().toUpperCase() : null)

const texto = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

/** Lo que llega del navegador, recortado a algo razonable (los límites de verdad los comprueba lib/seo/edicion.ts) */
function textosDe(v: unknown): TextosFicha | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  return {
    titulo: texto(o.titulo, 600),
    highlights: typeof o.highlights === 'string' ? texto(o.highlights, 600) : null,
    bullets: (Array.isArray(o.bullets) ? o.bullets : []).slice(0, MAX_VINETAS + 1).map((b) => texto(b, 1500)),
    descripcion: typeof o.descripcion === 'string' ? texto(o.descripcion, 4000) : null,
    backend: texto(o.backend, 1000),
  }
}

export async function GET(request: NextRequest) {
  try {
    const a = await abrirCuentaSeo(request.nextUrl.searchParams.get('cuenta'))
    if (a instanceof NextResponse) return a
    const asin = asinDe(request.nextUrl.searchParams.get('asin'))
    if (!asin) return fail(400, 'Falta el ASIN.')
    return NextResponse.json(await edicionesDe(a, asin))
  } catch (error) {
    return errorDeRutaSeo(error, 'SEO: leer las ediciones')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const a = await abrirCuentaSeo(body.cuenta)
    if (a instanceof NextResponse) return a
    const c = { connectionId: a.connectionId, marketplaceId: a.marketplaceId }

    if (body.accion === 'validar') {
      const asin = asinDe(body.asin)
      const despues = textosDe(body.despues)
      if (!asin || !despues) return fail(400, 'Faltan el producto o los textos.')
      // El SKU, del producto seguido (no se fía del navegador)
      const { data } = await createServiceClient().from('seo_productos').select('sku').eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).eq('asin', asin).maybeSingle()
      const sku = (data as { sku: string | null } | null)?.sku
      if (!sku) return fail(400, 'Este producto no tiene SKU apuntado: sin él no se puede cambiar la ficha.')
      const r = await validarEdicion(c, { asin, sku, despues, origen: 'manual', userId: a.sesion.userId })
      if (!r.ok) return NextResponse.json({ error: r.motivo, issues: r.issues, edicion: r.edicion ?? null }, { status: 409 })
      return NextResponse.json(r)
    }

    if (body.accion === 'aplicar') {
      const id = typeof body.id === 'string' && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null
      if (!id) return fail(400, 'Falta la edición.')
      const r = await aplicarEdicion(c, id, a.sesion.userId, { saltarVentana: body.saltarVentana === true })
      if (!r.ok) return NextResponse.json({ error: r.motivo, issues: r.issues }, { status: 409 })
      return NextResponse.json(r)
    }
    return fail(400, 'Acción desconocida.')
  } catch (error) {
    return errorDeRutaSeo(error, 'SEO: editar la ficha')
  }
}
