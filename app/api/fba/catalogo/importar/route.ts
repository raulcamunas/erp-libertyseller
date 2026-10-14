import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { requireFbaAccess } from '@/lib/fba/acceso'
import { importarHoja } from '@/lib/fba/catalogo/servidor'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * IMPORTAR LA HOJA DE REFERENCIAS.
 *
 * Recibe el TEXTO de la hoja —un CSV o las celdas pegadas— y no filas ya leídas: así
 * el servidor lee con el mismo código que la pantalla y el plan que se enseñó antes
 * de confirmar es el que se aplica, sin que nadie pueda colar filas distintas.
 *
 *   simular: true    lee y cruza con la base, y cuenta qué haría. No escribe nada.
 *   simular: false   aplica ese mismo plan.
 *
 * Suma y completa; no borra nada y una celda en blanco no vacía lo que ya hubiera
 * (ver lib/fba/catalogo/importar.ts).
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_CARACTERES = 2_000_000

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { clienteId?: unknown; texto?: unknown; simular?: unknown } | null
    const clienteId = typeof body?.clienteId === 'string' ? body.clienteId : ''
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')

    const sesion = await requireFbaAccess('editar', clienteId)
    if (sesion instanceof NextResponse) return sesion

    if (typeof body?.texto !== 'string' || body.texto.trim() === '') return fail(400, 'No hay nada que leer. Sube el archivo o pega las celdas.')
    if (body.texto.length > MAX_CARACTERES) return fail(400, 'El archivo es demasiado grande. Súbelo por partes.')
    const simular = body.simular !== false

    const resumen = await importarHoja(createServiceClient(), clienteId, sesion.userId, body.texto, simular)

    if (!simular && resumen.sinMigrar) {
      return fail(503, 'Falta lanzar la migración 226 en Supabase (fba_catalogo). Hasta entonces no se puede importar.')
    }
    return NextResponse.json(resumen)
  } catch (error) {
    return errorResponse(error, 'No se ha podido importar la hoja')
  }
}
