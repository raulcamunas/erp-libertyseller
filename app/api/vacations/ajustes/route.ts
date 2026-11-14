import { NextRequest, NextResponse } from 'next/server'
import { errorResponse, fail, requireAdmin, UUID } from '@/lib/vacations/api'
import { esColorValido, leerLugar } from '@/lib/vacations/calendario'
import { faltaEsquema } from '@/lib/vacations/servidor'

/**
 * AJUSTES DE VACACIONES. SOLO ADMIN. POST
 * =======================================
 *   { maxALaVez: 1..50 }                                   cuántas personas pueden estar fuera a la vez en la empresa
 *   { ficha: { id, color: '#rrggbb' | null, lugar: { ccaa, ine? } | null } }
 *                                                          el color de una persona en el calendario y dónde vive para
 *                                                          sus festivos (null = solo fines de semana)
 *
 * Todo esto lo crea la migración 308; sin ella contesta 409 diciéndolo. NO toca ninguna regla de saldo: días por mes,
 * arrastre y preaviso siguen en la ficha de Control empleados como siempre.
 */

export const dynamic = 'force-dynamic'

const SIN_308 = 'Esto necesita la migración 308 (vacaciones_calendario) lanzada en Supabase'

export async function POST(request: NextRequest) {
  try {
    const session = await requireAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return fail(400, 'No se ha recibido nada que guardar')

    if (body.maxALaVez !== undefined) {
      const n = Number(body.maxALaVez)
      if (!Number.isInteger(n) || n < 1 || n > 50) return fail(400, 'El máximo a la vez tiene que ser un número entero entre 1 y 50')
      const { error } = await session.service
        .from('vacation_settings')
        .upsert({ id: true, max_a_la_vez: n, updated_at: new Date().toISOString(), updated_by: session.userId }, { onConflict: 'id' })
      if (error && faltaEsquema(error)) return fail(409, SIN_308)
      if (error) throw error
      return NextResponse.json({ ok: true, message: n === 1 ? 'Ahora no pueden irse dos a la vez' : `Ahora pueden estar fuera ${n} a la vez` })
    }

    if (body.ficha && typeof body.ficha === 'object') {
      const f = body.ficha as Record<string, unknown>
      if (typeof f.id !== 'string' || !UUID.test(f.id)) return fail(400, 'Esa ficha no es válida')
      const cambios: Record<string, unknown> = {}
      if ('color' in f) {
        if (f.color !== null && !esColorValido(f.color)) return fail(400, 'El color tiene que ser #rrggbb')
        cambios.vacation_color = f.color
      }
      if ('lugar' in f) {
        if (f.lugar === null) cambios.festivos_lugar = null
        else {
          const lugar = leerLugar(f.lugar)
          if (!lugar) return fail(400, 'Esa comunidad autónoma no existe')
          cambios.festivos_lugar = lugar.ine ? { ccaa: lugar.ccaa, ine: lugar.ine } : { ccaa: lugar.ccaa }
        }
      }
      if (Object.keys(cambios).length === 0) return fail(400, 'No hay nada que cambiar')
      const { data, error } = await session.service.from('employees').update(cambios).eq('id', f.id).select('id')
      if (error && faltaEsquema(error)) return fail(409, SIN_308)
      if (error) throw error
      if (!data || data.length === 0) return fail(404, 'Esa persona ya no está en el control de empleados')
      return NextResponse.json({ ok: true, message: 'Guardado' })
    }

    return fail(400, 'No hay nada que guardar')
  } catch (error) {
    return errorResponse(error, 'Error guardando los ajustes de vacaciones')
  }
}
