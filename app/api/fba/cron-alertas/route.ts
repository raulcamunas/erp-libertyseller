import { NextResponse, type NextRequest } from 'next/server'
import { avisarResumenSemanal, esLunes, pasadaDeCliente, type ResumenDePasada } from '@/lib/fba/alertas-datos'
import { diaEnEspana } from '@/lib/fba/fechas'
import { faltaLaTabla } from '@/lib/fba/planificacion'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LA PASADA DIARIA DE ALERTAS DE LOGÍSTICA FBA.
 *
 * Para cada cliente con una conexión de Amazon activa: calcula sus alertas (rotura de stock, envíos atascados o incompletos, descuadres,
 * stock parado y antiguo, ventas), las compara con las que ya había, abre las nuevas, cierra las que ya no pasan y avisa por la campana de
 * las graves (lib/fba/alertas-datos.ts → pasadaDeCliente). Los lunes, además, manda a cada persona de la agencia su resumen semanal.
 *
 * Solo LEE de la base del ERP —que ya se alimenta del libro mayor y del catálogo de Amazon—: no llama a Amazon y no escribe en él. Es
 * pesada (lee el libro mayor de cada cliente), por eso va tras la pasada de remesas y de una en una; el reloj lo decide `tocaAhora()`.
 *
 * EMPIEZA POR EL CLIENTE QUE LLEVA MÁS TIEMPO SIN MIRARSE. Si el presupuesto de tiempo se acaba antes de llegar a todos, los que quedan
 * van los primeros en la pasada siguiente: ninguno se queda atrás para siempre.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const PRESUPUESTO_MS = 230_000

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  if (request.nextUrl.searchParams.get('forzar') !== '1') {
    const veredicto = await tocaAhora('fba-alertas')
    if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
  }

  const salida = await conRegistro('fba-alertas', lanzadoPorDe(request.headers), async () => {
    const arranque = Date.now()
    const service = createServiceClient()
    const hoy = diaEnEspana()

    const { data: conexiones, error } = await service.from('amazon_connections').select('client_id').eq('is_active', true).not('client_id', 'is', null)
    if (error) throw error
    const ids = [...new Set(((conexiones ?? []) as Array<{ client_id: string }>).map((c) => c.client_id))]
    if (ids.length === 0) return { resumen: 'ningún cliente con conexión activa', clientes: 0, pasadas: [] as ResumenDePasada[] }

    const { data: nombres } = await service.from('amazon_clients').select('id, name').in('id', ids)
    const nombreDe = new Map(((nombres ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]))

    // El que lleva más tiempo sin mirarse, primero
    const calculados = new Map<string, string>()
    const { data: estados, error: errorEstados } = await service.from('fba_alertas_estado').select('client_id, calculado_at')
    if (errorEstados && faltaLaTabla(errorEstados)) {
      return { resumen: 'falta lanzar la migración 267_alertas_fba.sql', clientes: ids.length, pasadas: [] as ResumenDePasada[] }
    }
    for (const e of (estados ?? []) as Array<{ client_id: string; calculado_at: string | null }>) if (e.calculado_at) calculados.set(e.client_id, e.calculado_at)
    const orden = [...ids].sort((a, b) => (calculados.get(a) ?? '').localeCompare(calculados.get(b) ?? ''))

    const pasadas: ResumenDePasada[] = []
    let sinTiempo = 0
    for (const id of orden) {
      if (Date.now() - arranque > PRESUPUESTO_MS) {
        sinTiempo += 1
        continue
      }
      pasadas.push(await pasadaDeCliente(service, { id, nombre: nombreDe.get(id) ?? id }, hoy))
    }

    let resumenSemanal = 0
    if (esLunes(hoy) && sinTiempo === 0) {
      const r = await avisarResumenSemanal(service, hoy)
      resumenSemanal = r.avisados
    }

    const conError = pasadas.filter((p) => p.error && p.conectado)
    const total = (f: (p: ResumenDePasada) => number) => pasadas.reduce((s, p) => s + f(p), 0)
    return {
      clientes: ids.length,
      pasadas,
      resumen:
        `${pasadas.length} clientes revisados, ${total((p) => p.nuevas)} alertas nuevas, ${total((p) => p.resueltas)} resueltas, ${total((p) => p.avisadas)} avisadas` +
        (resumenSemanal > 0 ? `, resumen semanal a ${resumenSemanal}` : '') +
        (sinTiempo > 0 ? `; ${sinTiempo} sin tiempo (van primero la próxima vez)` : '') +
        (conError.length > 0 ? `; ${conError.length} con aviso: ${conError.map((p) => p.cliente).join(', ').slice(0, 120)}` : ''),
    }
  })

  return NextResponse.json({ ok: true, ...salida })
}
