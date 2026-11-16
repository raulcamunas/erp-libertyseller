import { NextResponse, type NextRequest } from 'next/server'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'
import { esSinMigracion } from '@/lib/ads/cuenta'
import { correrAgente, cuentasDelAgente } from '@/lib/ads/agente/agente-cron'
import { FALTA_MIGRACION_315 } from '@/lib/ads/agente/tipos'

/**
 * EL AGENTE PPC DE AMAZON ADS (proceso `ads-agente`, cada 5 minutos).
 *
 * En las cuentas con el agente encendido (ensayo, activo o frenado): vigila el gasto de hoy contra los presupuestos, APLICA cambios en Amazon Ads con topes, rampa y freno,
 * piensa con la IA dos veces al día, mide lo que hizo, deshace lo que salió mal y avisa en #notificaciones-erp (lib/ads/agente/agente-cron.ts). ESCRIBE en la cuenta del cliente.
 *
 * Tiene su propia ruta (y no va dentro de `ads-rendimiento`) porque el cerebro y las aplicaciones no caben en 90 s: aquí hay 240 s por pasada (maxDuration 300), cada cuenta se reserva
 * 330 s y cada paso deja su sello ANTES de darse. Si no hay nada que hacer —o solo vigilancia rutinaria—, contesta sin abrir fila en el registro de procesos.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const PRESUPUESTO_MS = 240_000

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  if (request.nextUrl.searchParams.get('forzar') !== '1') {
    const veredicto = await tocaAhora('ads-agente')
    if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
  }

  const arranque = Date.now()
  let cuentas: Awaited<ReturnType<typeof cuentasDelAgente>>['cuentas']
  try {
    const r = await cuentasDelAgente(arranque)
    if (r.faltaMigracion) return NextResponse.json({ ok: true, saltado: 'falta lanzar la migración 315' })
    cuentas = r.cuentas
  } catch (error) {
    if (esSinMigracion(error) || (error instanceof Error && error.message === FALTA_MIGRACION_315)) return NextResponse.json({ ok: true, saltado: 'falta lanzar la migración 315' })
    throw error
  }
  if (cuentas.length === 0) return NextResponse.json({ ok: true, saltado: 'el agente no tiene nada que hacer ahora' })

  // Se da la pasada SIN abrir fila: solo se registra si ha hecho algo (aplicar, ensayar, retener, deshacer, frenar, avisar o un error)
  const r = await correrAgente(cuentas, arranque, PRESUPUESTO_MS)
  if (!r.hizoAlgo) return NextResponse.json({ ok: true, saltado: `agente: ${r.cuentas} cuentas vigiladas, nada nuevo`, pasos: r.pasos })

  const salida = await conRegistro('ads-agente', lanzadoPorDe(request.headers), async () => ({
    agente: r,
    error: r.errores.length,
    resumen:
      `agente: ${r.cuentas} cuentas, ${r.pasos} pasos, ${r.aplicadas} aplicadas, ${r.ensayadas} ensayadas, ${r.retenidas} retenidas` +
      (r.errores.length > 0 ? `; ${r.errores.length} con error (${r.errores.slice(0, 2).join(' · ')})` : '') +
      (r.sinTiempo > 0 ? `; ${r.sinTiempo} sin tiempo (van en la pasada siguiente)` : ''),
  }))
  return NextResponse.json({ ok: true, ...salida })
}
