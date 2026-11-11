import { generarPropuestasDePujaYPresupuesto } from '@/lib/ads/motor-pujas'
import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail } from '@/lib/amazon/api'
import { leerFicha } from '@/lib/ads/cuenta'
import { aplicarPropuesta, descartarPropuesta, deshacerPropuesta, generarPropuestas, guardarModo, leerModo, listarPropuestas, MODOS, puedeAplicar, TOPE_DIARIO_AUTOPILOTO, type ModoDelMotor } from '@/lib/ads/motor'
import { avanzarTerminos, estadoDeTerminos } from '@/lib/ads/terminos'
import { abrirCuenta, errorDeRuta } from '@/lib/ads/ruta'

/**
 * EL MOTOR DE OPTIMIZACIÓN DE UNA CUENTA. Solo administradores. APLICAR escribe en la cuenta del cliente.
 *
 *   GET  ?perfilId=                       → modo, si la ficha está firmada, estado de los términos y las propuestas (pendientes y lo de los últimos 30 días)
 *   PUT  {perfilId, modo}                 → cambia el modo (aprueba y autopiloto exigen la ficha firmada)
 *   POST {perfilId, accion, id?}          → 'generar' · 'actualizar-terminos' · 'aplicar' · 'descartar' · 'deshacer'
 *
 * Cada GET también da UN paso de la lectura de términos si el motor está encendido y toca (como en el rendimiento): así la pantalla no depende de que el proceso de fondo haya pasado ahora mismo.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 90

export async function GET(request: NextRequest) {
  try {
    const a = await abrirCuenta(request.nextUrl.searchParams.get('perfilId'))
    if (a instanceof NextResponse) return a
    const cuenta = { id: a.cuenta.id, conexionId: a.cuenta.conexionId, profileId: a.cuenta.profileId }
    const modo = await leerModo(cuenta.id)
    if (modo !== 'apagado') await avanzarTerminos(cuenta)
    const [ficha, terminos, propuestas] = await Promise.all([leerFicha(cuenta.id), estadoDeTerminos(cuenta.id), listarPropuestas(cuenta.id)])
    // Qué se puede aplicar ahora mismo y, si no, por qué (para la pantalla; el servidor lo vuelve a comprobar al aplicar)
    const aplicables: Record<string, string | null> = {}
    for (const p of propuestas.filter((x) => x.estado === 'pendiente' || x.estado === 'error')) {
      const r = await puedeAplicar(cuenta.id, p, false)
      aplicables[p.id] = r.ok ? null : r.motivo
    }
    return NextResponse.json({ modo, firmada: Boolean(ficha.firmadaAt), terminos, propuestas, aplicables, topeAutopiloto: TOPE_DIARIO_AUTOPILOTO })
  } catch (error) {
    return errorDeRuta(error, 'Ads: leer el motor')
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { perfilId?: unknown; modo?: unknown }
    const a = await abrirCuenta(body.perfilId)
    if (a instanceof NextResponse) return a
    if (!MODOS.includes(body.modo as ModoDelMotor)) return fail(400, 'Ese modo no existe.')
    await guardarModo(a.cuenta.id, body.modo as ModoDelMotor, a.sesion.userId)
    return NextResponse.json({ ok: true, modo: body.modo })
  } catch (error) {
    return errorDeRuta(error, 'Ads: cambiar el modo del motor')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { perfilId?: unknown; accion?: unknown; id?: unknown }
    const a = await abrirCuenta(body.perfilId)
    if (a instanceof NextResponse) return a
    const cuenta = { id: a.cuenta.id, conexionId: a.cuenta.conexionId, profileId: a.cuenta.profileId }
    const id = typeof body.id === 'string' && UUID.test(body.id) ? body.id : null

    switch (body.accion) {
      case 'actualizar-terminos': {
        if ((await leerModo(cuenta.id)) === 'apagado') return fail(400, 'El motor está apagado en esta cuenta.')
        const r = await avanzarTerminos(cuenta, { forzar: true })
        return NextResponse.json({ ok: true, accion: r.accion, detalle: r.detalle ?? null })
      }
      case 'generar': {
        const r = await generarPropuestas(cuenta)
        // Fase 3 (pujas y presupuesto) también al pulsar; si el modo está apagado no se propone nada
        const f3 = r.omitido === 'apagado' ? { pujas: 0, presupuestos: 0 } : await generarPropuestasDePujaYPresupuesto(cuenta)
        return NextResponse.json({ ok: true, resumen: { ...r, nuevas: r.nuevas + f3.pujas + f3.presupuestos, pujas: f3.pujas, presupuestos: f3.presupuestos } })
      }
      case 'aplicar': {
        if (!id) return fail(400, 'Falta la propuesta.')
        const p = await aplicarPropuesta(cuenta, id, { userId: a.sesion.userId, automatica: false })
        return NextResponse.json({ ok: true, propuesta: p })
      }
      case 'descartar': {
        if (!id) return fail(400, 'Falta la propuesta.')
        await descartarPropuesta(cuenta.id, id, a.sesion.userId)
        return NextResponse.json({ ok: true })
      }
      case 'deshacer': {
        if (!id) return fail(400, 'Falta la propuesta.')
        await deshacerPropuesta(cuenta, id, a.sesion.userId)
        return NextResponse.json({ ok: true })
      }
      default:
        return fail(400, 'Acción desconocida.')
    }
  } catch (error) {
    return errorDeRuta(error, 'Ads: acción del motor')
  }
}
