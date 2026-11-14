import { NextResponse } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { createServiceClient } from '@/lib/supabase/service'
import { requireFbaAccess, type SesionFba } from './acceso'
import { FalloDelEnvio } from './envio-amazon-motor'

/**
 * LA PUERTA DE LAS RUTAS DEL ENVÍO A AMAZON POR API.
 * SOLO SERVIDOR. Solo ADMINISTRADORES (decisión de Raúl): esto crea envíos reales y acepta cargos en la
 * cuenta del cliente. Un empleado o un cliente con acceso a Remesas sigue con el envío manual de siempre.
 */
export async function soloAdminConRemesa(id: string): Promise<{ sesion: SesionFba } | NextResponse> {
  if (!UUID.test(id)) return fail(400, 'Esa remesa no existe')
  const sesion = await requireFbaAccess('editar')
  if (sesion instanceof NextResponse) return sesion
  if (!sesion.esAdmin) return fail(403, 'El envío a Amazon desde el ERP solo lo usan los administradores')
  const { data } = await createServiceClient().from('fba_remesas').select('id').eq('id', id).maybeSingle()
  if (!data) return fail(404, 'Esa remesa ya no existe')
  return { sesion }
}

/** Los fallos del motor salen con su texto y su código; el resto, como en todo /api/fba */
export function respuestaDeFallo(error: unknown, contexto: string): NextResponse {
  if (error instanceof FalloDelEnvio) return fail(error.estadoHttp, error.message)
  return errorResponse(error, contexto)
}

export const SIN_CACHE = { 'Cache-Control': 'no-store' }
