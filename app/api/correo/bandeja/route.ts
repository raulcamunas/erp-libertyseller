import { NextResponse, type NextRequest } from 'next/server'
import { fail } from '@/lib/amazon/api'
import { leerQueryDeBandeja } from '@/lib/correo/bandeja'
import { cuerpoDeFalta318 } from '@/lib/correo/preferencias-servidor'
import { SIN_CACHE, requerirCorreo, respuestaDeFallo } from '@/lib/correo/rutas'
import { listarBandeja } from '@/lib/correo/servidor'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LA BANDEJA UNIFICADA: «MIS CORREOS» Y «ASIGNADOS A MÍ».
 *
 * GET ?vista=todos|recibidos|enviados|destacados|pendientes&sinLeer=0|1&q=<texto>&antes=<fecha>&antesId=<id>&limite=<n>&carpeta=mios|asignados&silenciados=0|1
 *  →  { hilos: HiloDeLista[], siguiente: { antes, antesId } | null }
 *
 *   · carpeta=mios (por defecto): los hilos de los buzones de «Mis correos» que quien pide PUEDE LEER, mezclados por fecha. Cursor estable
 *     (antes, antesId) aunque dos hilos tengan la misma fecha. Con búsqueda, sin cursor.
 *   · carpeta=asignados: las conversaciones encargadas a quien pide y sin hacer, solo de buzones que aún puede leer. Sin cursor.
 *   · silenciados=1 (por defecto): lo silenciado SALE, atenuado en la pantalla. silenciados=0 (el chip «Ocultar silenciados») lo quita.
 *
 * Toda la regla vive en listarBandeja (servidor.ts): decidirAcceso por buzón y una fila en correo_accesos por cada buzón ajeno que sale en la
 * página (si no se puede dejar, no se enseña nada). Esta ruta no sincroniza nada: el proceso automático lee cada minuto.
 *
 * Sin la migración 318 contesta 503 con { error: FALTA_MIGRACION_318, codigo: 'FALTA_MIGRACION_318' }, y la pantalla cae a la vista por buzón.
 * Solo ese código la hace caer: un 503 de paso (el reinicio tras desplegar) es un error normal que se cura en el siguiente refresco.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(request: NextRequest) {
  const sesion = await requerirCorreo()
  if (sesion instanceof NextResponse) return sesion

  const leida = leerQueryDeBandeja(request.nextUrl.searchParams)
  if (!leida.ok) return fail(400, leida.error)

  try {
    const resultado = await listarBandeja(createServiceClient(), sesion, leida.consulta)
    if (resultado.tipo === 'falta_318') return NextResponse.json(cuerpoDeFalta318(), { status: 503, headers: SIN_CACHE })
    return NextResponse.json({ hilos: resultado.hilos, siguiente: resultado.siguiente }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFallo('Correo · bandeja: fallo', error)
  }
}
