import { NextResponse, type NextRequest } from 'next/server'
import { almacenDeSupabase } from '@/lib/crm/gemini/almacen'
import { fallo, requerirDireccion, respuestaDeFallo, SIN_CACHE, UUID } from '@/lib/crm/gemini/rutas'
import { analizarNotaGuardada } from '@/lib/crm/gemini/sincronizar'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * «ANALIZAR / VOLVER A ANALIZAR» UNA NOTA DE GEMINI — SOLO DIRECCIÓN.
 *
 * POST sin cuerpo. Pasa la nota por la IA (lib/crm/gemini/analisis.ts) y guarda el desglose. Cuesta unos 0,08 $ con gpt-5.6-terra y tarda de 30 s a un par de minutos, así que la
 * pantalla lo lanza solo con un clic explícito. Si falla NO deja la nota en «error» ni cuenta un intento: dice lo que ha pasado y la nota queda como estaba.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 200

export async function POST(_request: NextRequest, { params }: { params: { id: string } }) {
  const sesion = await requerirDireccion()
  if (sesion instanceof NextResponse) return sesion
  if (!UUID.test(params.id)) return fallo(400, 'Esa nota no existe.')

  try {
    const db = createServiceClient()
    const { data: nota, error } = await db.from('crm_notas_reunion').select('id, estado, analisis_intentos').eq('id', params.id).maybeSingle()
    if (error) throw error
    if (!nota) return fallo(404, 'Esa nota no existe.')
    if (nota.estado === 'ignorada') return fallo(409, 'Es una reunión interna del equipo: no se guarda su contenido y no hay nada que analizar.')

    const resultado = await analizarNotaGuardada(almacenDeSupabase(db), nota, { manual: true, tiempoMaximoMs: 150_000 })
    return NextResponse.json({ ok: resultado.ok, aviso: resultado.aviso, costeUsd: Math.round(resultado.costeUsd * 10_000) / 10_000 }, { status: resultado.ok ? 200 : 502, headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFallo('analizar', error)
  }
}
