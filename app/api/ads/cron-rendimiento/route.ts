import { NextResponse, type NextRequest } from 'next/server'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'
import { avanzar, cuentasASincronizar, cuentasConTrabajo } from '@/lib/ads/sincronizar'
import { avanzarVentas, ventasConTrabajo } from '@/lib/ads/ventas-totales'
import { esSinMigracion } from '@/lib/ads/cuenta'
import { textoDeError } from '@/lib/sistema/error-texto'
import { cuentasDelMotorConTrabajo, pasoDelMotor } from '@/lib/ads/motor-cron'

/**
 * LA LECTURA AUTOMÁTICA DEL RENDIMIENTO DE AMAZON ADS (proceso `ads-rendimiento`).
 *
 * Cada 2 minutos mira qué cuentas de anunciante (en uso y asignadas) tienen algo que hacer y da UN paso en cada una: recoger los informes que Amazon ya haya terminado, o pedir los nuevos si han
 * pasado 3 horas. No espera a Amazon nunca (lib/ads/sincronizar.ts). Solo LEE de Amazon.
 *
 * Además hace la parte automática del MOTOR de optimización de las cuentas que lo tengan encendido (lib/ads/motor-cron.ts): términos de búsqueda una vez al día, propuestas y, en autopiloto, negativas.
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
  // Las cuentas con el motor encendido (migración 294). Sin ella, simplemente no hay motor
  let delMotor: Awaited<ReturnType<typeof cuentasDelMotorConTrabajo>> = []
  try {
    delMotor = await cuentasDelMotorConTrabajo()
  } catch (error) {
    if (!esSinMigracion(error)) throw error
  }
  // Las ventas totales para el TACoS (migración 298), una vez al día por cuenta
  let conVentas: string[] = []
  try {
    conVentas = await ventasConTrabajo((await cuentasASincronizar()).map((c) => c.id))
  } catch (error) {
    if (!esSinMigracion(error)) throw error
  }
  if (pendientes.length === 0 && delMotor.length === 0 && conVentas.length === 0) return NextResponse.json({ ok: true, saltado: 'nada que recoger ni que pedir' })

  const salida = await conRegistro('ads-rendimiento', lanzadoPorDe(request.headers), async () => {
    const arranque = Date.now()
    const cuenta = { pedido: 0, esperando: 0, guardado: 0, error: 0, sinTiempo: 0 }
    const errores: string[] = []
    // (el bucle del motor va más abajo, tras el de rendimiento)
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
    // ---- el motor de optimización ----
    const motor = { cuentas: 0, nuevas: 0, aplicadas: 0, fallidas: 0 }
    for (const c of delMotor) {
      if (Date.now() - arranque > PRESUPUESTO_MS) {
        cuenta.sinTiempo += 1
        continue
      }
      try {
        const r = await pasoDelMotor(c)
        motor.cuentas += 1
        motor.nuevas += r.nuevas
        motor.aplicadas += r.aplicadas
        motor.fallidas += r.fallidas
      } catch (e) {
        cuenta.error += 1
        errores.push(`motor: ${textoDeError(e, 90)}`)
      }
    }
    // ---- las ventas totales (TACoS) ----
    const ventas = { pedido: 0, guardado: 0, error: 0 }
    for (const id of conVentas) {
      if (Date.now() - arranque > PRESUPUESTO_MS) {
        cuenta.sinTiempo += 1
        continue
      }
      try {
        const r = await avanzarVentas(id)
        if (r === 'pedido') ventas.pedido += 1
        else if (r === 'guardado') ventas.guardado += 1
        else if (r === 'error') ventas.error += 1
      } catch (e) {
        ventas.error += 1
        errores.push(`ventas: ${textoDeError(e, 90)}`)
      }
    }
    return {
      ...cuenta,
      motor,
      ventas,
      resumen:
        `${pendientes.length} cuentas con trabajo: ${cuenta.pedido} informes pedidos, ${cuenta.guardado} guardadas, ${cuenta.esperando} esperando a Amazon` +
        (delMotor.length > 0 ? `; motor: ${motor.cuentas} cuentas, ${motor.nuevas} propuestas nuevas, ${motor.aplicadas} aplicadas${motor.fallidas > 0 ? `, ${motor.fallidas} fallidas` : ''}` : '') +
        (conVentas.length > 0 ? `; ventas totales: ${ventas.pedido} pedidas, ${ventas.guardado} guardadas${ventas.error ? `, ${ventas.error} con error` : ''}` : '') +
        (cuenta.error > 0 ? `, ${cuenta.error} con error (${errores.slice(0, 2).join(' · ')})` : '') +
        (cuenta.sinTiempo > 0 ? `; ${cuenta.sinTiempo} sin tiempo (van en la pasada siguiente)` : ''),
    }
  })

  return NextResponse.json({ ok: true, ...salida })
}
