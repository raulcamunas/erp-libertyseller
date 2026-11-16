import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { agenciaQueEdita, esAgencia, requireFbaAccess } from '@/lib/fba/acceso'
import { TEXTO_FALTA_291, cambiosConfigAlertas, etapasDeFila } from '@/lib/fba/ajustes-api'
import { leerAjustesVigentes, leerConfigAlertas, type ConfigAlertasLeida } from '@/lib/fba/ajustes-datos'
import { plazoValido } from '@/lib/fba/alertas'
import { FALTA_LA_MIGRACION_267 } from '@/lib/fba/alertas-mensajes'
import { diaEnEspana } from '@/lib/fba/fechas'
import type { PlazoEtapas } from '@/lib/fba/plan-tipos'
import { faltaLaTabla } from '@/lib/fba/planificacion'
import type { EtapasDePlazo } from '@/lib/fba/plazos'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * EL PLAZO DE REPOSICIÓN DE UN CLIENTE, A MANO.
 *
 *   PUT  { clienteId, etapas?, plazoDias?, antelacionDias?, avisar?, plazosSku?, confirmarPlazos? }
 *
 * `plazoDias` son los días desde que se pide la mercancía hasta que está a la venta en Amazon (producción + transporte + recepción): el
 * número del que depende cada aviso de «reponer». `plazosSku` es un mapa referencia → días para las que tienen un plazo distinto; un
 * valor null (o vacío) quita el plazo propio y esa referencia vuelve al del cliente.
 *
 * `etapas` ({ preparacion, transporte, recepcion, margen }, en días) desglosa el plazo (migración 291). Si llegan, `plazoDias` se IGNORA: el
 * plazo es su suma. Si llega solo `plazoDias` y no coincide con la suma de las etapas que había, esas etapas se borran (el total se ha puesto
 * a mano y el desglose ya no dice la verdad).
 *
 * CAMBIOS (spec remesas-pro §9 y §11 D10, paquete S6):
 *   · El PUT es PARCIAL: lee la fila previa y solo escribe las claves que llegan. Antes, si faltaban, forzaba antelación 14 y avisar sí.
 *     Un cliente SIN fila que solo cambia la antelación o el aviso se rechaza (400): insertar la fila guardaría los 45 días por defecto de
 *     la columna como si fueran un plazo puesto a mano, y el planificador dejaría de usar el medido.
 *   · `confirmarPlazos: true` («Confirmar plazos» de la banda y de Ajustes) guarda como MANUALES las etapas vigentes (`plazoDelCliente`:
 *     manuales, medidas o de partida). La banda «plazo de partida» sale mientras nadie las haya confirmado. Si llegan `etapas`, mandan ellas.
 *   · Permisos: la agencia con permiso de editar ese cliente (`agenciaQueEdita`: admin, o empleado con la casilla `remesas` o con
 *     fba_accesos de edición). El cliente de fuera, 403 como siempre.
 *   · El cliente se puede decir como `clienteId` (lo de siempre) o como `cliente`.
 *
 *   GET  ?clienteId=… (o ?cliente=…)   lo de siempre para PlazosDialog y el panel de Alertas:
 *        { configurado, plazoDias, antelacionDias, avisar, etapas | null, sinMigrar291 }
 *        y además, para la pantalla nueva: { plazo: PlazoEtapas, medidas: MedidasCliente, confirmado }
 *        (`confirmado` = ninguna etapa del plazo vigente es de partida).
 *
 * Solo la agencia: un cliente de fuera no cambia sus propios plazos, y por tanto tampoco los avisos que recibe el equipo.
 */
export const dynamic = 'force-dynamic'

const MAX_SKU = 400
const NO_CLIENTE = 'Los plazos de reposición los pone la agencia'

const clienteDe = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

export async function GET(request: NextRequest) {
  try {
    const p = request.nextUrl.searchParams
    const clienteId = clienteDe(p.get('clienteId') ?? p.get('cliente'))
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')
    const sesion = await requireFbaAccess('ver', clienteId)
    if (sesion instanceof NextResponse) return sesion
    if (!esAgencia(sesion)) return fail(403, NO_CLIENTE)

    const vigentes = await leerAjustesVigentes(createServiceClient(), clienteId, diaEnEspana())
    const { fila, sinMigrar291, falta267 } = vigentes.config
    if (falta267) return fail(409, FALTA_LA_MIGRACION_267)

    return NextResponse.json({
      ok: true,
      configurado: fila !== null,
      plazoDias: fila?.plazo_reposicion_dias ?? 45,
      antelacionDias: fila?.antelacion_dias ?? 14,
      avisar: fila?.avisar !== false,
      etapas: etapasDeFila(fila),
      sinMigrar291,
      plazo: vigentes.plazo,
      medidas: vigentes.medidas,
      confirmado: !vigentes.plazo.sinConfirmar,
    })
  } catch (error) {
    return errorResponse(error, 'No se han podido leer los plazos')
  }
}

