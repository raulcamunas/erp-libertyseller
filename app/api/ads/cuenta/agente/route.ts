import { NextResponse, type NextRequest } from 'next/server'
import { UUID, fail } from '@/lib/amazon/api'
import { deshacerPropuesta } from '@/lib/ads/motor'
import { abrirCuenta, errorDeRuta, esAdministrador, soloAdministradores } from '@/lib/ads/ruta'
import { datosParaEncender, nombreDeCuenta } from '@/lib/ads/agente/contexto-servidor'
import {
  apagarAgente,
  cambiarParadaGeneral,
  encenderAgente,
  frenarAgente,
  guardarProducto,
  guardarTemporada,
  guardarTopes,
  hayEscrituraRealEnAlgunaCuenta,
  leerConfigDelAgente,
  pedirPensar,
  reanudarAgente,
  saltarEnsayo,
} from '@/lib/ads/agente/estado-servidor'
import { anotarEvento } from '@/lib/ads/agente/eventos-servidor'
import { panelDelAgente } from '@/lib/ads/agente/panel-servidor'
import { enVedaDeActivacion } from '@/lib/ads/agente/temporada-calculo'
import { FALTA_MIGRACION_315, type FaseDeProducto } from '@/lib/ads/agente/tipos'
import { horaLocal } from '@/lib/ads/agente/uso-calculo'
import { frenosActuales } from '@/lib/ads/agente/vigilar-servidor'
import { decisionDeReanudar } from '@/lib/ads/agente/guardarrailes-calculo'

/**
 * EL AGENTE PPC DE UNA CUENTA (pestaña «Agente» de Marketing Test). Quien lleva cuentas lo ve; lo gobierna un ADMINISTRADOR.
 * El agente ESCRIBE en la cuenta del cliente sin pedir permiso: por eso encender, reanudar y tocar sus topes es cosa de administradores.
 *
 *   GET  ?perfilId=                                   → PanelDelAgente (sin la 315: { faltaMigracion: 315, … }). No habla con Amazon.
 *   PUT  {perfilId, accion, …}                        · SOLO ADMINISTRADORES
 *        'encender' {saltarEnsayo?, firmarFicha?}      → enciende (ensayo de 3 días, o activo si se salta: exige una escritura real previa en alguna cuenta y estar fuera de la veda → si no, 409)
 *        'apagar' {modo: 'sugiere' | 'aprueba'}        → apaga y deja el motor en ese modo
 *        'saltar-ensayo'                               → ensayo → activo (mismas reglas que al encender)
 *        'reanudar' {ignorarMotivo?}                   → si el motivo del freno sigue: 409 (salvo ignorarlo 24 h); si no, activo con la rampa en el día 2
 *        'frenar' {motivo?}                            → freno manual
 *        'topes' {topes, topeIaUsd, pujaMax}           → topes diarios, tope de IA al mes y puja máxima
 *        'temporada' {eventosManuales, picoEventos}    → eventos de temporada a mano y «+30 % en meses de evento»
 *        'producto' {asin, marca?, fase?}              → marca y fase de un producto
 *        'parada-general' {parar, motivo?}             → interruptor general (TODAS las cuentas)
 *   POST {perfilId, accion: 'deshacer', id}           → deshace un cambio aplicado (quien lleva la cuenta)
 *   POST {perfilId, accion: 'pensar-ahora'}           → pide al agente que piense en la próxima pasada (≤ 5 min) · SOLO ADMINISTRADORES
 *
 * No importa del orquestador: «Pensar ahora» solo marca `pensar_ya`, el cron hace el resto.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

const SIN_ENSAYO = true

const MENSAJE_PRIMER_ENSAYO = 'La primera cuenta del agente tiene que pasar el ensayo.'

const FASES: readonly FaseDeProducto[] = ['lanzamiento', 'normal']

/** ¿Es el error de que falta la 315? */
const esFalta315 = (e: unknown) => e instanceof Error && e.message === FALTA_MIGRACION_315

