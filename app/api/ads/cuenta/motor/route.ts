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
  ensayarPropuesta,
  MINUTOS_RESERVA_COLGADA,
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
import { abrirCuenta, errorDeRuta, esAdministrador, soloAdministradores } from '@/lib/ads/ruta'
import { estadoDelMotor } from '@/lib/ads/motor-estado'
import { generarDelMotor } from '@/lib/ads/motor-cron'

/**
 * EL MOTOR DE OPTIMIZACIÓN DE UNA CUENTA. Quien lleva cuentas (administrador o con la casilla de PPC). APLICAR escribe en la cuenta del cliente.
 *
 *   GET  ?perfilId=                       → modo, ficha firmada, términos, propuestas (pendientes y lo de los últimos 30 días), qué se puede aplicar, «qué hacer hoy», los umbrales y
 *                                           el estado del motor (última generación, próximo paso, salud del proceso de fondo)
 *   PUT  {perfilId, modo}                 → cambia el modo (aprueba y autopiloto exigen la ficha firmada)            · SOLO ADMINISTRADORES
 *   PUT  {perfilId, umbrales}             → guarda los umbrales estimados de la cuenta (migración 305)                · SOLO ADMINISTRADORES
 *   POST {perfilId, accion, id?, ids?}    → 'generar' · 'actualizar-terminos' · 'aplicar' · 'aplicar-varias' · 'ensayar' · 'descartar' · 'descartar-varias' · 'deshacer'
 *
 * El GET YA NO HABLA CON AMAZON (antes daba un paso de la lectura de términos en cada carga y la pantalla lo repetía cada 8 s): recoger el informe es cosa del proceso
 * de fondo, y las propuestas se generan cuando el informe es más nuevo que la última generación (lib/ads/motor-cron.ts). «Actualizar términos» solo PIDE el informe.
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
    const [modo, ficha] = await Promise.all([leerModo(cuenta.id), leerFicha(cuenta.id)])
    const [terminos, propuestas, contexto, objetivos, umbrales, motor] = await Promise.all([estadoDeTerminos(cuenta.id), listarPropuestas(cuenta.id), contextoDeAplicar(cuenta.id, false), objetivosDeCuenta(cuenta.id, ficha), leerUmbrales(cuenta.id), estadoDelMotor(cuenta.id, modo)])
    // Qué se puede aplicar ahora mismo y, si no, por qué (para la pantalla; el servidor lo vuelve a comprobar al aplicar). El contexto se lee UNA vez, no por fila
    const aplicables: Record<string, string | null> = {}
    for (const p of propuestas.filter((x) => x.estado === 'pendiente' || x.estado === 'error')) {
      const r = decidirConContexto(contexto, p, false)
      aplicables[p.id] = r.ok ? null : r.motivo
    }
    const hoy = resumenDeHoy(propuestas, { modo, firmada: Boolean(ficha.firmadaAt), terminos, sinAcos: objetivos.sinAcos, sinPrecio: objetivos.sinPrecio, conPrecioEstimado: objetivos.conPrecioEstimado, sinFicha: objetivos.sinFicha, faltaMigracionPausas: !umbrales.guardables }, Date.now())
    return NextResponse.json({
      modo,
      esAdmin: esAdministrador(a.sesion),
      motor,
      minutosReservaColgada: MINUTOS_RESERVA_COLGADA,
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
    // Cambiar el modo (incluido el autopiloto) y los umbrales: solo administradores
    const prohibido = soloAdministradores(a.sesion, 'Cambiar el modo del motor y los umbrales')
    if (prohibido) return prohibido
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
        // Solo PIDE el informe: lo recoge el proceso de fondo, que también genera las propuestas cuando llega
        const r = await avanzarTerminos(cuenta, { forzar: true, soloPedir: true })
        return NextResponse.json({ ok: true, accion: r.accion, detalle: r.detalle ?? null })
      }
      case 'generar': {
        // Lo mismo que el proceso de fondo (generarDelMotor): en modo agente, con los ajustes del agente; si no se pueden leer, hoy sin pujas. Con el modo apagado no se propone nada
        const g = await generarDelMotor(cuenta, await leerModo(cuenta.id))
        const f3 = g.fase3 ?? { pujas: 0, presupuestos: 0, pausas: 0 }
        return NextResponse.json({ ok: true, resumen: { ...g.resumen, ...f3, nuevas: g.nuevas, errores: g.errores } })
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
      case 'ensayar': {
        // El camino de aplicar sin escribir en Amazon: lo que se haría queda en el log con origen «ensayo»
        if (!id) return fail(400, 'Falta la propuesta.')
        return NextResponse.json({ ok: true, ensayo: await ensayarPropuesta(cuenta, id, a.sesion.userId) })
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
