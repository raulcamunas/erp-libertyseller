import { NextResponse, type NextRequest } from 'next/server'
import { exigirAdmin } from '@/lib/facturacion/acceso'
import { registrar } from '@/lib/facturacion/registro'
import type { PlantillaCompleta, PlantillaResumen } from '@/lib/facturacion/tipos'
import { errorComoRespuesta, zoho } from '@/lib/zoho/books'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * LAS PLANTILLAS DE CORREO DE LAS FACTURAS, QUE VIVEN EN ZOHO.
 *
 * Solo las de factura: Zoho guarda aquí también decenas de «Predeterminado» de
 * otros documentos. Al guardar se reenvían los campos que no se editan, para no
 * perder de paso cuál es la plantilla por defecto.
 */

const TIPO_FACTURA = 'invoice_notification'

type PlantillaZoho = {
  email_template_id: string
  name: string
  type: string
  subject: string
  body: string
  is_default?: boolean
  cc_me?: boolean
  from_address_id?: string
}

const responderError = (error: unknown) => {
  const { mensaje, estado } = errorComoRespuesta(error)
  return NextResponse.json({ error: mensaje }, { status: estado })
}

const rutaDe = (id: string) => `settings/emailtemplates/${encodeURIComponent(id)}`

export async function GET(request: NextRequest) {
  const permiso = await exigirAdmin()
  if (!permiso.ok) return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })

  const id = request.nextUrl.searchParams.get('id')
  try {
    if (!id) {
      const { emailtemplates } = await zoho<{ emailtemplates?: PlantillaZoho[] }>('settings/emailtemplates')
      const plantillas: PlantillaResumen[] = (emailtemplates ?? [])
        .filter((t) => t.type === TIPO_FACTURA)
        .map((t) => ({ id: t.email_template_id, nombre: t.name }))
      return NextResponse.json({ plantillas })
    }
    const r = await zoho<{ email_template: PlantillaZoho; placeholders?: Record<string, { name: string; value: string }[]> }>(rutaDe(id))
    const plantilla: PlantillaCompleta = {
      id: r.email_template.email_template_id,
      nombre: r.email_template.name,
      asunto: r.email_template.subject ?? '',
      cuerpo: r.email_template.body ?? '',
      esPorDefecto: Boolean(r.email_template.is_default),
      marcadores: Object.values(r.placeholders ?? {})
        .flat()
        .map((m) => ({ nombre: m.name, valor: m.value })),
    }
    return NextResponse.json({ plantilla })
  } catch (error) {
    return responderError(error)
  }
}

export async function PUT(request: NextRequest) {
  const permiso = await exigirAdmin()
  if (!permiso.ok) return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })

  const c = (await request.json().catch(() => ({}))) as { id?: string; nombre?: string; asunto?: string; cuerpo?: string }
  if (!c.id) return NextResponse.json({ error: 'Falta la plantilla' }, { status: 400 })
  if (!c.nombre?.trim() || !c.asunto?.trim() || !c.cuerpo?.trim()) {
    return NextResponse.json({ error: 'La plantilla necesita nombre, asunto y cuerpo' }, { status: 400 })
  }

  try {
    const { email_template: actual } = await zoho<{ email_template: PlantillaZoho }>(rutaDe(c.id))
    await zoho(rutaDe(c.id), {
      metodo: 'PUT',
      cuerpo: {
        name: c.nombre.trim(),
        type: actual.type,
        subject: c.asunto,
        body: c.cuerpo,
        is_default: actual.is_default,
        cc_me: actual.cc_me,
        ...(actual.from_address_id ? { from_address_id: actual.from_address_id } : {}),
      },
    })
    await registrar(permiso, {
      tipo: 'plantilla',
      zohoId: c.id,
      numero: c.nombre.trim(),
      // El cuerpo anterior se guarda: Zoho no tiene historial y así un cambio se puede deshacer
      detalle: { accion: 'editada', anterior: { asunto: actual.subject, cuerpo: actual.body } },
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return responderError(error)
  }
}

/** Duplicar una plantilla para tener otra versión sin tocar la original */
export async function POST(request: NextRequest) {
  const permiso = await exigirAdmin()
  if (!permiso.ok) return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })

  const c = (await request.json().catch(() => ({}))) as { desdeId?: string; nombre?: string; asunto?: string; cuerpo?: string }
  if (!c.desdeId || !c.nombre?.trim()) return NextResponse.json({ error: 'Falta el nombre de la plantilla nueva' }, { status: 400 })

  try {
    const { email_template: base } = await zoho<{ email_template: PlantillaZoho }>(rutaDe(c.desdeId))
    const { email_template: nueva } = await zoho<{ email_template: PlantillaZoho }>('settings/emailtemplates', {
      metodo: 'POST',
      cuerpo: { name: c.nombre.trim(), type: base.type, subject: c.asunto ?? base.subject, body: c.cuerpo ?? base.body },
    })
    await registrar(permiso, {
      tipo: 'plantilla',
      zohoId: nueva.email_template_id,
      numero: c.nombre.trim(),
      detalle: { accion: 'creada', desde: base.name },
    })
    return NextResponse.json({ ok: true, id: nueva.email_template_id })
  } catch (error) {
    return responderError(error)
  }
}
