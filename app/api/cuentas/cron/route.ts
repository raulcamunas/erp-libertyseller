import { NextResponse, type NextRequest } from 'next/server'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'
import { avisarResponsables } from '@/lib/cuentas/avisos'

/**
 * CUENTAS DE CLIENTES · EL AVISO SEMANAL AL RESPONSABLE DE CADA CUENTA (lib/cuentas/avisos.ts).
 *
 * El crontab llama cada minuto; trabaja una vez al día (cada 1440 min, lib/sistema/cron.ts), y solo los lunes y jueves en horario de oficina en
 * España: un aviso a las 3 de la mañana llegaría al móvil a esa hora. Solo escribe en la campana.
 *
 * EL SECRETO CIERRA LA PUERTA SI FALTA, NO LA ABRE: en middleware.ts todo lo que empieza por /api/ es público.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

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
  const ahora = enEspana()
  const forzar = request.nextUrl.searchParams.get('forzar')
  const cual: 'lunes' | 'jueves' | null = forzar === 'lunes' || forzar === 'jueves' ? forzar : ahora.semana === 'Mon' ? 'lunes' : ahora.semana === 'Thu' ? 'jueves' : null
  if (!forzar) {
    if (!cual) return NextResponse.json({ ok: true, saltado: 'solo avisa los lunes y los jueves' })
    if (ahora.hora < 9 || ahora.hora >= 18) return NextResponse.json({ ok: true, saltado: 'fuera del horario de oficina' })
    const veredicto = await tocaAhora('cuentas-avisos')
    if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
  }
  if (!cual) return NextResponse.json({ error: 'forzar tiene que ser «lunes» o «jueves»' }, { status: 400 })

  const salida = await conRegistro('cuentas-avisos', lanzadoPorDe(request.headers), async () => {
    const r = await avisarResponsables(ahora.dia, cual)
    return { ...r, resumen: r.falta307 ? 'falta lanzar la migración 307' : `${r.avisados} ${r.avisados === 1 ? 'aviso' : 'avisos'} de ${r.cuentas} cuentas con responsable (${cual})` }
  })
  return NextResponse.json({ ok: true, ...salida })
}
