import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { abrirCuentaSeo, errorDeRutaSeo } from '@/lib/seo/ruta'
import { actualizarMarcas, anadirMarca, FaltaMigracion338, leerMarcas, marcasPropias, quitarMarca } from '@/lib/seo/marcas-servidor'

/**
 * SEO TEST · LAS MARCAS DE LA COMPETENCIA DE UNA CUENTA Y PAÍS (lib/seo/marcas*.ts, migración 338). Mismos permisos que el resto de SEO Test.
 *
 *   GET  ?cuenta=                                   → { disponible, marcas: MarcaGuardada[], propias: string[] }
 *   POST {cuenta, accion: 'anadir', texto}          → una marca a mano
 *   POST {cuenta, accion: 'quitar', clave}          → «no es una marca de la competencia» (no vuelve sola)
 *   POST {cuenta, accion: 'actualizar'}             → buscarlas ahora (competidores, productos que se llevan los clics e IA; hasta ~50 s)
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(request: NextRequest) {
  try {
    const a = await abrirCuentaSeo(request.nextUrl.searchParams.get('cuenta'))
    if (a instanceof NextResponse) return a
    const [marcas, propias] = await Promise.all([leerMarcas(a), marcasPropias(a)])
    return NextResponse.json({ disponible: marcas !== null, marcas: marcas ?? [], propias })
  } catch (error) {
    return errorDeRutaSeo(error, 'SEO: leer las marcas de la competencia')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const a = await abrirCuentaSeo(body.cuenta)
    if (a instanceof NextResponse) return a
    if (body.accion === 'anadir') {
      if (typeof body.texto !== 'string' || !body.texto.trim()) return fail(400, 'Falta la marca.')
      await anadirMarca(a, body.texto, a.sesion.userId)
      return NextResponse.json({ ok: true })
    }
    if (body.accion === 'quitar') {
      if (typeof body.clave !== 'string' || !body.clave.trim()) return fail(400, 'Falta la marca.')
      await quitarMarca(a, body.clave)
      return NextResponse.json({ ok: true })
    }
    if (body.accion === 'actualizar') {
      const r = await actualizarMarcas(a, { presupuestoMs: 50_000 })
      return NextResponse.json({ ok: true, ...r })
    }
    return fail(400, 'Acción desconocida.')
  } catch (error) {
    if (error instanceof FaltaMigracion338) return fail(409, error.message)
    if (error instanceof Error && error.message.startsWith('Eso no parece una marca')) return fail(400, error.message)
    return errorDeRutaSeo(error, 'SEO: marcas de la competencia')
  }
}
