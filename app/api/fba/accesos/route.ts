import { NextResponse, type NextRequest } from 'next/server'
import { UUID, errorResponse, fail, requireAmazonAdmin } from '@/lib/amazon/api'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * A QUÉ CUENTAS PUEDE ENTRAR UN USUARIO EN REMESAS A FBA.
 *
 * Solo admin. Es dar acceso a datos de un cliente a una persona concreta, y
 * eso no lo delega la agencia en nadie.
 *
 * PUT SUSTITUYE la lista entera del usuario: se borra lo que tenía y se escribe
 * lo nuevo. Es más simple de razonar que un alta/baja fila a fila, y la pantalla
 * manda siempre el estado completo de las casillas.
 */
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const usuario = request.nextUrl.searchParams.get('usuario') ?? ''
    if (!UUID.test(usuario)) return fail(400, 'Hay que decir de qué usuario')

    const service = createServiceClient()
    const { data, error } = await service
      .from('fba_accesos')
      .select('client_id, puede_editar')
      .eq('user_id', usuario)
    if (error) throw error

    return NextResponse.json({
      accesos: ((data ?? []) as Array<{ client_id: string; puede_editar: boolean }>).map((a) => ({
        clientId: a.client_id,
        puedeEditar: a.puede_editar,
      })),
    })
  } catch (error) {
    return errorResponse(error, 'No se han podido leer los accesos')
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await requireAmazonAdmin()
    if (session instanceof NextResponse) return session

    const body = (await request.json().catch(() => ({}))) as {
      usuario?: unknown
      accesos?: unknown
    }
    const usuario = typeof body.usuario === 'string' ? body.usuario : ''
    if (!UUID.test(usuario)) return fail(400, 'Hay que decir de qué usuario')
    if (!Array.isArray(body.accesos)) return fail(400, 'Falta la lista de accesos')

    const vistos = new Set<string>()
    const filas: Array<{ user_id: string; client_id: string; puede_editar: boolean; created_by: string }> = []
    for (const a of body.accesos as Array<{ clientId?: unknown; puedeEditar?: unknown }>) {
      const clientId = typeof a.clientId === 'string' ? a.clientId : ''
      if (!UUID.test(clientId) || vistos.has(clientId)) continue
      vistos.add(clientId)
      filas.push({
        user_id: usuario,
        client_id: clientId,
        puede_editar: a.puedeEditar === true,
        created_by: session.userId,
      })
    }

    const service = createServiceClient()

    // Solo se admiten clientes que existan: un id inventado no se guarda.
    if (filas.length > 0) {
      const { data: existentes } = await service
        .from('amazon_clients')
        .select('id')
        .in('id', filas.map((f) => f.client_id))
      const ok = new Set(((existentes ?? []) as Array<{ id: string }>).map((c) => c.id))
      const desconocidos = filas.filter((f) => !ok.has(f.client_id))
      if (desconocidos.length > 0) return fail(400, 'Alguno de los clientes no existe')
    }

    const { error: errBorrar } = await service.from('fba_accesos').delete().eq('user_id', usuario)
    if (errBorrar) throw errBorrar

    if (filas.length > 0) {
      const { error: errAlta } = await service.from('fba_accesos').insert(filas)
      if (errAlta) throw errAlta
    }

    return NextResponse.json({ ok: true, accesos: filas.length })
  } catch (error) {
    return errorResponse(error, 'No se han podido guardar los accesos')
  }
}
