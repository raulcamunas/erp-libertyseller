import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { exigirAdmin } from '@/lib/facturacion/acceso'
import { cargarEmisor } from '@/lib/facturacion/tablero'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Los datos fiscales de la agencia: los mismos en todas las facturas */
export async function GET() {
  const permiso = await exigirAdmin()
  if (!permiso.ok) {
    return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })
  }
  return NextResponse.json({ ok: true, emisor: await cargarEmisor() })
}

const CAMPOS = [
  'legal_name',
  'tax_id',
  'address',
  'email',
  'phone',
  'bank_name',
  'iban',
  'bic',
  'invoice_prefix',
  'footer_note',
] as const

export async function PUT(request: NextRequest) {
  const permiso = await exigirAdmin()
  if (!permiso.ok) {
    return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })
  }

  const cuerpo = (await request.json().catch(() => ({}))) as Record<string, unknown>

  // Solo se copian los campos conocidos: lo que venga de más no entra en el
  // update, así una petición manipulada no puede tocar otras columnas.
  const patch: Record<string, unknown> = {}
  for (const campo of CAMPOS) {
    if (campo in cuerpo) {
      const valor = cuerpo[campo]
      patch[campo] = typeof valor === 'string' ? valor.trim() : valor
    }
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'No hay nada que guardar' }, { status: 400 })
  }
  patch.updated_at = new Date().toISOString()

  const service = createServiceClient()
  const { error } = await service.from('billing_issuer').update(patch).eq('id', true)

  if (error) {
    return NextResponse.json(
      {
        error:
          error.code === '42P01'
            ? 'Falta lanzar la migración 176: la tabla de datos fiscales no existe todavía.'
            : error.message,
      },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true, emisor: await cargarEmisor() })
}
