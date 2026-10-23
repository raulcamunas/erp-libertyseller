import { NextResponse, type NextRequest } from 'next/server'
import { calcularResultados, DIAS_POR_DEFECTO } from '@/lib/correo/ia-laboratorio-resultados'
import { requerirConfigCorreos, respuestaDeFalloDeConfiguracion } from '@/lib/correo/laboratorio-rutas'
import { SIN_CACHE } from '@/lib/correo/rutas'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LOS RESULTADOS DE CADA VERSIÓN: cuántos correos escribió que se enviaron, a cuántos contestó alguien, cuánto los cambió el comercial y
 * cuál va ganando (lib/correo/ia-laboratorio-resultados.ts). GET ?dias=45 (de 7 a 120). Solo cifras y los textos de los correos que
 * consiguieron respuesta, sin correos ni teléfonos: nunca lo que contestó el cliente.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  const sesion = await requerirConfigCorreos()
  if (sesion instanceof NextResponse) return sesion
  const pedidos = Number(new URL(request.url).searchParams.get('dias'))
  const dias = Number.isInteger(pedidos) && pedidos >= 7 && pedidos <= 120 ? pedidos : DIAS_POR_DEFECTO
  try {
    return NextResponse.json({ ok: true, ...(await calcularResultados(createServiceClient(), dias)) }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFalloDeConfiguracion('Correo · resultados de las versiones: fallo', error)
  }
}
