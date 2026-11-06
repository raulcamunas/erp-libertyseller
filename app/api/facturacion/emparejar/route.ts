import { NextResponse, type NextRequest } from 'next/server'
import { exigirAdmin } from '@/lib/facturacion/acceso'
import { registrar } from '@/lib/facturacion/registro'
import { createServiceClient } from '@/lib/supabase/service'
import { errorComoRespuesta, zoho } from '@/lib/zoho/books'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * QUÉ CONTACTO DE ZOHO ES CADA CLIENTE DE TESORERÍA.
 *
 * O uno que ya existe (`contactoId`), o uno nuevo en euros (`crear`). Sin pareja
 * no se puede crear la factura.
 */
export async function POST(request: NextRequest) {
  const permiso = await exigirAdmin()
  if (!permiso.ok) return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })

  const cuerpo = (await request.json().catch(() => ({}))) as {
    treasuryClientId?: string
    contactoId?: string | null
    crear?: { nombre?: string; email?: string } | null
  }
  if (!cuerpo.treasuryClientId) return NextResponse.json({ error: 'Falta el cliente' }, { status: 400 })

  try {
    let contactoId = cuerpo.contactoId ?? null
    let nombre: string | null = null

    if (cuerpo.crear) {
      nombre = cuerpo.crear.nombre?.trim() || null
      const email = cuerpo.crear.email?.trim()
      if (!nombre) return NextResponse.json({ error: 'Falta el nombre del cliente' }, { status: 400 })
      const { currencies } = await zoho<{ currencies?: { currency_id: string; currency_code: string }[] }>('settings/currencies')
      const euro = currencies?.find((c) => c.currency_code === 'EUR')
      const r = await zoho<{ contact?: { contact_id: string } }>('contacts', {
        metodo: 'POST',
        cuerpo: {
          contact_name: nombre,
          contact_type: 'customer',
          ...(euro ? { currency_id: euro.currency_id } : {}),
          ...(email ? { contact_persons: [{ first_name: nombre, email, is_primary_contact: true }] } : {}),
        },
      })
      contactoId = r.contact?.contact_id ?? null
      if (!contactoId) return NextResponse.json({ error: 'Zoho no ha devuelto el cliente nuevo' }, { status: 502 })
    }

    const { error } = await createServiceClient()
      .from('treasury_clients')
      .update({ zoho_contact_id: contactoId })
      .eq('id', cuerpo.treasuryClientId)
    if (error) {
      return NextResponse.json({ error: `No se ha podido guardar la pareja: ${error.message}` }, { status: 500 })
    }

    await registrar(permiso, {
      tipo: 'contacto',
      zohoId: contactoId,
      cliente: nombre,
      treasuryClientId: cuerpo.treasuryClientId,
      detalle: { creado: Boolean(cuerpo.crear) },
    })
    return NextResponse.json({ ok: true, contactoId })
  } catch (error) {
    const { mensaje, estado } = errorComoRespuesta(error)
    return NextResponse.json({ error: mensaje }, { status: estado })
  }
}
