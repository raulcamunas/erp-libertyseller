import { NextResponse, type NextRequest } from 'next/server'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { fuentesActivas, hayLecturaPendiente, pasoDeLectura } from '@/lib/trafico/sincronizar'

/**
 * EL TRÁFICO DE LOS CLIENTES CON ENLACE (proceso `trafico-cliente`, cada 2 minutos; el reloj está en `cron_config`).
 *
 * Recoge los informes de Ventas y tráfico que Amazon ya ha terminado y pide los días que faltan (lib/trafico/sincronizar.ts). Si no hay enlaces activos ni nada
 * pendiente —lo normal una vez rellenado el histórico, salvo la lectura del día—, contesta sin abrir fila en el registro de procesos. Solo LEE de Amazon.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const PRESUPUESTO_MS = 100_000

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })

  if (request.nextUrl.searchParams.get('forzar') !== '1') {
    const veredicto = await tocaAhora('trafico-cliente')
    if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
  }

  try {
    if (!(await hayLecturaPendiente())) return NextResponse.json({ ok: true, saltado: 'nada que leer' })
  } catch (error) {
    if (isMissingSchema(error)) return NextResponse.json({ ok: true, saltado: 'falta lanzar la migración 322' })
    throw error
  }

  const salida = await conRegistro('trafico-cliente', lanzadoPorDe(request.headers), async () => {
    const hasta = Date.now() + PRESUPUESTO_MS
    let guardados = 0
    let pedidos = 0
    let faltan = 0
    const errores: string[] = []
    for (const f of await fuentesActivas()) {
      if (Date.now() > hasta) break
      try {
        const r = await pasoDeLectura(f, hasta)
        guardados += r.guardados
        pedidos += r.pedidos
        faltan += r.faltan
        errores.push(...r.errores)
      } catch (e) {
        errores.push(e instanceof Error ? e.message.slice(0, 150) : String(e))
      }
    }
    return { guardados, pedidos, faltan, errores: errores.slice(0, 10), resumen: `${guardados} días guardados, ${pedidos} pedidos a Amazon, ${faltan} por leer` + (errores.length > 0 ? ` (${errores.slice(0, 2).join(' · ')})` : '') }
  })
  return NextResponse.json({ ok: true, ...salida })
}
