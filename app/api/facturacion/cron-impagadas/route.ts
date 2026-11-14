import { NextResponse, type NextRequest } from 'next/server'
import { avisarDeImpagadas } from '@/lib/facturacion/recordatorios'
import { conRegistro, lanzadoPorDe, leerConfigCron, tocaAhora } from '@/lib/sistema/cron'

/**
 * EL AVISO DE LAS FACTURAS QUE LLEVAN DÍAS SIN PAGAR.
 *
 * Una vez al día: lee de Zoho lo que está por cobrar y, de lo que lleva 3 días laborables o más vencido y aún no tiene recordatorio, deja
 * un aviso en la campana de cada administrador (una vez por factura; lib/facturacion/recordatorios.ts). No manda nada al cliente.
 *
 * Solo en horario de oficina de un día laborable en España: un aviso a las 3 de la mañana llegaría al móvil a esa hora. Sin la migración 301
 * (que pone su reloj en cron_config y admite el tipo de aviso) no hace nada: sin reloj correría cada minuto contra Zoho.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

function enEspana(momento = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(momento)
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  return { dia: `${v('year')}-${v('month')}-${v('day')}`, hora: Number(v('hour')), semana: v('weekday') }
}

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const forzar = request.nextUrl.searchParams.get('forzar') === '1'
  const ahora = enEspana()
  if (!forzar) {
    if (ahora.semana === 'Sat' || ahora.semana === 'Sun' || ahora.hora < 9 || ahora.hora >= 18) return NextResponse.json({ ok: true, saltado: 'fuera del horario de oficina' })
    const config = (await leerConfigCron({ copia: true })).find((c) => c.tarea === 'facturas-impagadas')
    if (!config) return NextResponse.json({ ok: true, saltado: 'falta lanzar la migración 301' })
    const veredicto = await tocaAhora('facturas-impagadas')
    if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
  }

  const salida = await conRegistro('facturas-impagadas', lanzadoPorDe(request.headers), async () => {
    const r = await avisarDeImpagadas(ahora.dia)
    return {
      ...r,
      resumen: r.faltaMigracion ? 'falta lanzar la migración 301' : `${r.avisadas} ${r.avisadas === 1 ? 'factura avisada' : 'facturas avisadas'} de ${r.revisadas} por cobrar`,
    }
  })
  return NextResponse.json({ ok: true, ...salida })
}
