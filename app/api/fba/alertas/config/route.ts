import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { requireFbaAccess } from '@/lib/fba/acceso'
import { antelacionValida, plazoValido } from '@/lib/fba/alertas'
import { FALTA_LA_MIGRACION_267 } from '@/lib/fba/alertas-datos'
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
 * Solo la agencia: un cliente de fuera no cambia sus propios plazos, y por tanto tampoco los avisos que recibe el equipo.
 */
export const dynamic = 'force-dynamic'

const MAX_SKU = 400

export async function PUT(request: NextRequest) {
  try {
    const cuerpo = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!cuerpo) return fail(400, 'Falta el cuerpo de la petición')
    const clienteId = typeof cuerpo.clienteId === 'string' ? cuerpo.clienteId : ''
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')

    const sesion = await requireFbaAccess('editar', clienteId)
    if (sesion instanceof NextResponse) return sesion
    if (sesion.role === 'cliente') return fail(403, 'Los plazos de reposición los pone la agencia')

    const plazo = plazoValido(cuerpo.plazoDias)
    if (plazo === null) return fail(400, 'El plazo de reposición tiene que ser un número de días, entre 1 y 365')
    const antelacion = cuerpo.antelacionDias === undefined ? 14 : antelacionValida(cuerpo.antelacionDias)
    if (antelacion === null) return fail(400, 'La antelación tiene que ser un número de días, entre 0 y 120')
    const avisar = cuerpo.avisar === undefined ? true : cuerpo.avisar === true

    const service = createServiceClient()
    const { error } = await service.from('fba_alertas_config').upsert(
      { client_id: clienteId, plazo_reposicion_dias: plazo, antelacion_dias: antelacion, avisar, actualizado_at: new Date().toISOString(), actualizado_por: sesion.userId },
      { onConflict: 'client_id' }
    )
    if (error) {
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
