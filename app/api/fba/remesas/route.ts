import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail } from '@/lib/amazon/api'
import { requireFbaAccess } from '@/lib/fba/acceso'
import { ErrorDeRemesa, crearRemesa, textoLimpio, validarRemesaNueva } from '@/lib/fba/crear-remesa'
import { invalidarCaches } from '@/lib/fba/envios-propuestos-servidor'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * DAR DE ALTA UNA REMESA: LO QUE MANDAMOS A LOS ALMACENES DE AMAZON.
 *
 * La cabecera y sus líneas se escriben JUNTAS. Si las líneas fallan, la remesa
 * se borra: media remesa —una cabecera sin referencias— aparece en el panel como
 * un envío de cero unidades y se lee como un envío que no vendió nada, que es
 * justo lo contrario de lo que pasa.
 *
 * Supabase no da transacciones desde el cliente REST, así que el rescate es
 * manual y explícito. Es feo y es correcto.
 *
 * La lógica del alta vive en lib/fba/crear-remesa.ts: la usa también «Convertir en remesa» de un envío
 * propuesto (POST /api/fba/envios-propuestos/[id]/convertir).
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  try {
    const clienteId = request.nextUrl.searchParams.get('cliente') ?? ''
    if (!UUID.test(clienteId)) return fail(400, 'Hay que decir de qué cliente')

    const session = await requireFbaAccess('ver', clienteId)
    if (session instanceof NextResponse) return session

    const service = createServiceClient()
    const { data, error } = await service
      .from('fba_remesas')
      .select('id, nombre, fecha_envio, llegada_at, referencia_envio, nota, created_at')
      .eq('client_id', clienteId)
      .order('fecha_envio', { ascending: false })
    if (error) throw error

    return NextResponse.json({ remesas: data ?? [] })
  } catch (error) {
    return errorResponse(error, 'No se han podido leer las remesas')
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      clienteId?: unknown
      marketplaceId?: unknown
      nombre?: unknown
      fechaEnvio?: unknown
      referenciaEnvio?: unknown
      nota?: unknown
      lineas?: unknown
      /** El análisis de la IA, si la propuesta nace de ella. Lo reconstruye limpiarAnalisis */
      analisisIa?: unknown
    }

    const clienteId = textoLimpio(body.clienteId, 40) ?? ''
    if (!UUID.test(clienteId)) return fail(400, 'Elige el cliente de la remesa')

    // Crear exige poder EDITAR ese cliente. Un acceso de solo lectura se para aquí.
    const session = await requireFbaAccess('editar', clienteId)
    if (session instanceof NextResponse) return session

    // Se valida TODO antes de escribir nada: media remesa es peor que ninguna (lib/fba/crear-remesa.ts)
    const validada = validarRemesaNueva(body, clienteId)
    if (!validada.ok) return fail(validada.estado, validada.error)

    // El análisis de la IA lo guarda la agencia que edita este cliente, no solo el admin (D21)
    const creada = await crearRemesa(createServiceClient(), session, validada.datos)
    // Una propuesta nueva es comprometido para el plan y cambia el resumen: fuera las cachés en memoria (D32)
    invalidarCaches(clienteId)

    return NextResponse.json({ id: creada.id, lineas: creada.lineas, analisisGuardado: creada.analisisGuardado })
  } catch (error) {
    if (error instanceof ErrorDeRemesa) return fail(error.estado, error.message)
    return errorResponse(error, 'No se ha podido crear la remesa')
  }
}
