import { NextResponse, type NextRequest } from 'next/server'
import { hasTokenKey } from '@/lib/amazon/crypto'
import { dependenciasDeProduccion } from '@/lib/correo/secuencias/produccion'
import { ejecutarPasada } from '@/lib/correo/secuencias/motor'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LOS SEGUIMIENTOS AUTOMÁTICOS DE CORREO: UNA PASADA DEL MOTOR.
 *
 * Cada minuto el cron entra aquí y el motor (lib/correo/secuencias/motor.ts):
 *   1. mira si algún lead ha contestado o ha rebotado y corta su secuencia en el acto;
 *   2. hace el mantenimiento: freno de buzones, cierre a «No interesa», reparto de horas, limpieza;
 *   3. reserva los seguimientos que ya tocan y, uno a uno, decide si salen, se aplazan o se paran, leyendo antes el buzón.
 *
 * NACE APAGADO Y EN ENSAYO. El interruptor está en Correo → Secuencias → Ajustes (tabla correo_secuencia_ajustes, migración 245): apagado, cada pasada
 * contesta «apagado» sin tocar nada; en ensayo se decide y se apunta lo que se haría, pero no sale ni un correo. Aparte, este proceso se puede apagar
 * del todo desde Sistema (cron_config), y el reloj (cada minuto) lo decide `tocaAhora()` como en el resto de procesos.
 *
 * Una pasada nunca devuelve el texto de un correo ni una dirección: solo cuántos (el registro de Sistema lo lee quien administra).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  if (request.nextUrl.searchParams.get('forzar') !== '1') {
    const veredicto = await tocaAhora('correo-secuencias')
    if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
  }

  if (!hasTokenKey()) {
    return NextResponse.json({ ok: true, saltado: 'El servidor no tiene la clave de cifrado' })
  }

  const salida = await conRegistro('correo-secuencias', lanzadoPorDe(request.headers), async () => {
    const pasada = await ejecutarPasada(dependenciasDeProduccion(createServiceClient()))
    return {
      saltado: pasada.saltado,
      vigilados: pasada.vigilados,
      respondidas: pasada.respondidas,
      rebotes: pasada.rebotes,
      frenos: pasada.frenos,
      no_interesa: pasada.noInteresa,
      reprogramados: pasada.reprogramados,
      planificados: pasada.planificados,
      reservados: pasada.reservados,
      enviados: pasada.enviados,
      aplazados: pasada.aplazados,
      parados: pasada.parados,
      pausados: pasada.pausados,
      fallidos: pasada.fallidos,
      ensayados: pasada.ensayados,
      respuestas_leidas: pasada.respuestasLeidas,
      respuestas_cerradas: pasada.respuestasCerradas,
      respuestas_con_rellamada: pasada.respuestasConRellamada,
      respuestas_fallidas: pasada.respuestasFallidas,
      errores: pasada.errores.slice(0, 10),
      resumen: pasada.resumen,
    }
  })

  return NextResponse.json({ ok: true, ...salida })
}
