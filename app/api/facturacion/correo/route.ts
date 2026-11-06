import { NextResponse, type NextRequest } from 'next/server'
import { exigirAdmin } from '@/lib/facturacion/acceso'
import { plantillaPropuesta } from '@/lib/facturacion/logica'
import type { CorreoPreparado, PlantillaResumen } from '@/lib/facturacion/tipos'
import { createServiceClient } from '@/lib/supabase/service'
import { errorComoRespuesta, zoho } from '@/lib/zoho/books'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type DatosCorreo = {
  subject?: string
  body?: string
  to_contacts?: { first_name?: string; last_name?: string; email?: string; selected?: boolean }[]
  cc_mails_list?: { email?: string }[]
  emailtemplates?: { email_template_id: string; name: string; selected?: boolean }[]
}

/**
 * EL CORREO DE UNA FACTURA, TAL COMO LO MONTA ZOHO CON LA PLANTILLA ELEGIDA.
 *
 * Sin plantilla pedida se propone una: la última que se usó con ese cliente o,
 * si no, la que le pega. Los huecos ENLACE_* llegan tal cual; se rellenan en
 * pantalla y al enviar.
 */
export async function GET(request: NextRequest) {
  const permiso = await exigirAdmin()
  if (!permiso.ok) return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })

  const p = request.nextUrl.searchParams
  const id = p.get('id')
  if (!id) return NextResponse.json({ error: 'Falta la factura' }, { status: 400 })
  const pedida = p.get('plantilla')
  const ruta = `invoices/${encodeURIComponent(id)}`

  try {
    const leer = (plantilla?: string | null) =>
      zoho<{ data: DatosCorreo }>(`${ruta}/email`, { query: { email_template_id: plantilla } }).then((r) => r.data)

    const [primero, { invoice }, { templates }] = await Promise.all([
      leer(pedida),
      zoho<{ invoice: { template_id?: string; status: string } }>(ruta),
      zoho<{ templates?: { template_id: string; template_name: string }[] }>('invoices/templates'),
    ])

    const plantillas: PlantillaResumen[] = (primero.emailtemplates ?? []).map((t) => ({ id: t.email_template_id, nombre: t.name }))
    let datos = primero
    let plantillaId = pedida ?? primero.emailtemplates?.find((t) => t.selected)?.email_template_id ?? ''

    if (!pedida) {
      let ultimaUsadaId: string | null = null
      const treasuryClientId = p.get('treasuryClientId')
      if (treasuryClientId) {
        const { data } = await createServiceClient()
          .from('facturacion_registro')
          .select('detalle')
          .eq('treasury_client_id', treasuryClientId)
          .eq('tipo', 'envio')
          .order('creado_en', { ascending: false })
          .limit(1)
        ultimaUsadaId = ((data ?? [])[0]?.detalle as { plantillaId?: string } | undefined)?.plantillaId ?? null
      }
      const propuesta = plantillaPropuesta(plantillas, {
        cliente: p.get('cliente') ?? '',
        tieneComision: p.get('comision') === '1',
        ultimaUsadaId,
      })
      if (propuesta && propuesta.id !== plantillaId) {
        plantillaId = propuesta.id
        datos = await leer(propuesta.id)
      }
    }

    const correo: CorreoPreparado = {
      asunto: datos.subject ?? '',
      cuerpo: datos.body ?? '',
      destinatarios: (datos.to_contacts ?? [])
        .filter((c) => c.email)
        .map((c) => ({
          email: c.email!,
          nombre: [c.first_name, c.last_name].filter(Boolean).join(' '),
          marcado: Boolean(c.selected),
        })),
      cc: (datos.cc_mails_list ?? []).map((c) => c.email ?? '').filter(Boolean),
      plantillas,
      plantillaId,
      plantillasPdf: (templates ?? []).map((t) => ({ id: t.template_id, nombre: t.template_name })),
      plantillaPdfId: invoice.template_id || null,
      estadoFactura: invoice.status,
    }
    return NextResponse.json({ correo })
  } catch (error) {
    const { mensaje, estado } = errorComoRespuesta(error)
    return NextResponse.json({ error: mensaje }, { status: estado })
  }
}
