import { NextResponse, type NextRequest } from 'next/server'
import { exigirAdmin } from '@/lib/facturacion/acceso'
import { estadoParaElReflejo, periodoDeFactura } from '@/lib/facturacion/logica'
import { registrar } from '@/lib/facturacion/registro'
import type { CobroReciente, CuentaBancaria, CuentaDeGasto, DatosDeCobros, FacturaPendiente, MovimientoSinCategorizar } from '@/lib/facturacion/tipos'
import { createServiceClient } from '@/lib/supabase/service'
import { errorComoRespuesta, tipoDeCambio, zoho, zohoTodo } from '@/lib/zoho/books'
import type { FacturaCruda } from '@/lib/facturacion/tablero'
import { facturaDesdeZoho } from '@/lib/facturacion/tablero'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60

/**
 * LO QUE ESTÁ POR COBRAR Y LO QUE HA PASADO EN EL BANCO, Y REGISTRAR UN COBRO.
 *
 * Un movimiento «sin categorizar» es una línea de extracto que ya está en Zoho y
 * espera que le digan qué es. Un cobro que viene de una de esas líneas la
 * categoriza; uno a mano crea el cobro directamente. Los dos acaban igual.
 */

const FECHA = /^\d{4}-\d{2}-\d{2}$/
const hoy = () => new Date().toISOString().slice(0, 10)

export async function GET() {
  const permiso = await exigirAdmin()
  if (!permiso.ok) return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })

  try {
    const [impagadas, parciales, bancos, plan, cobros] = await Promise.all([
      zohoTodo<FacturaCruda>('invoices', 'invoices', { status: 'unpaid', sort_column: 'due_date', sort_order: 'A' }),
      zohoTodo<FacturaCruda>('invoices', 'invoices', { status: 'partially_paid' }),
      zohoTodo<{ account_id: string; account_name: string; account_type: string; currency_code: string; currency_id: string; balance: number; uncategorized_transactions?: number; is_active?: boolean; bank_name?: string }>('bankaccounts', 'bankaccounts'),
      zohoTodo<{ account_id: string; account_name: string; account_type: string; is_active?: boolean }>('chartofaccounts', 'chartofaccounts'),
      zoho<{ customerpayments?: { payment_id: string; date: string; customer_name: string; amount: number; currency_code?: string; reference_number?: string; account_name?: string }[] }>('customerpayments', { query: { per_page: 15 } }),
    ])

    const hoyEs = hoy()
    const vistas = new Set<string>()
    const pendientes: FacturaPendiente[] = [...impagadas, ...parciales]
      .filter((f) => !vistas.has(f.invoice_id) && Boolean(vistas.add(f.invoice_id)))
      .map((f) => ({
        ...facturaDesdeZoho(f),
        clienteId: f.customer_id,
        cliente: f.customer_name,
        diasVencida: f.due_date && f.due_date < hoyEs ? Math.round((Date.parse(hoyEs) - Date.parse(f.due_date)) / 86_400_000) : 0,
      }))

    const cuentas: CuentaBancaria[] = bancos
      .filter((b) => b.account_type === 'bank' && b.is_active !== false)
      .map((b) => ({
        id: b.account_id,
        nombre: b.account_name,
        moneda: b.currency_code,
        monedaId: b.currency_id,
        saldo: Number(b.balance ?? 0),
        sinCategorizar: Number(b.uncategorized_transactions ?? 0),
        esPayset: /payset/i.test(b.account_name),
      }))

    const listas = await Promise.all(
      cuentas
        .filter((c) => c.sinCategorizar > 0)
        .map(async (c) => {
          const filas = await zohoTodo<{ transaction_id: string; date: string; amount: number; debit_or_credit: string; description?: string; payee?: string; reference_number?: string; currency_code?: string }>('banktransactions', 'banktransactions', {
            account_id: c.id,
            status: 'uncategorized',
          })
          return filas.map<MovimientoSinCategorizar>((m) => ({
            id: m.transaction_id,
            cuentaId: c.id,
            cuentaNombre: c.nombre,
            fecha: m.date,
            importe: Number(m.amount ?? 0),
            moneda: m.currency_code || c.moneda,
            entrada: m.debit_or_credit === 'debit',
            concepto: m.description || m.payee || '',
            referencia: m.reference_number ?? '',
          }))
        })
    )

    const TIPOS_GASTO = new Set(['expense', 'other_expense', 'cost_of_goods_sold'])
    const cuentasDeGasto: CuentaDeGasto[] = plan
      .filter((a) => TIPOS_GASTO.has(a.account_type) && a.is_active !== false)
      .map((a) => ({ id: a.account_id, nombre: a.account_name }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))

    const recientes: CobroReciente[] = (cobros.customerpayments ?? []).map((c) => ({
      id: c.payment_id,
      fecha: c.date,
      cliente: c.customer_name,
      importe: Number(c.amount ?? 0),
      moneda: c.currency_code ?? 'EUR',
      referencia: c.reference_number ?? '',
      cuenta: c.account_name ?? '',
    }))

    const datos: DatosDeCobros = {
      pendientes,
      cuentas,
      movimientos: listas.flat().sort((a, b) => b.fecha.localeCompare(a.fecha)),
      cuentasDeGasto,
      cobros: recientes,
    }
    return NextResponse.json(datos)
  } catch (error) {
    const { mensaje, estado } = errorComoRespuesta(error)
    return NextResponse.json({ error: mensaje }, { status: estado })
  }
}

