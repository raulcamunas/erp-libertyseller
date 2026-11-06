import { NextResponse, type NextRequest } from 'next/server'
import { exigirAdmin } from '@/lib/facturacion/acceso'
import { periodoDeFactura } from '@/lib/facturacion/logica'
import { registrar } from '@/lib/facturacion/registro'
import type { DetalleFactura, LineaFactura } from '@/lib/facturacion/tipos'
import { createServiceClient } from '@/lib/supabase/service'
import { errorComoRespuesta, tipoDeCambio, zoho, zohoTodo } from '@/lib/zoho/books'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * LA FACTURA EN ZOHO: LEERLA, CREAR EL BORRADOR, CAMBIARLO Y BORRARLO.
 *
 * Crear no manda nada al cliente: nace en borrador y se envía aparte. Solo un
 * borrador se puede cambiar o borrar desde aquí; una factura que el cliente ya
 * tiene se corrige en Zoho, a propósito y sabiendo lo que se hace.
 */

const FECHA = /^\d{4}-\d{2}-\d{2}$/

const responderError = (error: unknown) => {
  const { mensaje, estado } = errorComoRespuesta(error)
  return NextResponse.json({ error: mensaje }, { status: estado })
}

function validar(cuerpo: { numero?: string; fecha?: string; vence?: string; lineas?: LineaFactura[] }): string | null {
  if (!cuerpo.numero?.trim()) return 'Falta el número de factura'
  if (cuerpo.numero.trim().length > 100) return 'El número de factura es demasiado largo'
  if (!cuerpo.fecha || !FECHA.test(cuerpo.fecha)) return 'Falta la fecha de la factura'
  if (!cuerpo.vence || !FECHA.test(cuerpo.vence)) return 'Falta el vencimiento'
  if (cuerpo.vence < cuerpo.fecha) return 'El vencimiento no puede ser anterior a la fecha de la factura'
  if (!Array.isArray(cuerpo.lineas) || cuerpo.lineas.length === 0) return 'La factura no tiene líneas'
  for (const l of cuerpo.lineas) {
    if (!l.descripcion?.trim()) return 'Hay una línea sin concepto'
    if (!(Number(l.importe) > 0)) return `La línea «${l.descripcion}» no tiene un importe válido`
  }
  return null
}

/** Lo que se le manda a Zoho al crear o editar. Sin nota: no se quiere en la factura ni en el correo */
async function cuerpoParaZoho(contactoId: string, c: { numero?: string; fecha?: string; vence?: string; lineas?: LineaFactura[] }) {
  const [{ contact }, { currencies }] = await Promise.all([
    zoho<{ contact?: { currency_id?: string; currency_code?: string } }>(`contacts/${encodeURIComponent(contactoId)}`),
    zoho<{ currencies?: { currency_code: string; is_base_currency?: boolean }[] }>('settings/currencies'),
  ])
  const base = currencies?.find((m) => m.is_base_currency)?.currency_code
  const extranjera = contact?.currency_id && contact.currency_code !== base
  return {
    customer_id: contactoId,
    invoice_number: c.numero!.trim(),
    date: c.fecha,
    due_date: c.vence,
    notes: '',
    terms: '',
    ...(extranjera ? { exchange_rate: await tipoDeCambio(contact.currency_id!, c.fecha!) } : {}),
    line_items: c.lineas!.map((l) => ({
      description: l.descripcion.trim(),
      rate: Math.round(Number(l.importe) * 100) / 100,
      quantity: 1,
    })),
  }
}

type FacturaCompleta = {
  invoice_id: string
  invoice_number: string
  customer_id: string
  customer_name?: string
  date: string
  due_date?: string
  total: number
  balance: number
  currency_code: string
  status: string
  template_id?: string
  line_items?: { description?: string; name?: string; rate?: number; quantity?: number; item_total?: number }[]
}

export async function GET(request: NextRequest) {
  const permiso = await exigirAdmin()
  if (!permiso.ok) return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Falta la factura' }, { status: 400 })

  try {
    const { invoice: f } = await zoho<{ invoice: FacturaCompleta }>(`invoices/${encodeURIComponent(id)}`)
    const detalle: DetalleFactura = {
      id: f.invoice_id,
      numero: f.invoice_number,
      fecha: f.date,
      vence: f.due_date || null,
      total: Number(f.total ?? 0),
      saldo: Number(f.balance ?? 0),
      moneda: f.currency_code,
      estadoZoho: f.status,
      contactoId: f.customer_id,
      plantillaPdfId: f.template_id || null,
      lineas: (f.line_items ?? []).map((l) => ({
        descripcion: l.description || l.name || '',
        importe: Number(l.item_total ?? (l.rate ?? 0) * (l.quantity ?? 1)),
      })),
    }
    return NextResponse.json({ factura: detalle })
  } catch (error) {
    return responderError(error)
  }
}

