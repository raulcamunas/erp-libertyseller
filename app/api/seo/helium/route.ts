import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { borrarImportacion, guardarImportacion, heliumDe, type FilaRecibida, type TipoImportacion } from '@/lib/seo/helium-servidor'
import { abrirCuentaSeo, errorDeRutaSeo } from '@/lib/seo/ruta'

/**
 * SEO TEST · HELIUM 10 DE UN PRODUCTO. No toca Amazon.
 *
 *   GET  ?cuenta=&asin=                                              → las importaciones y las palabras cruzadas con Brand Analytics y la ficha
 *   POST {cuenta, asin, accion: 'importar', tipo, fichero, filas[], asinsRivales[]}  → guarda un CSV ya leído en el navegador
 *   POST {cuenta, accion: 'borrar', id}
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const SIN_MIGRACION = 'Falta lanzar la migración 312 en Supabase: sin ella no hay dónde guardar los CSV de Helium 10.'
const TIPOS: TipoImportacion[] = ['cerebro', 'magnet', 'keyword_tracker']
const asinDe = (v: unknown) => (typeof v === 'string' && /^[A-Z0-9]{10}$/.test(v.trim().toUpperCase()) ? v.trim().toUpperCase() : null)

export async function GET(request: NextRequest) {
  try {
    const a = await abrirCuentaSeo(request.nextUrl.searchParams.get('cuenta'))
    if (a instanceof NextResponse) return a
    const asin = asinDe(request.nextUrl.searchParams.get('asin'))
    if (!asin) return fail(400, 'Falta el ASIN.')
    return NextResponse.json(await heliumDe(a, asin))
  } catch (error) {
    return errorDeRutaSeo(error, 'SEO: leer Helium 10')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const a = await abrirCuentaSeo(body.cuenta)
    if (a instanceof NextResponse) return a
    if (body.accion === 'borrar') {
      const id = typeof body.id === 'string' && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null
      if (!id) return fail(400, 'Falta la importación.')
      await borrarImportacion(a, id)
      return NextResponse.json({ ok: true })
    }
    if (body.accion !== 'importar') return fail(400, 'Acción desconocida.')
    const asin = asinDe(body.asin)
    const tipo = TIPOS.find((t) => t === body.tipo)
    if (!asin || !tipo) return fail(400, 'Faltan el producto o el tipo de fichero.')
    const filas = (Array.isArray(body.filas) ? body.filas : []).filter((f): f is FilaRecibida => !!f && typeof f === 'object' && typeof (f as FilaRecibida).keyword === 'string')
    if (filas.length === 0) return fail(400, 'El fichero no trae ninguna palabra.')
    const asinsRivales = (Array.isArray(body.asinsRivales) ? body.asinsRivales : []).filter((x): x is string => typeof x === 'string').map((x) => x.toUpperCase())
    const r = await guardarImportacion(a, { asin, tipo, fichero: typeof body.fichero === 'string' ? body.fichero : null, filas, asinsRivales, userId: a.sesion.userId })
    return NextResponse.json({ ok: true, ...r })
  } catch (error) {
    if (isMissingSchema(error)) return fail(409, SIN_MIGRACION)
    return errorDeRutaSeo(error, 'SEO: importar Helium 10')
  }
}
