import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { requireFbaAccess } from '@/lib/fba/acceso'
import { antelacionValida, plazoValido } from '@/lib/fba/alertas'
import { FALTA_LA_MIGRACION_267 } from '@/lib/fba/alertas-datos'
import { etapasValidas, totalDeEtapas, type EtapasDePlazo } from '@/lib/fba/plazos'
import { faltaLaTabla } from '@/lib/fba/planificacion'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * EL PLAZO DE REPOSICIÓN DE UN CLIENTE, A MANO.
 *
 *   PUT  { clienteId, plazoDias, antelacionDias?, avisar?, plazosSku? }
 *
 * `plazoDias` son los días desde que se pide la mercancía hasta que está a la venta en Amazon (producción + transporte + recepción): el
 * número del que depende cada aviso de «reponer» y que ningún dato de Amazon puede dar. `plazosSku` es un mapa referencia → días para las
 * que tienen un plazo distinto; un valor null (o vacío) quita el plazo propio y esa referencia vuelve al del cliente.
 *
 * `etapas` ({ preparacion, transporte, recepcion, margen }, en días) desglosa el plazo (migración 291): preparación del cliente desde que se le avisa, transporte, recepción en Amazon y
 * margen de error. Si llegan, `plazoDias` se IGNORA: el plazo es su suma, que es lo que guardan las alertas. Si llega solo `plazoDias` y no coincide con la suma de las etapas que había, esas
 * etapas se borran (el total se ha puesto a mano y el desglose ya no dice la verdad).
 *
 *   GET  ?clienteId=…   lo que hay guardado, para el panel «Plazos» de Remesas: { configurado, plazoDias, antelacionDias, avisar, etapas | null, sinMigrar291 }
 *
 * Solo la agencia: un cliente de fuera no cambia sus propios plazos, y por tanto tampoco los avisos que recibe el equipo.
 */
export const dynamic = 'force-dynamic'

const MAX_SKU = 400

const CON_ETAPAS = 'plazo_reposicion_dias, antelacion_dias, avisar, dias_preparacion, dias_transporte, dias_recepcion, margen_dias'
const SIN_ETAPAS = 'plazo_reposicion_dias, antelacion_dias, avisar'

interface FilaConfig {
  plazo_reposicion_dias: number
  antelacion_dias: number
  avisar: boolean
  dias_preparacion?: number | null
  dias_transporte?: number | null
  dias_recepcion?: number | null
  margen_dias?: number | null
}

const etapasDe = (f: FilaConfig | null): EtapasDePlazo | null =>
  f && f.dias_preparacion != null && f.dias_transporte != null && f.dias_recepcion != null && f.margen_dias != null
    ? { preparacion: f.dias_preparacion, transporte: f.dias_transporte, recepcion: f.dias_recepcion, margen: f.margen_dias }
    : null

export async function GET(request: NextRequest) {
  try {
    const clienteId = request.nextUrl.searchParams.get('clienteId') ?? ''
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')
    const sesion = await requireFbaAccess('ver', clienteId)
    if (sesion instanceof NextResponse) return sesion
    if (sesion.role === 'cliente') return fail(403, 'Los plazos de reposición los pone la agencia')

    const service = createServiceClient()
    let sinMigrar291 = false
    let r = await service.from('fba_alertas_config').select(CON_ETAPAS).eq('client_id', clienteId).maybeSingle()
    if (r.error && faltaLaTabla(r.error)) {
      sinMigrar291 = true
      r = (await service.from('fba_alertas_config').select(SIN_ETAPAS).eq('client_id', clienteId).maybeSingle()) as typeof r
    }
    if (r.error) {
      if (faltaLaTabla(r.error)) return fail(409, FALTA_LA_MIGRACION_267)
      throw r.error
    }
    const fila = (r.data as unknown as FilaConfig | null) ?? null
    return NextResponse.json({
      ok: true,
      configurado: fila !== null,
      plazoDias: fila?.plazo_reposicion_dias ?? 45,
      antelacionDias: fila?.antelacion_dias ?? 14,
      avisar: fila?.avisar !== false,
      etapas: etapasDe(fila),
      sinMigrar291,
    })
  } catch (error) {
    return errorResponse(error, 'No se han podido leer los plazos')
  }
}