export async function PUT(request: NextRequest) {
  try {
    const cuerpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) return fail(400, 'Falta el cuerpo de la petición')
    const clienteId = clienteDe(cuerpo.clienteId ?? cuerpo.cliente)
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')

    const sesion = await requireFbaAccess('editar', clienteId)
    if (sesion instanceof NextResponse) return sesion
    if (!esAgencia(sesion)) return fail(403, NO_CLIENTE)
    if (!agenciaQueEdita(sesion, clienteId)) return fail(403, 'Tu acceso a esta cuenta es solo de lectura')

    const service = createServiceClient()

    // La fila previa (el PUT es parcial) y, si se confirman sin etapas, el plazo vigente (medido o de partida)
    const confirmar = cuerpo.confirmarPlazos === true && (cuerpo.etapas === undefined || cuerpo.etapas === null)
    let leida: ConfigAlertasLeida
    let plazoVigente: PlazoEtapas | null = null
    let vigentes: EtapasDePlazo | null = null
    if (confirmar) {
      const v = await leerAjustesVigentes(service, clienteId, diaEnEspana())
      leida = v.config
      plazoVigente = v.plazo
      vigentes = { preparacion: v.plazo.preparacion, transporte: v.plazo.transporte, recepcion: v.plazo.recepcion, margen: v.plazo.margen }
    } else {
      leida = await leerConfigAlertas(service, clienteId)
    }
    if (leida.falta267) return fail(409, FALTA_LA_MIGRACION_267)

    const r = cambiosConfigAlertas(cuerpo, leida.fila, { vigentes, sinMigrar291: leida.sinMigrar291 })
    if (!r.ok) return fail(r.status, r.error)

    if (r.cambios) {
      const fila = { client_id: clienteId, ...r.cambios, actualizado_at: new Date().toISOString(), actualizado_por: sesion.userId }
      const { error } = await service.from('fba_alertas_config').upsert(fila, { onConflict: 'client_id' })
      if (error) {
        if ('dias_preparacion' in r.cambios && faltaLaTabla(error)) return fail(409, TEXTO_FALTA_291)
        if (faltaLaTabla(error)) return fail(409, FALTA_LA_MIGRACION_267)
        throw error
      }
    }

    let skusTocados = 0
    if (cuerpo.plazosSku && typeof cuerpo.plazosSku === 'object' && !Array.isArray(cuerpo.plazosSku)) {
      const entradas = Object.entries(cuerpo.plazosSku as Record<string, unknown>).slice(0, MAX_SKU)
      const ahora = new Date().toISOString()
      const poner: Array<{ client_id: string; sku: string; plazo_reposicion_dias: number; actualizado_at: string }> = []
      const quitar: string[] = []
      for (const [sku, valor] of entradas) {
        const limpio = sku.trim()
        if (limpio === '' || limpio.length > 120) continue
        const p = valor === null || valor === '' ? null : plazoValido(valor)
        if (p === null) quitar.push(limpio)
        else poner.push({ client_id: clienteId, sku: limpio, plazo_reposicion_dias: p, actualizado_at: ahora })
      }
      if (poner.length > 0) {
        const { error: e } = await service.from('fba_alertas_plazo_sku').upsert(poner, { onConflict: 'client_id,sku' })
        if (e) {
          if (faltaLaTabla(e)) return fail(409, FALTA_LA_MIGRACION_267)
          throw e
        }
      }
      if (quitar.length > 0) {
        const { error: e } = await service.from('fba_alertas_plazo_sku').delete().eq('client_id', clienteId).in('sku', quitar)
        if (e) {
          if (faltaLaTabla(e)) return fail(409, FALTA_LA_MIGRACION_267)
          throw e
        }
      }
      skusTocados = poner.length + quitar.length
    }

    if (!r.cambios && skusTocados === 0) return fail(400, 'No llega nada que guardar')

    // Con «Confirmar plazos», el plazo tal como queda: las cuatro etapas manuales (la banda «de partida» se apaga)
    const plazo: PlazoEtapas | null =
      plazoVigente && r.confirmadas
        ? { ...plazoVigente, origen: { preparacion: 'manual', transporte: 'manual', recepcion: 'manual', margen: 'manual' }, sinConfirmar: false }
        : null
    return NextResponse.json({ ok: true, confirmadas: r.confirmadas, plazo })
  } catch (error) {
    return errorResponse(error, 'No se han podido guardar los plazos')
  }
}