export async function POST(request: NextRequest) {
  const permiso = await exigirAdmin()
  if (!permiso.ok) return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })

  const cuerpo = (await request.json().catch(() => ({}))) as {
    treasuryClientId?: string | null
    contactoId?: string
    period?: string
    numero?: string
    fecha?: string
    vence?: string
    lineas?: LineaFactura[]
    /** Crear otra aunque ese mes ya tenga factura: un cargo aparte */
    otraDelMes?: boolean
  }
  if (!cuerpo.contactoId) return NextResponse.json({ error: 'Falta elegir el cliente de Zoho' }, { status: 400 })
  if (!cuerpo.period || !/^\d{4}-\d{2}-01$/.test(cuerpo.period)) {
    return NextResponse.json({ error: 'Falta el mes' }, { status: 400 })
  }
  const invalido = validar(cuerpo)
  if (invalido) return NextResponse.json({ error: invalido }, { status: 400 })

  try {
    // Dos facturas del mismo mes son un problema contable de verdad: se pregunta antes
    if (!cuerpo.otraDelMes) {
      const suyas = await zohoTodo<{ invoice_number: string; date: string; status: string }>('invoices', 'invoices', {
        customer_id: cuerpo.contactoId,
      })
      const repetida = suyas.find((f) => f.status !== 'void' && periodoDeFactura(f.invoice_number, f.date) === cuerpo.period)
      if (repetida) {
        return NextResponse.json({ error: `Ese cliente ya tiene «${repetida.invoice_number}» este mes.`, repetida: true }, { status: 409 })
      }
    }

    const { invoice } = await zoho<{ invoice: FacturaCompleta }>('invoices', {
      metodo: 'POST',
      query: { ignore_auto_number_generation: 'true' },
      cuerpo: await cuerpoParaZoho(cuerpo.contactoId, cuerpo),
    })

    // La pareja deducida por el nombre queda guardada en cuanto se usa de verdad
    if (cuerpo.treasuryClientId) {
      await createServiceClient()
        .from('treasury_clients')
        .update({ zoho_contact_id: cuerpo.contactoId })
        .eq('id', cuerpo.treasuryClientId)
        .is('zoho_contact_id', null)
    }

    await registrar(permiso, {
      tipo: 'borrador',
      zohoId: invoice.invoice_id,
      numero: invoice.invoice_number,
      cliente: invoice.customer_name,
      treasuryClientId: cuerpo.treasuryClientId,
      period: cuerpo.period,
      importe: Number(invoice.total),
      moneda: invoice.currency_code,
      detalle: { lineas: cuerpo.lineas },
    })
    return NextResponse.json({ ok: true, id: invoice.invoice_id, numero: invoice.invoice_number })
  } catch (error) {
    return responderError(error)
  }
}

export async function PUT(request: NextRequest) {
  const permiso = await exigirAdmin()
  if (!permiso.ok) return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })

  const cuerpo = (await request.json().catch(() => ({}))) as {
    id?: string
    treasuryClientId?: string | null
    period?: string
    numero?: string
    fecha?: string
    vence?: string
    lineas?: LineaFactura[]
  }
  if (!cuerpo.id) return NextResponse.json({ error: 'Falta la factura' }, { status: 400 })
  const invalido = validar(cuerpo)
  if (invalido) return NextResponse.json({ error: invalido }, { status: 400 })

  try {
    const ruta = `invoices/${encodeURIComponent(cuerpo.id)}`
    const { invoice: actual } = await zoho<{ invoice: FacturaCompleta }>(ruta)
    if (actual.status !== 'draft') {
      return NextResponse.json({ error: 'Esta factura ya se ha enviado: se corrige en Zoho.' }, { status: 409 })
    }
    const { invoice } = await zoho<{ invoice: FacturaCompleta }>(ruta, {
      metodo: 'PUT',
      query: { ignore_auto_number_generation: 'true' },
      cuerpo: await cuerpoParaZoho(actual.customer_id, cuerpo),
    })
    await registrar(permiso, {
      tipo: 'borrador_editado',
      zohoId: invoice.invoice_id,
      numero: invoice.invoice_number,
      cliente: invoice.customer_name,
      treasuryClientId: cuerpo.treasuryClientId,
      period: cuerpo.period,
      importe: Number(invoice.total),
      moneda: invoice.currency_code,
      detalle: { lineas: cuerpo.lineas },
    })
    return NextResponse.json({ ok: true, id: invoice.invoice_id, numero: invoice.invoice_number })
  } catch (error) {
    return responderError(error)
  }
}

/** Cambiar la plantilla del PDF */
export async function PATCH(request: NextRequest) {
  const permiso = await exigirAdmin()
  if (!permiso.ok) return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })

  const cuerpo = (await request.json().catch(() => ({}))) as { id?: string; plantillaPdfId?: string }
  if (!cuerpo.id || !cuerpo.plantillaPdfId) return NextResponse.json({ error: 'Falta la factura o la plantilla' }, { status: 400 })

  try {
    await zoho(`invoices/${encodeURIComponent(cuerpo.id)}/templates/${encodeURIComponent(cuerpo.plantillaPdfId)}`, { metodo: 'PUT' })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return responderError(error)
  }
}

export async function DELETE(request: NextRequest) {
  const permiso = await exigirAdmin()
  if (!permiso.ok) return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })

  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Falta la factura' }, { status: 400 })

  try {
    const ruta = `invoices/${encodeURIComponent(id)}`
    const { invoice } = await zoho<{ invoice: FacturaCompleta }>(ruta)
    if (invoice.status !== 'draft') {
      return NextResponse.json({ error: 'Solo se puede borrar un borrador. Esta factura ya se ha enviado.' }, { status: 409 })
    }
    await zoho(ruta, { metodo: 'DELETE' })
    await createServiceClient().from('invoices').delete().eq('zoho_invoice_id', id)
    await registrar(permiso, {
      tipo: 'borrador_borrado',
      zohoId: id,
      numero: invoice.invoice_number,
      cliente: invoice.customer_name,
      importe: Number(invoice.total),
      moneda: invoice.currency_code,
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return responderError(error)
  }
}