export async function POST(request: NextRequest) {
  const permiso = await exigirAdmin()
  if (!permiso.ok) return NextResponse.json({ error: permiso.mensaje }, { status: permiso.estado })

  const c = (await request.json().catch(() => ({}))) as {
    facturaId?: string
    importe?: number
    fecha?: string
    cuentaId?: string
    referencia?: string
    concepto?: string
    comisionBanco?: number
    /** La línea de extracto de la que sale, si sale de una */
    movimientoId?: string | null
  }

  const importe = Math.round(Number(c.importe) * 100) / 100
  const comisionBanco = Math.round(Number(c.comisionBanco ?? 0) * 100) / 100
  if (!c.facturaId) return NextResponse.json({ error: 'Falta la factura' }, { status: 400 })
  if (!(importe > 0)) return NextResponse.json({ error: 'El importe tiene que ser mayor que cero' }, { status: 400 })
  if (!(comisionBanco >= 0)) return NextResponse.json({ error: 'La comisión del banco no es válida' }, { status: 400 })
  if (!c.fecha || !FECHA.test(c.fecha)) return NextResponse.json({ error: 'Falta la fecha del cobro' }, { status: 400 })
  if (c.fecha > hoy()) return NextResponse.json({ error: 'La fecha del cobro no puede ser futura' }, { status: 400 })
  if (!c.cuentaId) return NextResponse.json({ error: 'Falta la cuenta donde ha entrado' }, { status: 400 })

  try {
    const rutaFactura = `invoices/${encodeURIComponent(c.facturaId)}`
    const [{ invoice: f }, { currencies }] = await Promise.all([
      zoho<{ invoice: FacturaCruda & { currency_id: string; invoice_id: string } }>(rutaFactura),
      zoho<{ currencies?: { currency_code: string; is_base_currency?: boolean }[] }>('settings/currencies'),
    ])
    if (f.status === 'draft') return NextResponse.json({ error: 'No se puede cobrar un borrador: primero hay que enviarlo.' }, { status: 409 })
    if (f.status === 'void') return NextResponse.json({ error: 'Esa factura está anulada.' }, { status: 409 })
    if (importe > Number(f.balance) + 0.005) {
      return NextResponse.json({ error: `El cobro (${importe.toFixed(2)}) es mayor que lo que queda por pagar (${Number(f.balance).toFixed(2)}).` }, { status: 422 })
    }

    const base = currencies?.find((m) => m.is_base_currency)?.currency_code
    const cuerpo = {
      customer_id: f.customer_id,
      payment_mode: 'banktransfer',
      amount: importe,
      date: c.fecha,
      account_id: c.cuentaId,
      reference_number: c.referencia?.trim() || undefined,
      description: c.concepto?.trim() || undefined,
      bank_charges: comisionBanco || undefined,
      ...(f.currency_code !== base ? { exchange_rate: await tipoDeCambio(f.currency_id, c.fecha) } : {}),
      invoices: [{ invoice_id: f.invoice_id, amount_applied: importe }],
    }

    const r = c.movimientoId
      ? await zoho<{ payment?: { payment_id?: string } }>(`banktransactions/uncategorized/${encodeURIComponent(c.movimientoId)}/categorize/customerpayments`, { metodo: 'POST', cuerpo })
      : await zoho<{ payment?: { payment_id?: string } }>('customerpayments', { metodo: 'POST', cuerpo })

    // ---------- Ya está en Zoho: las marcas de aquí en adelante no pueden hacerlo fallar ----------
    let cobradaEntera = false
    let treasuryClientId: string | null = null
    const period = periodoDeFactura(f.invoice_number, f.date)
    try {
      const { invoice: despues } = await zoho<{ invoice: { status: string } }>(rutaFactura)
      cobradaEntera = despues.status === 'paid'
      const service = createServiceClient()
      await service.from('invoices').update({ status: estadoParaElReflejo(despues.status), ...(cobradaEntera ? { paid_at: new Date().toISOString(), paid_amount: Number(f.total), bank_reference: c.referencia?.trim() || null } : {}) }).eq('zoho_invoice_id', c.facturaId)
      const { data: cliente } = await service.from('treasury_clients').select('id').eq('zoho_contact_id', f.customer_id).maybeSingle()
      treasuryClientId = (cliente?.id as string | undefined) ?? null
      if (cobradaEntera && treasuryClientId) {
        await service.from('treasury_client_months').update({ paid: true }).eq('client_id', treasuryClientId).eq('period', period)
      }
    } catch (e) {
      console.error('El cobro se registró, pero no se han podido dejar las marcas:', e)
    }

    await registrar(permiso, {
      tipo: 'cobro',
      zohoId: r.payment?.payment_id ?? null,
      numero: f.invoice_number,
      cliente: f.customer_name,
      treasuryClientId,
      period,
      importe,
      moneda: f.currency_code,
      detalle: { fecha: c.fecha, referencia: c.referencia ?? null, cuentaId: c.cuentaId, comisionBanco, movimientoId: c.movimientoId ?? null, concepto: c.concepto ?? null },
    })
    return NextResponse.json({ ok: true, cobradaEntera })
  } catch (error) {
    const { mensaje, estado } = errorComoRespuesta(error)
    return NextResponse.json({ error: mensaje }, { status: estado })
  }
}