/** El porqué de no poder saltar el ensayo ahora (null si se puede): sin ninguna escritura real del agente en ninguna cuenta, o en la veda de temporada */
async function porQueNoSeSaltaElEnsayo(perfilId: string, eventosManuales: Parameters<typeof enVedaDeActivacion>[2]): Promise<string | null> {
  // Sin ensayo ni veda (20 nov 2026, Raúl): el agente se enciende activo siempre
  if (SIN_ENSAYO) return null
  if (!(await hayEscrituraRealEnAlgunaCuenta())) return MENSAJE_PRIMER_ENSAYO
  const { pais, zona } = await nombreDeCuenta(perfilId)
  const veda = enVedaDeActivacion(horaLocal(Date.now(), zona).fecha, pais, eventosManuales)
  if (veda) return `No se puede saltar el ensayo durante la veda de ${veda.nombre} (hasta el ${veda.hasta}): el ensayo sigue, pero no se activa hasta que acabe.`
  return null
}

export async function GET(request: NextRequest) {
  try {
    const a = await abrirCuenta(request.nextUrl.searchParams.get('perfilId'))
    if (a instanceof NextResponse) return a
    const cuenta = { id: a.cuenta.id, conexionId: a.cuenta.conexionId, profileId: a.cuenta.profileId }
    return NextResponse.json(await panelDelAgente(cuenta, esAdministrador(a.sesion)))
  } catch (error) {
    return errorDeRuta(error, 'Ads: leer el agente')
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const a = await abrirCuenta(body.perfilId)
    if (a instanceof NextResponse) return a
    const prohibido = soloAdministradores(a.sesion, 'Gobernar el agente PPC')
    if (prohibido) return prohibido
    const cuenta = { id: a.cuenta.id, conexionId: a.cuenta.conexionId, profileId: a.cuenta.profileId }
    const userId = a.sesion.userId

    switch (body.accion) {
      case 'encender': {
        const saltar = body.saltarEnsayo === true
        let previo
        try {
          previo = await leerConfigDelAgente(cuenta.id)
        } catch (e) {
          if (esFalta315(e)) return fail(409, FALTA_MIGRACION_315)
          throw e
        }
        if (saltar) {
          const porque = await porQueNoSeSaltaElEnsayo(cuenta.id, previo?.eventosManuales ?? [])
          if (porque) return fail(409, porque)
        }
        const datos = await datosParaEncender(cuenta, Date.now())
        const config = await encenderAgente(cuenta.id, userId, { saltarEnsayo: saltar, firmarFicha: body.firmarFicha === true, datos })
        return NextResponse.json({ ok: true, config })
      }
      case 'apagar': {
        if (body.modo !== 'sugiere' && body.modo !== 'aprueba') return fail(400, 'Di en qué modo queda el motor al apagar el agente: «sugiere» o «aprueba».')
        await apagarAgente(cuenta.id, userId, body.modo)
        return NextResponse.json({ ok: true })
      }
      case 'saltar-ensayo': {
        const config = await leerConfigDelAgente(cuenta.id)
        if (!config || config.estado !== 'ensayo') return fail(409, 'El agente no está en ensayo.')
        const porque = await porQueNoSeSaltaElEnsayo(cuenta.id, config.eventosManuales)
        if (porque) return fail(409, porque)
        await saltarEnsayo(cuenta.id, userId)
        return NextResponse.json({ ok: true })
      }
      case 'reanudar': {
        const config = await leerConfigDelAgente(cuenta.id)
        if (!config || config.estado !== 'frenado') return fail(409, 'El agente no está frenado.')
        // TODOS los motivos vigentes, no solo el primero: ignorar uno no puede dejar pasar otro que también se cumple
        const siguen = await frenosActuales(cuenta, config, Date.now())
        const dec = decisionDeReanudar(siguen, body.ignorarMotivo === true)
        if (!dec.reanudar) {
          await anotarEvento(cuenta.id, 'reanudar_rechazado', siguen.length > 1 ? `No se reanuda: siguen ${siguen.length} motivos de freno` : 'No se reanuda: el motivo del freno sigue', dec.detalle, {
            motivo: dec.motivo,
            motivos: siguen.map((f) => f.motivo),
            por: userId,
          })
          return NextResponse.json({ error: dec.error, motivo: dec.motivo, detalle: dec.detalle, puedeIgnorar: dec.puedeIgnorar }, { status: 409 })
        }
        await reanudarAgente(cuenta.id, userId, dec.ignorar)
        return NextResponse.json({ ok: true, ignorado: dec.ignorar })
      }
      case 'frenar': {
        const config = await leerConfigDelAgente(cuenta.id)
        if (!config || (config.estado !== 'ensayo' && config.estado !== 'activo')) return fail(409, 'El agente no está en marcha: no hay nada que frenar.')
        const { nombre } = await nombreDeCuenta(cuenta.id)
        const motivo = typeof body.motivo === 'string' ? body.motivo.trim().slice(0, 500) : ''
        await frenarAgente(cuenta.id, 'manual', motivo || 'Frenado a mano por un administrador.', nombre, 0)
        return NextResponse.json({ ok: true })
      }
      case 'topes': {
        const config = await guardarTopes(cuenta.id, body.topes, body.topeIaUsd, body.pujaMax, userId)
        return NextResponse.json({ ok: true, config })
      }
      case 'temporada': {
        const config = await guardarTemporada(cuenta.id, body.eventosManuales, body.picoEventos, userId)
        return NextResponse.json({ ok: true, config })
      }
      case 'producto': {
        const asin = typeof body.asin === 'string' ? body.asin.trim().toUpperCase() : ''
        if (!/^[A-Z0-9]{10}$/.test(asin)) return fail(400, 'Falta el ASIN del producto.')
        const cambios: { marca?: string | null; fase?: FaseDeProducto | null } = {}
        if (body.marca !== undefined) {
          if (body.marca !== null && typeof body.marca !== 'string') return fail(400, 'La marca tiene que ser un texto.')
          const marca = typeof body.marca === 'string' ? body.marca.trim().slice(0, 80) : ''
          cambios.marca = marca || null
        }
        if (body.fase !== undefined) {
          if (body.fase !== null && body.fase !== '' && !FASES.includes(body.fase as FaseDeProducto)) return fail(400, 'La fase tiene que ser «lanzamiento», «normal» o automática.')
          cambios.fase = body.fase === null || body.fase === '' ? null : (body.fase as FaseDeProducto)
        }
        if (cambios.marca === undefined && cambios.fase === undefined) return fail(400, 'No hay nada que cambiar en el producto.')
        await guardarProducto(cuenta.id, asin, cambios, userId)
        return NextResponse.json({ ok: true })
      }
      case 'parada-general': {
        if (typeof body.parar !== 'boolean') return fail(400, 'Di si paras el agente en todas las cuentas o lo dejas seguir.')
        await cambiarParadaGeneral(body.parar, typeof body.motivo === 'string' ? body.motivo : null, userId)
        return NextResponse.json({ ok: true, parado: body.parar })
      }
      default:
        return fail(400, 'Acción desconocida.')
    }
  } catch (error) {
    if (error instanceof Error && error.message === MENSAJE_PRIMER_ENSAYO) return fail(409, error.message)
    if (esFalta315(error)) return fail(409, FALTA_MIGRACION_315)
    return errorDeRuta(error, 'Ads: gobernar el agente')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { perfilId?: unknown; accion?: unknown; id?: unknown }
    const a = await abrirCuenta(body.perfilId)
    if (a instanceof NextResponse) return a
    const cuenta = { id: a.cuenta.id, conexionId: a.cuenta.conexionId, profileId: a.cuenta.profileId }

    switch (body.accion) {
      case 'deshacer': {
        // Quien lleva la cuenta puede deshacer un cambio del agente (como en Propuestas)
        const id = typeof body.id === 'string' && UUID.test(body.id) ? body.id : null
        if (!id) return fail(400, 'Falta el cambio que quieres deshacer.')
        await deshacerPropuesta(cuenta, id, a.sesion.userId)
        return NextResponse.json({ ok: true })
      }
      case 'pensar-ahora': {
        const prohibido = soloAdministradores(a.sesion, '«Pensar ahora»')
        if (prohibido) return prohibido
        const config = await leerConfigDelAgente(cuenta.id)
        if (!config || config.estado === 'apagado') return fail(409, 'El agente está apagado en esta cuenta.')
        if (config.estado === 'frenado') return fail(409, 'El agente está frenado: no piensa hasta que lo reanudes.')
        await pedirPensar(cuenta.id)
        return NextResponse.json({ ok: true, mensaje: 'Hecho: el agente pensará en la próxima pasada (en 5 minutos como mucho).' })
      }
      default:
        return fail(400, 'Acción desconocida.')
    }
  } catch (error) {
    if (esFalta315(error)) return fail(409, FALTA_MIGRACION_315)
    return errorDeRuta(error, 'Ads: acción del agente')
  }
}
