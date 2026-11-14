import { NextResponse, type NextRequest } from 'next/server'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { fotografiarCompetencia, hayCompetenciaPendiente } from '@/lib/seo/rivales-servidor'

/**
 * SEO TEST · EL SEGUIMIENTO DIARIO DE LA COMPETENCIA (proceso `seo-competencia`, cada hora; el reloj está en `cron_config`).
 *
 * Fotografía a los ASIN rivales que aún no tienen la foto de hoy (Catalog Items y, con presupuesto, getItemOffersBatch) y apunta los cambios frente a la
 * foto anterior (lib/seo/rivales-servidor.ts). Si no hay nada pendiente —lo normal tras la primera pasada del día—, contesta sin abrir fila en el registro
 * de procesos. Solo LEE de Amazon.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const PRESUPUESTO_MS = 120_000

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  if (request.nextUrl.searchParams.get('forzar') !== '1') {
    const veredicto = await tocaAhora('seo-competencia')
    if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
  }

  try {
    if (!(await hayCompetenciaPendiente())) return NextResponse.json({ ok: true, saltado: 'nada que fotografiar hoy' })
  } catch (error) {
    if (isMissingSchema(error)) return NextResponse.json({ ok: true, saltado: 'falta lanzar la migración 312' })
    throw error
  }

  const salida = await conRegistro('seo-competencia', lanzadoPorDe(request.headers), async () => {
    const r = await fotografiarCompetencia(PRESUPUESTO_MS)
    return {
      ...r,
      resumen: `${r.fotos} fotos de ${r.cuentas} cuentas, ${r.cambios} cambios` + (r.pendientes > 0 ? `; quedan ${r.pendientes} para la pasada siguiente` : '') + (r.errores.length > 0 ? ` (${r.errores.slice(0, 2).join(' · ')})` : ''),
    }
  })
  return NextResponse.json({ ok: true, ...salida })
}
