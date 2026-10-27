import { NextResponse, type NextRequest } from 'next/server'
import { fallo, requerirDireccion, respuestaDeFallo, SIN_CACHE, UUID } from '@/lib/crm/gemini/rutas'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * ASIGNAR UNA NOTA DE GEMINI A UN CLIENTE (O QUITARLE EL CLIENTE) — SOLO DIRECCIÓN.
 *
 * POST application/json  { clientId: string | null }
 *
 * Es lo que se hace cuando la sincronización no supo de quién era la reunión (`sin_cita`: ni el evento, ni el correo, ni el nombre coincidían con ninguna ficha) o cuando se
 * equivocó. La asignación manual (`metodo_cita = 'manual'`) no la vuelve a tocar la sincronización. Con `clientId: null` la nota queda otra vez sin cita.
 *
 * Si la nota ya tenía análisis, lo conserva (es de la reunión, no del cliente); si no, queda `pendiente` para que se analice.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const sesion = await requerirDireccion()
  if (sesion instanceof NextResponse) return sesion
  if (!UUID.test(params.id)) return fallo(400, 'Esa nota no existe.')

  let cuerpo: { clientId?: unknown }
  try {
    cuerpo = ((await request.json()) ?? {}) as { clientId?: unknown }
  } catch {
    return fallo(400, 'No se ha entendido lo que se ha mandado.')
  }
  const clientId = cuerpo.clientId === null ? null : typeof cuerpo.clientId === 'string' && UUID.test(cuerpo.clientId) ? cuerpo.clientId : undefined
  if (clientId === undefined) return fallo(400, 'Falta el cliente.')

  try {
    const db = createServiceClient()
    const { data: nota, error } = await db.from('crm_notas_reunion').select('id, estado, analisis').eq('id', params.id).maybeSingle()
    if (error) throw error
    if (!nota) return fallo(404, 'Esa nota no existe.')
    if (nota.estado === 'ignorada') return fallo(409, 'Es una reunión interna del equipo: no se guarda su contenido y no se puede asignar a un cliente.')

    if (clientId === null) {
      const { error: e } = await db.from('crm_notas_reunion').update({ client_id: null, appointment_id: null, metodo_cita: null, estado: 'sin_cita' }).eq('id', params.id)
      if (e) throw e
      return NextResponse.json({ ok: true, estado: 'sin_cita' }, { headers: SIN_CACHE })
    }

    const { data: cliente, error: e1 } = await db.from('crm_clients').select('id, appointment_id').eq('id', clientId).maybeSingle()
    if (e1) throw e1
    if (!cliente) return fallo(404, 'Ese cliente no existe.')

    const estado = nota.analisis ? 'procesada' : 'pendiente'
    const { error: e2 } = await db
      .from('crm_notas_reunion')
      .update({ client_id: cliente.id, appointment_id: cliente.appointment_id, metodo_cita: 'manual', estado, error: null, analisis_intentos: 0 })
      .eq('id', params.id)
    if (e2) throw e2
    return NextResponse.json({ ok: true, estado }, { headers: SIN_CACHE })
  } catch (error) {
    return respuestaDeFallo('asignar', error)
  }
}
