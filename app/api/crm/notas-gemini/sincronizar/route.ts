import { NextResponse } from 'next/server'
import { motivoParaSaltar, pasadaDeNotas } from '@/lib/crm/gemini/servidor'
import { requerirDireccion, respuestaDeFallo, SIN_CACHE } from '@/lib/crm/gemini/rutas'
import { conRegistro } from '@/lib/sistema/cron'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * «SINCRONIZAR AHORA» DEL CRM — SOLO DIRECCIÓN.
 *
 * POST sin cuerpo. Hace una pasada entera (la misma del cron: lib/crm/gemini/sincronizar.ts) y contesta con lo que ha pasado, incluido por qué se ha parado si falta algo en Google.
 * Queda registrada en Sistema con el usuario que la ha lanzado.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST() {
  const sesion = await requerirDireccion()
  if (sesion instanceof NextResponse) return sesion

  try {
    const db = createServiceClient()
    const motivo = await motivoParaSaltar(db)
    if (motivo) return NextResponse.json({ ok: false, error: motivo }, { status: 409, headers: SIN_CACHE })

    const pasada = await conRegistro('notas-gemini', sesion.userId, () => pasadaDeNotas(db))
    const { resultado, resumen } = pasada
    return NextResponse.json({ ok: !resultado.detenida, resumen, ...resultado, costeUsd: Math.round(resultado.costeUsd * 10_000) / 10_000 }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFallo('sincronizar', error)
  }
}
