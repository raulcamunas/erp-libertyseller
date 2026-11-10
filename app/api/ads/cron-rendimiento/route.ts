import { NextResponse, type NextRequest } from 'next/server'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'
import { avanzar, cuentasConTrabajo } from '@/lib/ads/sincronizar'
import { esSinMigracion } from '@/lib/ads/cuenta'
import { textoDeError } from '@/lib/sistema/error-texto'

/**
 * LA LECTURA AUTOMÁTICA DEL RENDIMIENTO DE AMAZON ADS (proceso `ads-rendimiento`).
 *
 * Cada 2 minutos mira qué cuentas de anunciante (en uso y asignadas) tienen algo que hacer y da UN paso en cada una: recoger los informes que Amazon ya haya terminado, o pedir los nuevos si han
 * pasado 3 horas. No espera a Amazon nunca (lib/ads/sincronizar.ts). Solo LEE de Amazon.
 *
 * Si no hay nada que hacer —lo normal—, contesta sin abrir fila en el registro de procesos: serían 700 filas al día para decir «nada».
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

const PRESUPUESTO_MS = 90_000

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  if (request.nextUrl.searchParams.get('forzar') !== '1') {
    const veredicto = await tocaAhora('ads-rendimiento')
    if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
  }

  let pendientes
  try {
    pendientes = await cuentasConTrabajo()
  } catch (error) {
    // Sin la migración 293 no hay nada que hacer todavía: se dice y se sigue sin fallar
    if (esSinMigracion(error)) return NextResponse.json({ ok: true, saltado: 'falta lanzar la migración 293' })
    throw error
  }
  if (pendientes.length === 0) return NextResponse.json({ ok: true, saltado: 'nada que recoger ni que pedir' })

  const salida = await conRegistro('ads-rendimiento', lanzadoPorDe(request.headers), async () => {
    const arranque = Date.now()
    const cuenta = { pedido: 0, esperando: 0, guardado: 0, error: 0, sinTiempo: 0 }
    const errores: string[] = []
    for (const c of pendientes) {
      if (Date.now() - arranque > PRESUPUESTO_MS) {
        cuenta.sinTiempo += 1
        continue
      }
      try {
        const r = await avanzar(c)
        if (r.accion === 'pedido') cuenta.pedido += 1
        else if (r.accion === 'esperando') cuenta.esperando += 1
        else if (r.accion === 'guardado') cuenta.guardado += 1
        else if (r.accion === 'error') {
          cuenta.error += 1
          if (r.detalle) errores.push(r.detalle.slice(0, 100))
        }
      } catch (e) {
        cuenta.error += 1
        errores.push(textoDeError(e, 100))
      }
    }
    return {
      ...cuenta,
      resumen:
        `${pendientes.length} cuentas con trabajo: ${cuenta.pedido} informes pedidos, ${cuenta.guardado} guardadas, ${cuenta.esperando} esperando a Amazon` +
        (cuenta.error > 0 ? `, ${cuenta.error} con error (${errores.slice(0, 2).join(' · ')})` : '') +
        (cuenta.sinTiempo > 0 ? `; ${cuenta.sinTiempo} sin tiempo (van en la pasada siguiente)` : ''),
    }
  })

  return NextResponse.json({ ok: true, ...salida })
}
