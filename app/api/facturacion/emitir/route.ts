import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { exigirAdmin } from '@/lib/facturacion/acceso'
import { cargarEmisor } from '@/lib/facturacion/tablero'
import { nombreDelMes } from '@/lib/facturacion/tipos'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * EMITIR LA FACTURA DE UN CLIENTE PARA UN MES.
 *
 * Lo que antes se montaba a mano fuera del ERP. Coge lo que hay apuntado en
 * Tesorería —el fee y las comisiones de ese mes— y lo convierte en una factura
 * numerada con sus dos líneas.
 *
 *
 * ============ NO EMITE DOS VECES ============
 *
 * Si ese cliente ya tiene factura viva de ese mes, la devuelve en vez de crear
 * otra. Dos facturas del mismo mes con números distintos es un problema
 * contable de verdad: hay que anular una, y para entonces puede que las dos se
 * hayan mandado. La base también lo impide (índice único de la migración 176),
 * pero llegar hasta el error de la base para enterarse es peor que mirarlo.
 */

/** Días desde la emisión hasta el vencimiento */
const DIAS_DE_PAGO = 30

function sumarDias(iso: string, dias: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function POST(request: NextRequest) {
  const permiso = await exigirAdmin()
  if (!permiso.ok) {
    return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })
  }

  const cuerpo = (await request.json().catch(() => ({}))) as {
    treasuryClientId?: string
    period?: string
    reportUrl?: string | null
    notas?: string | null
  }

  const { treasuryClientId, period } = cuerpo
  if (!treasuryClientId || !period || !/^\d{4}-\d{2}-01$/.test(period)) {
    return NextResponse.json({ error: 'Falta el cliente o el mes' }, { status: 400 })
  }

  const service = createServiceClient()

  // ---------- ¿Ya está emitida? ----------
  const { data: yaHay } = await service
    .from('invoices')
    .select('id, invoice_number, total, status, email_sent_at, report_url')
    .eq('treasury_client_id', treasuryClientId)
    .eq('period', period)
    .neq('status', 'cancelled')
    .maybeSingle()

  if (yaHay) {
    return NextResponse.json({ ok: true, yaExistia: true, factura: yaHay })
  }

  // ---------- El cliente y sus importes ----------
  const [clienteRes, mesRes, emisor] = await Promise.all([
    service
      .from('treasury_clients')
      .select('id, name, email, email_alt, tax_address, tax_id, vat_rate, fee_concept')
      .eq('id', treasuryClientId)
      .single(),
    service
      .from('treasury_client_months')
      .select('fee, commission')
      .eq('client_id', treasuryClientId)
      .eq('period', period)
      .maybeSingle(),
    cargarEmisor(),
  ])

  if (clienteRes.error || !clienteRes.data) {
    return NextResponse.json({ error: 'Ese cliente no existe' }, { status: 404 })
  }
  const cliente = clienteRes.data as Record<string, unknown>

  const fee = mesRes.data?.fee != null ? Number(mesRes.data.fee) : 0
  const comision = mesRes.data?.commission != null ? Number(mesRes.data.commission) : 0

  if (fee <= 0 && comision <= 0) {
    return NextResponse.json(
      { error: 'Este cliente no tiene importes en Tesorería para ese mes' },
      { status: 400 }
    )
  }

  // ---------- Las líneas ----------
  const mesEnLetra = nombreDelMes(period)
  const conceptoFee = (cliente.fee_concept as string | null)?.trim() || 'Gestión Amazon'

  const lineas: { description: string; quantity: number; unit_price: number; sort_order: number }[] =
    []
  if (fee > 0) {
    lineas.push({
      description: `${conceptoFee} — ${mesEnLetra}`,
      quantity: 1,
      unit_price: fee,
      sort_order: 0,
    })
  }
  if (comision > 0) {
    lineas.push({
      description: `Comisiones sobre ventas — ${mesEnLetra}`,
      quantity: 1,
      unit_price: comision,
      sort_order: 1,
    })
  }

  // ---------- El número ----------
  //
  // Se busca el último del año por prefijo y se le suma uno. Es la misma cuenta
  // que ya hacía POST /api/invoices; aquí se repite en vez de llamar a esa ruta
  // porque esa ruta usa la sesión del navegador y esto corre en el servidor.
  const anio = new Date(`${period}T00:00:00Z`).getUTCFullYear()
  const prefijo = `${emisor.invoice_prefix || 'LS'}-${anio}-`
  const { data: ultima } = await service
    .from('invoices')
    .select('invoice_number')
    .ilike('invoice_number', `${prefijo}%`)
    .order('invoice_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  let siguiente = 1
  if (ultima?.invoice_number) {
    const cola = String(ultima.invoice_number).slice(prefijo.length)
    siguiente = (parseInt(cola, 10) || 0) + 1
  }
  const numero = `${prefijo}${String(siguiente).padStart(3, '0')}`

  // ---------- Cuentas ----------
  const vatRate = cliente.vat_rate != null ? Number(cliente.vat_rate) : 0.21
  const subtotal = lineas.reduce((s, l) => s + l.quantity * l.unit_price, 0)
  const vatAmount = Math.round(subtotal * vatRate * 100) / 100
  const total = Math.round((subtotal + vatAmount) * 100) / 100

  const emision = hoyISO()

  const { data: factura, error: errorFactura } = await service
    .from('invoices')
    .insert({
      treasury_client_id: treasuryClientId,
      client_name: String(cliente.name ?? ''),
      client_email: (cliente.email as string) || null,
      invoice_number: numero,
      issue_date: emision,
      due_date: sumarDias(emision, DIAS_DE_PAGO),
      status: 'draft',
      period,
      report_url: cuerpo.reportUrl || null,
      subtotal,
      vat_rate: vatRate,
      vat_amount: vatAmount,
      total,
      currency: 'EUR',
      notes: cuerpo.notas || null,
    })
    .select()
    .single()

  if (errorFactura) {
    // 23505 = choca con el índice único: alguien emitió la misma factura entre
    // la comprobación de arriba y este insert.
    if (errorFactura.code === '23505') {
      return NextResponse.json(
        { error: 'Esa factura acaba de emitirse desde otro sitio. Recarga la pantalla.' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: errorFactura.message }, { status: 500 })
  }

  const { error: errorLineas } = await service.from('invoice_items').insert(
    lineas.map((l) => ({
      invoice_id: factura.id,
      description: l.description,
      quantity: l.quantity,
      unit_price: l.unit_price,
      amount: l.quantity * l.unit_price,
      sort_order: l.sort_order,
    }))
  )

  if (errorLineas) {
    // Una factura sin líneas no vale para nada y encima quema un número. Se
    // borra para que el siguiente intento salga limpio.
    await service.from('invoices').delete().eq('id', factura.id)
    return NextResponse.json({ error: errorLineas.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, yaExistia: false, factura })
}
