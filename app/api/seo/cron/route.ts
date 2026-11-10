import { NextResponse, type NextRequest } from 'next/server'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'
import { avanzarSeo, cuentasSeoConTrabajo } from '@/lib/seo/lectura'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { textoDeError } from '@/lib/sistema/error-texto'

/**
 * SEO TEST · LA LECTURA AUTOMÁTICA (proceso `seo-lecturas`, cada 3 minutos).
 *
 * Por cada cuenta y país con productos seguidos que tenga algo que hacer: las fichas (una vez al día) y el informe de Brand Analytics del último mes y semana cerrados (lib/seo/lectura.ts). Nunca
 * espera a Amazon. Si no hay nada que hacer —lo normal—, contesta sin abrir fila en el registro de procesos. Solo LEE de Amazon.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

const PRESUPUESTO_MS = 90_000

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  if (request.nextUrl.searchParams.get('forzar') !== '1') {
    const veredicto = await tocaAhora('seo-lecturas')
    if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
  }

  let pendientes
  try {
    pendientes = await cuentasSeoConTrabajo()
  } catch (error) {
    if (isMissingSchema(error)) return NextResponse.json({ ok: true, saltado: 'falta lanzar la migración 296' })
    throw error
  }
  if (pendientes.length === 0) return NextResponse.json({ ok: true, saltado: 'nada que hacer' })

  const salida = await conRegistro('seo-lecturas', lanzadoPorDe(request.headers), async () => {
    const arranque = Date.now()
    const cuenta: Record<string, number> = {}
    const errores: string[] = []
    let sinTiempo = 0
    for (const c of pendientes) {
      if (Date.now() - arranque > PRESUPUESTO_MS) {
        sinTiempo += 1
        continue
      }
      try {
        const r = await avanzarSeo(c)
        cuenta[r.accion] = (cuenta[r.accion] ?? 0) + 1
        if (r.accion === 'error' && r.detalle) errores.push(r.detalle.slice(0, 90))
      } catch (e) {
        cuenta.error = (cuenta.error ?? 0) + 1
        errores.push(textoDeError(e, 90))
      }
    }
    return {
      ...cuenta,
      resumen:
        `${pendientes.length} cuentas: ` +
        Object.entries(cuenta).map(([k, v]) => `${v} ${k}`).join(', ') +
        (errores.length > 0 ? ` (${errores.slice(0, 2).join(' · ')})` : '') +
        (sinTiempo > 0 ? `; ${sinTiempo} sin tiempo` : ''),
    }
  })
  return NextResponse.json({ ok: true, ...salida })
}