export async function PUT(request: NextRequest) {
  try {
    const cuerpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!cuerpo) return fail(400, 'Falta el cuerpo de la petición')
    const clienteId = typeof cuerpo.clienteId === 'string' ? cuerpo.clienteId : ''
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')

    const sesion = await requireFbaAccess('editar', clienteId)
    if (sesion instanceof NextResponse) return sesion
    if (sesion.role === 'cliente') return fail(403, 'Los plazos de reposición los pone la agencia')

    // Con etapas, el plazo es su suma; sin ellas, el número que llegue
    const conEtapas = cuerpo.etapas !== undefined
    const etapas = conEtapas ? etapasValidas(cuerpo.etapas) : null
    if (conEtapas && etapas === null) return fail(400, 'Cada etapa tiene que ser un número de días entre 0 y 365, y el total, de 1 a 365')
    const plazo = etapas ? totalDeEtapas(etapas) : plazoValido(cuerpo.plazoDias)
    if (plazo === null) return fail(400, 'El plazo de reposición tiene que ser un número de días, entre 1 y 365')
    const antelacion = cuerpo.antelacionDias === undefined ? 14 : antelacionValida(cuerpo.antelacionDias)
    if (antelacion === null) return fail(400, 'La antelación tiene que ser un número de días, entre 0 y 120')
    const avisar = cuerpo.avisar === undefined ? true : cuerpo.avisar === true

    const service = createServiceClient()
    const fila: Record<string, unknown> = { client_id: clienteId, plazo_reposicion_dias: plazo, antelacion_dias: antelacion, avisar, actualizado_at: new Date().toISOString(), actualizado_por: sesion.userId }
    if (etapas) {
      Object.assign(fila, { dias_preparacion: etapas.preparacion, dias_transporte: etapas.transporte, dias_recepcion: etapas.recepcion, margen_dias: etapas.margen })
    } else {
      // Un total puesto a mano que ya no coincide con el desglose lo invalida. Sin la migración 291 no hay nada que mirar (el select falla y se sigue)
      const previo = await service.from('fba_alertas_config').select(CON_ETAPAS).eq('client_id', clienteId).maybeSingle()
      const anteriores = previo.error ? null : etapasDe((previo.data as unknown as FilaConfig | null) ?? null)
      if (anteriores && totalDeEtapas(anteriores) !== plazo) Object.assign(fila, { dias_preparacion: null, dias_transporte: null, dias_recepcion: null, margen_dias: null })
    }
    const { error } = await service.from('fba_alertas_config').upsert(fila, { onConflict: 'client_id' })
    if (error) {
      if (etapas && faltaLaTabla(error)) return fail(409, 'Falta lanzar la migración 291 en Supabase para guardar el plazo por etapas.')
      if (faltaLaTabla(error)) return fail(409, FALTA_LA_MIGRACION_267)
      throw error
    }

    if (cuerpo.plazosSku && typeof cuerpo.plazosSku === 'object') {
      const entradas = Object.entries(cuerpo.plazosSku as Record<string, unknown>).slice(0, MAX_SKU)
      const poner: Array<{ client_id: string; sku: string; plazo_reposicion_dias: number; actualizado_at: string }> = []
      const quitar: string[] = []
      for (const [sku, valor] of entradas) {
        const limpio = sku.trim()
        if (limpio === '' || limpio.length > 120) continue
        const p = valor === null || valor === '' ? null : plazoValido(valor)
        if (p === null) quitar.push(limpio)
        else poner.push({ client_id: clienteId, sku: limpio, plazo_reposicion_dias: p, actualizado_at: new Date().toISOString() })
      }
      if (poner.length > 0) {
        const { error: e } = await service.from('fba_alertas_plazo_sku').upsert(poner, { onConflict: 'client_id,sku' })
        if (e) throw e
      }
      if (quitar.length > 0) {
        const { error: e } = await service.from('fba_alertas_plazo_sku').delete().eq('client_id', clienteId).in('sku', quitar)
        if (e) throw e
      }
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error, 'No se han podido guardar los plazos')
  }
}
