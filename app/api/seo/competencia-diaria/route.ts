import { NextResponse, type NextRequest } from 'next/server'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { fotografiarCompetencia, hayCompetenciaPendiente } from '@/lib/seo/rivales-servidor'
import { actualizarMarcasDeTodas } from '@/lib/seo/marcas-servidor'

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
/** Las marcas de la competencia (lib/seo/marcas-servidor.ts) se buscan detrás de las fotos; si no hay fotos que hacer, como mucho cada 6 horas */
const CADA_MARCAS_MS = 6 * 3_600_000
let ultimaDeMarcas = 0

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  if (request.nextUrl.searchParams.get('forzar') !== '1') {
    const veredicto = await tocaAhora('seo-competencia')
    if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
  }

  let hayFotos = false
  try {
    hayFotos = await hayCompetenciaPendiente()
  } catch (error) {
    if (!isMissingSchema(error)) throw error
  }
  const tocaMarcas = Date.now() - ultimaDeMarcas > CADA_MARCAS_MS
  if (!hayFotos && !tocaMarcas) return NextResponse.json({ ok: true, saltado: 'nada que fotografiar hoy' })

  const salida = await conRegistro('seo-competencia', lanzadoPorDe(request.headers), async () => {
    const arranque = Date.now()
    const r = hayFotos ? await fotografiarCompetencia(PRESUPUESTO_MS) : { fotos: 0, cambios: 0, cuentas: 0, pendientes: 0, errores: [] as string[] }
    let textoMarcas = ''
    const queda = PRESUPUESTO_MS + 120_000 - (Date.now() - arranque)
    if (queda > 30_000) {
      ultimaDeMarcas = Date.now()
      const m = await actualizarMarcasDeTodas(queda - 20_000).catch((e) => ({ cuentas: 0, nuevas: 0, revisadasIa: 0, pendientesIa: 0, errores: [e instanceof Error ? e.message : String(e)] }))
      textoMarcas = `; marcas: ${m.nuevas} nuevas en ${m.cuentas} cuentas, ${m.revisadasIa} búsquedas repasadas con IA` + (m.pendientesIa > 0 ? ` (quedan ${m.pendientesIa})` : '') + (m.errores.length ? ` [${m.errores.slice(0, 1).join('')}]` : '')
    }
    return {
      ...r,
      resumen: (hayFotos ? `${r.fotos} fotos de ${r.cuentas} cuentas, ${r.cambios} cambios` + (r.pendientes > 0 ? `; quedan ${r.pendientes} para la pasada siguiente` : '') + (r.errores.length > 0 ? ` (${r.errores.slice(0, 2).join(' · ')})` : '') : 'sin fotos pendientes') + textoMarcas,
    }
  })
  return NextResponse.json({ ok: true, ...salida })
}
