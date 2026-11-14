import { generarPropuestasDePujaYPresupuesto } from '@/lib/ads/motor-pujas'
import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail } from '@/lib/amazon/api'
import { leerFicha } from '@/lib/ads/cuenta'
import {
  aplicarPropuesta,
  aplicarVarias,
  contextoDeAplicar,
  decidirConContexto,
  descartarPropuesta,
  descartarVarias,
  deshacerPropuesta,
  generarPropuestas,
  guardarModo,
  guardarUmbrales,
  leerModo,
  leerUmbrales,
  listarPropuestas,
  MODOS,
  objetivosDeCuenta,
  TOPE_DIARIO_AUTOPILOTO,
  TOPE_DIARIO_MANUAL,
  type ModoDelMotor,
} from '@/lib/ads/motor'
import { resumenDeHoy } from '@/lib/ads/hoy'
import { avanzarTerminos, estadoDeTerminos } from '@/lib/ads/terminos'
import { abrirCuenta, errorDeRuta } from '@/lib/ads/ruta'

/**
 * EL MOTOR DE OPTIMIZACIÓN DE UNA CUENTA. Solo administradores. APLICAR escribe en la cuenta del cliente.
 *
 *   GET  ?perfilId=                       → modo, ficha firmada, términos, propuestas (pendientes y lo de los últimos 30 días), qué se puede aplicar, «qué hacer hoy» y los umbrales
 *   PUT  {perfilId, modo}                 → cambia el modo (aprueba y autopiloto exigen la ficha firmada)
 *   PUT  {perfilId, umbrales}             → guarda los umbrales estimados de la cuenta (migración 305)
 *   POST {perfilId, accion, id?, ids?}    → 'generar' · 'actualizar-terminos' · 'aplicar' · 'aplicar-varias' · 'descartar' · 'descartar-varias' · 'deshacer'
 *
 * Cada GET también da UN paso de la lectura de términos si el motor está encendido y toca (como en el rendimiento): así la pantalla no depende de que el proceso de fondo haya pasado ahora mismo.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
// «Aplicar varias» hace una llamada a Amazon por propuesta (hasta el tope diario): necesita más que los 90 s de antes
export const maxDuration = 300

/** Los ids de un lote, solo los que tienen forma de id */
const idsDe = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && UUID.test(x)) : [])

export async function GET(request: NextRequest) {
  try {
    const a = await abrirCuenta(request.nextUrl.searchParams.get('perfilId'))
    if (a instanceof NextResponse) return a
    const cuenta = { id: a.cuenta.id, conexionId: a.cuenta.conexionId, profileId: a.cuenta.profileId }
    const modo = await leerModo(cuenta.id)
    if (modo !== 'apagado') await avanzarTerminos(cuenta)
    const ficha = await leerFicha(cuenta.id)
    const [terminos, propuestas, contexto, objetivos, umbrales] = await Promise.all([estadoDeTerminos(cuenta.id), listarPropuestas(cuenta.id), contextoDeAplicar(cuenta.id, false), objetivosDeCuenta(cuenta.id, ficha), leerUmbrales(cuenta.id)])
    // Qué se puede aplicar ahora mismo y, si no, por qué (para la pantalla; el servidor lo vuelve a comprobar al aplicar). El contexto se lee UNA vez, no por fila
    const aplicables: Record<string, string | null> = {}
    for (const p of propuestas.filter((x) => x.estado === 'pendiente' || x.estado === 'error')) {
      const r = decidirConContexto(contexto, p, false)
      aplicables[p.id] = r.ok ? null : r.motivo
    }
    const hoy = resumenDeHoy(propuestas, { modo, firmada: Boolean(ficha.firmadaAt), terminos, sinAcos: objetivos.sinAcos, sinPrecio: objetivos.sinPrecio, conPrecioEstimado: objetivos.conPrecioEstimado, sinFicha: objetivos.sinFicha, faltaMigracionPausas: !umbrales.guardables }, Date.now())
    return NextResponse.json({
      modo,
      firmada: Boolean(ficha.firmadaAt),
      terminos,
      propuestas,
      aplicables,
      topeAutopiloto: TOPE_DIARIO_AUTOPILOTO,
      topeManual: TOPE_DIARIO_MANUAL,
      aplicadasHoy: contexto.aplicadasHoy,
      hoy,
      umbrales: umbrales.umbrales,
      umbralesGuardables: umbrales.guardables,
      // Los de la ficha (SOP, firmados) que usa el motor, para enseñarlos al lado de los estimados
      ficha: { comprasParaExacta: ficha.comprasParaExacta, clicsMinimosNegativizar: ficha.clicsMinimosNegativizar, gastoSinVentaX: ficha.gastoSinVentaX, muestraMinimaClics: ficha.muestraMinimaClics, cambioPujaPct: ficha.cambioPujaPct, diasEntreCambiosPuja: ficha.diasEntreCambiosPuja, subidaPresupuestoPct: ficha.subidaPresupuestoPct, horasEntreSubidas: ficha.horasEntreSubidas },
    })
  } catch (error) {
    return errorDeRuta(error, 'Ads: leer el motor')
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { perfilId?: unknown; modo?: unknown; umbrales?: unknown }
    const a = await abrirCuenta(body.perfilId)
    if (a instanceof NextResponse) return a
    if (body.umbrales !== undefined) {
      const umbrales = await guardarUmbrales(a.cuenta.id, body.umbrales, a.sesion.userId)
      return NextResponse.json({ ok: true, umbrales })
    }
    if (!MODOS.includes(body.modo as ModoDelMotor)) return fail(400, 'Ese modo no existe.')
    await guardarModo(a.cuenta.id, body.modo as ModoDelMotor, a.sesion.userId)
    return NextResponse.json({ ok: true, modo: body.modo })
  } catch (error) {
    return errorDeRuta(error, 'Ads: cambiar el motor')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { perfilId?: unknown; accion?: unknown; id?: unknown; ids?: unknown }
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
        // Fase 3 (pujas, pausas y presupuesto) también al pulsar; si el modo está apagado no se propone nada
        const f3 = r.omitido === 'apagado' ? { pujas: 0, presupuestos: 0, pausas: 0 } : await generarPropuestasDePujaYPresupuesto(cuenta)
        return NextResponse.json({ ok: true, resumen: { ...r, ...f3, nuevas: r.nuevas + f3.pujas + f3.presupuestos + f3.pausas } })
      }
      case 'aplicar': {
        if (!id) return fail(400, 'Falta la propuesta.')
        const p = await aplicarPropuesta(cuenta, id, { userId: a.sesion.userId, automatica: false })
        return NextResponse.json({ ok: true, propuesta: p })
      }
      case 'aplicar-varias': {
        const ids = idsDe(body.ids)
        if (ids.length === 0) return fail(400, 'No hay ninguna propuesta marcada.')
        const resultados = await aplicarVarias(cuenta, ids, a.sesion.userId)
        return NextResponse.json({ ok: true, resultados, aplicadas: resultados.filter((r) => r.ok).length, fallidas: resultados.filter((r) => !r.ok).length })
      }
      case 'descartar': {
        if (!id) return fail(400, 'Falta la propuesta.')
        await descartarPropuesta(cuenta.id, id, a.sesion.userId)
        return NextResponse.json({ ok: true })
      }
      case 'descartar-varias': {
        const ids = idsDe(body.ids)
        if (ids.length === 0) return fail(400, 'No hay ninguna propuesta marcada.')
        return NextResponse.json({ ok: true, descartadas: await descartarVarias(cuenta.id, ids, a.sesion.userId) })
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
