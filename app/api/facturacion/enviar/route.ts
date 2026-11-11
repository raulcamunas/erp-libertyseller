import { NextResponse, type NextRequest } from 'next/server'
import { exigirAdmin } from '@/lib/facturacion/acceso'
import { correosValidos, estadoParaElReflejo, huecosDeEnlace, quitarMarcadoresSinRellenar, rellenarEnlaces, rotuloDeHueco } from '@/lib/facturacion/logica'
import { registrar } from '@/lib/facturacion/registro'
import { createServiceClient } from '@/lib/supabase/service'
import { errorComoRespuesta, zoho } from '@/lib/zoho/books'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * MANDAR LA FACTURA AL CLIENTE, DESDE ZOHO.
 *
 * Sale por Zoho y no por el correo del ERP para que allí quede la factura
 * enviada, con su historial. El orden importa: primero el envío, después las
 * marcas. Si las marcas fallan, el cliente tiene su factura y el tablero lo
 * corrige solo la próxima vez que lee Zoho; al revés, el mes quedaría como
 * enviado sin que nadie haya recibido nada.
 *
 * Un hueco ENLACE_* sin rellenar no sale nunca: el cliente recibiría un botón
 * «Ver comisiones» que no lleva a ningún sitio.
 *
 * Con `recordatorio: true` es un recordatorio de pago (desde Cobros): sale por el
 * mismo camino, con el PDF, pero solo de una factura enviada y sin cobrar, y no
 * cambia nada de la factura. Queda en el registro como envío con
 * `detalle.recordatorio`, que es de donde Cobros saca «recordada hace N días».
 */
export async function POST(request: NextRequest) {
  const permiso = await exigirAdmin()
  if (!permiso.ok) return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })

  const c = (await request.json().catch(() => ({}))) as {
    id?: string
    para?: unknown
    cc?: unknown
    asunto?: string
    cuerpo?: string
    enlaces?: Record<string, string>
    adjuntarPdf?: boolean
    plantillaId?: string
    plantillaNombre?: string
    treasuryClientId?: string | null
    period?: string | null
    /** Es un recordatorio de pago de una factura ya enviada, no la factura */
    recordatorio?: boolean
    /** Los días laborables que llevaba sin pagar, para el registro */
    diasLaborables?: number
  }
  const recordatorio = c.recordatorio === true

  if (!c.id) return NextResponse.json({ error: 'Falta la factura' }, { status: 400 })
  const para = correosValidos(c.para)
  const cc = correosValidos(c.cc ?? [])
  if (!para || para.length === 0) return NextResponse.json({ error: 'Falta una dirección válida a la que enviarla' }, { status: 400 })
  if (!cc) return NextResponse.json({ error: 'Hay una dirección en copia que no es válida' }, { status: 400 })
  if (!c.asunto?.trim()) return NextResponse.json({ error: 'Falta el asunto' }, { status: 400 })
  if (!c.cuerpo?.trim()) return NextResponse.json({ error: 'El correo está vacío' }, { status: 400 })

  // Se quitan también aquí: un marcador sin rellenar no puede llegar al cliente aunque la pantalla se abriera antes de este arreglo
  const cuerpo = quitarMarcadoresSinRellenar(rellenarEnlaces(c.cuerpo, c.enlaces ?? {}))
  const huecos = huecosDeEnlace(`${c.asunto} ${cuerpo}`)
  if (huecos.length > 0) {
    return NextResponse.json({ error: `Falta rellenar: ${huecos.map(rotuloDeHueco).join(', ')}.` }, { status: 422 })
  }

  const ruta = `invoices/${encodeURIComponent(c.id)}`

  // Un recordatorio solo de lo que ya se ha enviado y sigue sin cobrar: de un borrador, el cliente recibiría la factura por primera vez con un «no nos consta el pago»
  if (recordatorio) {
    try {
      const { invoice } = await zoho<{ invoice: { status: string } }>(ruta)
      if (invoice.status === 'draft') return NextResponse.json({ error: 'Es un borrador: el cliente aún no la tiene. Envíala primero desde Facturar.' }, { status: 409 })
      if (invoice.status === 'paid') return NextResponse.json({ error: 'Esta factura ya está cobrada en Zoho: no hay nada que recordar.' }, { status: 409 })
      if (invoice.status === 'void') return NextResponse.json({ error: 'Esta factura está anulada.' }, { status: 409 })
    } catch (error) {
      const { mensaje, estado } = errorComoRespuesta(error)
      return NextResponse.json({ error: mensaje }, { status: estado })
    }
  }

  try {
    await zoho(`${ruta}/email`, {
      metodo: 'POST',
      query: { send_attachment: c.adjuntarPdf === false ? 'false' : 'true' },
      cuerpo: { send_from_org_email_id: false, to_mail_ids: para, cc_mail_ids: cc, subject: c.asunto.trim(), body: cuerpo },
    })
  } catch (error) {
    const { mensaje, estado } = errorComoRespuesta(error)
    return NextResponse.json({ error: `No ha salido el correo: ${mensaje}` }, { status: estado })
  }

  // ---------- Ya salió: a partir de aquí nada puede decir que ha fallado ----------
  const ahora = new Date().toISOString()
  let numero: string | null = null
  let cliente: string | null = null
  let total: number | null = null
  let moneda: string | null = null
  try {
    let { invoice } = await zoho<{ invoice: { invoice_number: string; customer_name: string; total: number; balance: number; currency_code: string; status: string } }>(ruta)
    numero = invoice.invoice_number
    cliente = invoice.customer_name
    // Lo que se le reclama es lo que queda por pagar
    total = Number(recordatorio ? invoice.balance : invoice.total)
    moneda = invoice.currency_code

    // Un recordatorio no toca las marcas de la factura: ni su estado ni su fecha de envío
    if (!recordatorio) {
      if (invoice.status === 'draft') {
        await zoho(`${ruta}/status/sent`, { metodo: 'POST' })
        invoice = { ...invoice, status: 'sent' }
      }
      const service = createServiceClient()
      await service.from('invoices').update({ status: estadoParaElReflejo(invoice.status), email_sent_at: ahora, report_url: Object.values(c.enlaces ?? {})[0] || null }).eq('zoho_invoice_id', c.id)
      if (c.treasuryClientId && c.period) {
        await service.from('treasury_client_months').update({ invoice_sent: true }).eq('client_id', c.treasuryClientId).eq('period', c.period)
      }
    }
  } catch (e) {
    console.error('La factura salió, pero no se han podido dejar las marcas:', e)
  }

  await registrar(permiso, {
    tipo: 'envio',
    zohoId: c.id,
    numero,
    cliente,
    treasuryClientId: c.treasuryClientId,
    period: c.period,
    importe: total,
    moneda,
    detalle: {
      para,
      cc,
      asunto: c.asunto.trim(),
      cuerpo,
      enlaces: c.enlaces ?? {},
      adjuntarPdf: c.adjuntarPdf !== false,
      plantillaId: c.plantillaId ?? null,
      plantillaNombre: c.plantillaNombre ?? null,
      ...(recordatorio ? { recordatorio: true, diasLaborables: Number.isFinite(c.diasLaborables) ? c.diasLaborables : null } : {}),
    },
  })

  return NextResponse.json({ ok: true, para, enviadoEl: ahora })
}
